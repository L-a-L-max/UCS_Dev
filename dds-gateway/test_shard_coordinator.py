"""Unit tests for shard_coordinator.

These tests use a minimal in-memory fake Redis so they run anywhere (no
server, no redis-py, no ROS2). They cover the three things most likely to
regress:

* ``owns_drone()`` correctly partitions drones across peers.
* ``compute_rank()`` is deterministic given the same UUID set.
* ``maybe_create_from_env()`` honours ``DDS_DYNAMIC_SHARDING`` / legacy flags.

Run with:
    python -m pytest dds-gateway/test_shard_coordinator.py -q
or (no pytest):
    python dds-gateway/test_shard_coordinator.py
"""

from __future__ import annotations

import os
import sys
import time
import unittest
from typing import Dict, Tuple
from unittest import mock

sys.path.insert(0, os.path.dirname(__file__))

from shard_coordinator import (  # noqa: E402
    ShardCoordinator,
    ShardLayout,
    compute_rank,
    maybe_create_from_env,
)


class FakeRedis:
    """Dead-simple in-memory stub — enough for ShardCoordinator."""

    def __init__(self):
        self._store: Dict[str, Tuple[str, float]] = {}  # key -> (value, expires_at)
        self._now = [1000.0]  # mutable clock

    def _purge(self):
        now = self._now[0]
        expired = [k for k, (_, exp) in self._store.items() if exp < now]
        for k in expired:
            del self._store[k]

    def advance(self, dt: float):
        self._now[0] += dt
        self._purge()

    def ping(self):
        return True

    def set(self, key, value, ex=None, **_kwargs):
        exp = self._now[0] + ex if ex is not None else float("inf")
        self._store[key] = (value, exp)
        return True

    def delete(self, key):
        self._store.pop(key, None)
        return 1

    def scan(self, cursor=0, match=None, count=100):
        self._purge()
        # Very small catalogue — ignore cursor paging, just return everything.
        import fnmatch
        if match is None:
            keys = list(self._store.keys())
        else:
            keys = [k for k in self._store.keys() if fnmatch.fnmatch(k, match)]
        return 0, keys


# ---------------------------------------------------------------------------


class ComputeRankTests(unittest.TestCase):
    def test_single_peer(self):
        rank, total = compute_rank(["aaa"], "aaa")
        self.assertEqual((rank, total), (0, 1))

    def test_ordering_is_deterministic(self):
        peers = ["ccc", "aaa", "bbb"]
        # Same input from different callers must yield the same (rank, total).
        self.assertEqual(compute_rank(peers, "aaa"), (0, 3))
        self.assertEqual(compute_rank(peers, "bbb"), (1, 3))
        self.assertEqual(compute_rank(peers, "ccc"), (2, 3))

    def test_duplicates_are_deduped(self):
        rank, total = compute_rank(["aaa", "bbb", "aaa"], "bbb")
        self.assertEqual((rank, total), (1, 2))


class OwnsDroneTests(unittest.TestCase):
    def test_solo_owns_everything(self):
        r = FakeRedis()
        c = ShardCoordinator(r, gateway_type="rx", heartbeat_interval=1, ttl_seconds=5)
        c.start()
        try:
            for uav in ("px4_1", "px4_2", "px4_3", "px4_30"):
                self.assertTrue(c.owns_drone(uav))
        finally:
            c.close()

    def test_two_peers_partition_is_disjoint_and_complete(self):
        r = FakeRedis()
        c1 = ShardCoordinator(r, gateway_type="rx", heartbeat_interval=1, ttl_seconds=5)
        c2 = ShardCoordinator(r, gateway_type="rx", heartbeat_interval=1, ttl_seconds=5)
        c1.start()
        c2.start()
        try:
            # Force a second heartbeat on each so each sees the other.
            c1._register_and_scan(first_pass=False)
            c2._register_and_scan(first_pass=False)

            owned_by_c1 = {u for u in _sample_uavs() if c1.owns_drone(u)}
            owned_by_c2 = {u for u in _sample_uavs() if c2.owns_drone(u)}

            # Every drone must be owned by exactly one peer.
            self.assertEqual(owned_by_c1 | owned_by_c2, set(_sample_uavs()))
            self.assertEqual(owned_by_c1 & owned_by_c2, set())
            # Both peers should actually have drones (otherwise the test is
            # degenerate and hashing is broken).
            self.assertTrue(owned_by_c1)
            self.assertTrue(owned_by_c2)
        finally:
            c1.close()
            c2.close()

    def test_peer_crash_rebalances(self):
        r = FakeRedis()
        c1 = ShardCoordinator(r, gateway_type="rx", heartbeat_interval=1, ttl_seconds=5)
        c2 = ShardCoordinator(r, gateway_type="rx", heartbeat_interval=1, ttl_seconds=5)
        c1.start()
        c2.start()
        try:
            c1._register_and_scan(first_pass=False)
            self.assertEqual(c1.layout().total, 2)

            # c2 "crashes" — simulate by advancing clock past TTL (no heartbeat).
            c2.close()
            r.advance(6)

            c1._register_and_scan(first_pass=False)
            self.assertEqual(c1.layout().total, 1)
            # After rebalance, the single surviving peer owns everything.
            for uav in _sample_uavs():
                self.assertTrue(c1.owns_drone(uav))
        finally:
            c1.close()

    def test_redis_down_falls_back_to_single_instance(self):
        c = ShardCoordinator(
            redis_client=None, gateway_type="rx",
            heartbeat_interval=1, ttl_seconds=5,
        )
        c.start()  # no-op when redis is None
        for uav in ("px4_1", "px4_2"):
            self.assertTrue(c.owns_drone(uav))
        c.close()

    def test_layout_change_callback_fires(self):
        r = FakeRedis()
        events = []

        def on_change(old: ShardLayout, new: ShardLayout):
            events.append((old.total, new.total))

        c1 = ShardCoordinator(r, gateway_type="tx", heartbeat_interval=1,
                              ttl_seconds=5, on_layout_change=on_change)
        c1.start()
        c2 = ShardCoordinator(r, gateway_type="tx", heartbeat_interval=1,
                              ttl_seconds=5)
        c2.start()
        try:
            c1._register_and_scan(first_pass=False)
            self.assertEqual(events, [(1, 2)])
            c2.close()
            r.advance(6)
            c1._register_and_scan(first_pass=False)
            self.assertEqual(events, [(1, 2), (2, 1)])
        finally:
            c1.close()


class FactoryTests(unittest.TestCase):
    def test_disabled_returns_none(self):
        with mock.patch.dict(os.environ, {"DDS_DYNAMIC_SHARDING": "false"}, clear=False):
            self.assertIsNone(maybe_create_from_env(FakeRedis(), "rx", legacy_total_instances=1))

    def test_legacy_static_config_is_respected_when_unset(self):
        env = dict(os.environ)
        env.pop("DDS_DYNAMIC_SHARDING", None)
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertIsNone(maybe_create_from_env(FakeRedis(), "rx", legacy_total_instances=3))

    def test_explicit_dynamic_wins_over_legacy(self):
        with mock.patch.dict(os.environ, {"DDS_DYNAMIC_SHARDING": "true"}, clear=False):
            c = maybe_create_from_env(FakeRedis(), "rx", legacy_total_instances=3)
            self.assertIsNotNone(c)


# ---------------------------------------------------------------------------


def _sample_uavs():
    return [f"px4_{i}" for i in range(1, 31)]


if __name__ == "__main__":
    unittest.main()
