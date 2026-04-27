"""
Dynamic shard coordinator for the DDS gateways.

Previously every DDS gateway instance had to be launched with a hard-coded
``--instance-id`` / ``--total-instances`` pair (see ``dds_gateway.py`` main
argparse block). That meant:

* Adding / removing an instance required a coordinated restart of **every**
  existing instance to give them all a new ``total_instances``.
* A crashed instance left its slice of drones unowned until a human restarted
  it with the right ``instance_id``.
* Auto-scaling (K8s HPA, Nomad, etc.) was impossible because the scheduler has
  no way to pre-allocate deterministic instance IDs.

This module replaces that static model with a Redis-backed self-registration
protocol that is **fully dynamic**:

1. Every instance picks a random ``instance_uuid`` on boot (immutable for the
   lifetime of the process).
2. Every ``heartbeat_interval`` seconds the coordinator writes
   ``SET <namespace>:<gateway_type>:<instance_uuid> <json>  EX <ttl_seconds>``
   (so a crashed instance's key auto-expires within ``ttl_seconds``).
3. In the same loop it runs a ``SCAN`` for all live peers, sorts their UUIDs
   lexicographically (deterministic across processes), and derives
   ``rank = index_of(self) / total = len(peers)``.
4. ``owns_drone(uav_id)`` then uses ``md5(uav_id) % total == rank`` — identical
   math to the legacy static sharder, but with ``total`` and ``rank``
   recomputed live on every heartbeat.

Design notes:
* Redis (already required by every gateway for ``dds:epoch:*``) is reused as
  the single source of truth — no new infra dep.
* Sorting by UUID gives every instance the **same** view of "who is rank 0,
  rank 1 ..." without a leader election round trip.
* Safety on Redis outage: ``owns_drone`` falls back to ``True`` (single-
  instance mode) so a Redis blip never silently blackholes every drone.
* A ``on_layout_change`` callback is fired whenever (rank, total) changes,
  letting the gateway drop DDS subscriptions for drones it no longer owns.

The coordinator is intentionally framework-free (no ROS2 / no Kafka imports)
so it is trivially unit-testable with a fake Redis client.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import socket
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class ShardLayout:
    """Current known layout — immutable snapshot returned to callers."""
    rank: int
    total: int
    peers: List[str] = field(default_factory=list)  # sorted instance_uuid list


class ShardCoordinator:
    """Redis-backed dynamic shard coordinator.

    Parameters
    ----------
    redis_client : redis.Redis or None
        Connected client. When ``None`` the coordinator stays in
        ``rank=0, total=1`` mode (pure single-instance semantics) so the
        gateway continues to work even without Redis.
    gateway_type : str
        Logical gateway family: ``"routing"``, ``"rx"`` or ``"tx"``. Keeps the
        three gateway pools in separate peer groups so a routing gateway
        never mistakes an rx gateway for a peer.
    namespace : str
        Redis key prefix. Default ``"dds:shards"``.
    heartbeat_interval : float
        Seconds between heartbeats / peer scans.
    ttl_seconds : int
        Redis key TTL. Must be >= 2 * heartbeat_interval so a single missed
        heartbeat does not evict a healthy peer.
    on_layout_change : callable ``(ShardLayout old, ShardLayout new) -> None``
        Optional callback invoked (from the heartbeat thread) whenever the
        (rank, total) pair flips. Use it to unsubscribe drones that now
        belong to another instance.
    """

    DEFAULT_NAMESPACE = "dds:shards"

    def __init__(
        self,
        redis_client,
        gateway_type: str,
        namespace: str = DEFAULT_NAMESPACE,
        heartbeat_interval: float = 5.0,
        ttl_seconds: int = 15,
        on_layout_change: Optional[Callable[[ShardLayout, ShardLayout], None]] = None,
        clock: Callable[[], float] = time.time,
    ):
        if ttl_seconds < 2 * heartbeat_interval:
            raise ValueError(
                "ttl_seconds must be >= 2 * heartbeat_interval to tolerate one "
                f"missed beat (got ttl={ttl_seconds}, hb={heartbeat_interval})"
            )
        if gateway_type not in ("routing", "rx", "tx"):
            # Not a hard error — just a warning so custom types don't break
            # an existing deployment.
            logger.warning("[Shard] Unknown gateway_type=%s (expected routing/rx/tx)", gateway_type)

        self._redis = redis_client
        self._gateway_type = gateway_type
        self._namespace = namespace
        self._heartbeat_interval = heartbeat_interval
        self._ttl_seconds = ttl_seconds
        self._on_layout_change = on_layout_change
        self._clock = clock

        # A random UUID is the coordination primitive: deterministic sort of
        # UUIDs yields the same rank ordering on every peer.
        self._instance_uuid = uuid.uuid4().hex
        self._self_key = f"{namespace}:{gateway_type}:{self._instance_uuid}"
        self._scan_match = f"{namespace}:{gateway_type}:*"
        self._metadata = {
            "instance_uuid": self._instance_uuid,
            "gateway_type": gateway_type,
            "hostname": socket.gethostname(),
            "pid": os.getpid(),
            "started_at": self._clock(),
        }

        # Current layout — updated atomically via self._lock.
        self._lock = threading.Lock()
        self._layout = ShardLayout(rank=0, total=1, peers=[self._instance_uuid])

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # -------- public API --------

    @property
    def instance_uuid(self) -> str:
        return self._instance_uuid

    def layout(self) -> ShardLayout:
        """Return the most recently observed layout (thread-safe snapshot)."""
        with self._lock:
            return ShardLayout(self._layout.rank, self._layout.total, list(self._layout.peers))

    def owns_drone(self, uav_id: str) -> bool:
        """Return True iff this instance currently owns ``uav_id``.

        Falls back to ``True`` (single-instance) when Redis is unavailable,
        so a Redis outage degrades to "serve everything" rather than
        "serve nothing".
        """
        if self._redis is None:
            return True
        layout = self.layout()
        if layout.total <= 1:
            return True
        h = int(hashlib.md5(uav_id.encode("utf-8")).hexdigest(), 16)
        return (h % layout.total) == layout.rank

    def start(self) -> None:
        """Register with Redis and launch the heartbeat thread.

        Safe to call even when ``redis_client is None`` — in that case the
        coordinator stays in static single-instance mode.
        """
        if self._thread is not None:
            return
        if self._redis is None:
            logger.warning(
                "[Shard/%s] Redis not available — running as single instance (rank=0/total=1)",
                self._gateway_type,
            )
            return

        # Register synchronously once so ``layout()`` is meaningful right after
        # start() returns (e.g. for the first pass of drone discovery).
        self._register_and_scan(first_pass=True)

        self._thread = threading.Thread(
            target=self._run_loop,
            name=f"shard-hb-{self._gateway_type}",
            daemon=True,
        )
        self._thread.start()
        logger.info(
            "[Shard/%s] Dynamic shard coordinator started uuid=%s peers=%d rank=%d/%d",
            self._gateway_type,
            self._instance_uuid[:8],
            len(self._layout.peers),
            self._layout.rank,
            self._layout.total,
        )

    def close(self) -> None:
        """Best-effort removal of the self key + stop the heartbeat thread.

        Called from the gateway's ``stop()`` so peers rebalance immediately
        instead of waiting for the TTL to expire.
        """
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=self._heartbeat_interval + 1.0)
            self._thread = None
        if self._redis is not None:
            try:
                self._redis.delete(self._self_key)
                logger.info("[Shard/%s] Removed self key on shutdown", self._gateway_type)
            except Exception as e:
                logger.warning("[Shard/%s] Failed to delete self key: %s", self._gateway_type, e)

    # -------- internals --------

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self._register_and_scan(first_pass=False)
            except Exception as e:  # pragma: no cover — defensive
                logger.warning("[Shard/%s] heartbeat cycle failed: %s", self._gateway_type, e)
            # Use wait() so close() can interrupt sleep immediately.
            self._stop_event.wait(self._heartbeat_interval)

    def _register_and_scan(self, first_pass: bool) -> None:
        """One cycle: refresh own key, enumerate peers, publish layout change."""
        assert self._redis is not None

        # 1) Refresh our own key with the current epoch so stragglers notice we
        # are still alive.
        payload = dict(self._metadata, epoch=self._clock())
        self._redis.set(self._self_key, json.dumps(payload), ex=self._ttl_seconds)

        # 2) Enumerate peers via SCAN (cluster-safe, unlike KEYS).
        peer_uuids: List[str] = []
        cursor = 0
        while True:
            cursor, keys = self._redis.scan(cursor=cursor, match=self._scan_match, count=100)
            for k in keys:
                # redis-py with decode_responses=True returns str, otherwise bytes.
                key_str = k.decode("utf-8") if isinstance(k, (bytes, bytearray)) else k
                peer_uuid = key_str.rsplit(":", 1)[-1]
                peer_uuids.append(peer_uuid)
            if cursor == 0:
                break

        if not peer_uuids:
            # Should never happen (we just SET our own key) but be defensive.
            peer_uuids = [self._instance_uuid]

        peer_uuids = sorted(set(peer_uuids))
        try:
            rank = peer_uuids.index(self._instance_uuid)
        except ValueError:
            # Our key was evicted between SET and SCAN — treat as solo peer.
            peer_uuids = [self._instance_uuid]
            rank = 0
        total = len(peer_uuids)

        # 3) Publish layout change if (rank, total) flipped.
        with self._lock:
            old = self._layout
            self._layout = ShardLayout(rank=rank, total=total, peers=peer_uuids)
            changed = (old.rank != rank) or (old.total != total)

        if changed and not first_pass:
            logger.info(
                "[Shard/%s] Layout changed: rank %d/%d -> %d/%d (peers=%d)",
                self._gateway_type,
                old.rank,
                old.total,
                rank,
                total,
                total,
            )
            if self._on_layout_change is not None:
                try:
                    self._on_layout_change(old, ShardLayout(rank, total, list(peer_uuids)))
                except Exception as e:  # pragma: no cover — defensive
                    logger.warning(
                        "[Shard/%s] on_layout_change callback raised: %s",
                        self._gateway_type,
                        e,
                    )


def maybe_create_from_env(
    redis_client,
    gateway_type: str,
    legacy_total_instances: int,
) -> Optional[ShardCoordinator]:
    """Convenience constructor respecting legacy flags.

    Rules:
    * ``DDS_DYNAMIC_SHARDING=true`` (default when not set to "false" and
      ``legacy_total_instances <= 1``) -> dynamic mode.
    * ``DDS_DYNAMIC_SHARDING=false`` -> return ``None`` (use legacy static
      sharding with --instance-id / --total-instances).
    * If both dynamic=true and legacy_total_instances>1 are given, dynamic
      wins and a warning is emitted — there is no sane way to honour both.
    """
    raw = os.environ.get("DDS_DYNAMIC_SHARDING", "").strip().lower()
    if raw == "false" or raw == "0":
        return None
    # Default ON when legacy is not explicitly configured.
    if raw in ("", "true", "1", "yes", "on"):
        if legacy_total_instances > 1 and raw == "":
            logger.info(
                "[Shard/%s] legacy --total-instances=%d given; keeping static sharding. "
                "Set DDS_DYNAMIC_SHARDING=true to opt into dynamic sharding.",
                gateway_type,
                legacy_total_instances,
            )
            return None
        if legacy_total_instances > 1 and raw in ("true", "1", "yes", "on"):
            logger.warning(
                "[Shard/%s] Both DDS_DYNAMIC_SHARDING=true and --total-instances=%d provided; "
                "dynamic sharding wins and legacy values are ignored.",
                gateway_type,
                legacy_total_instances,
            )
        hb = float(os.environ.get("DDS_SHARD_HEARTBEAT_SEC", "5"))
        ttl = int(os.environ.get("DDS_SHARD_TTL_SEC", "15"))
        return ShardCoordinator(
            redis_client=redis_client,
            gateway_type=gateway_type,
            heartbeat_interval=hb,
            ttl_seconds=ttl,
        )
    logger.warning(
        "[Shard/%s] Unrecognised DDS_DYNAMIC_SHARDING=%s — defaulting to static mode",
        gateway_type,
        raw,
    )
    return None


def compute_rank(peers: List[str], instance_uuid: str) -> Tuple[int, int]:
    """Pure helper exposed for unit tests.

    Returns (rank, total) for ``instance_uuid`` given a peer list.
    """
    ordered = sorted(set(peers))
    return ordered.index(instance_uuid), len(ordered)
