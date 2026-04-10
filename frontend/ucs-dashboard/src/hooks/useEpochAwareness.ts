import { useRef, useCallback, useState } from 'react';

/**
 * Phase 5: Epoch Awareness Hook
 *
 * Tracks message epochs for distributed message ordering.
 * Detects epoch transitions (e.g. backend restart, partition rebalance)
 * and warns UI about potentially stale data.
 */

interface EpochInfo {
  /** Current epoch identifier */
  epoch: string;
  /** Timestamp of last epoch change */
  lastEpochChange: number;
  /** Whether current data may be stale due to recent epoch change */
  isStale: boolean;
  /** Last received message sequence number within current epoch */
  lastSeqNumber: number;
}

interface UseEpochAwarenessOptions {
  /** Duration in ms to consider data stale after epoch change (default 10s) */
  staleDuration?: number;
  /** Callback when epoch changes */
  onEpochChange?: (oldEpoch: string, newEpoch: string) => void;
}

interface UseEpochAwarenessReturn {
  epochInfo: EpochInfo;
  processMessage: (epoch: string, seqNumber: number) => { epochChanged: boolean; isOrdered: boolean };
  markFresh: () => void;
  reset: () => void;
}

export function useEpochAwareness(
  options: UseEpochAwarenessOptions = {}
): UseEpochAwarenessReturn {
  const { staleDuration = 10000, onEpochChange } = options;
  const onEpochChangeRef = useRef(onEpochChange);
  onEpochChangeRef.current = onEpochChange;

  const [epochInfo, setEpochInfo] = useState<EpochInfo>({
    epoch: '',
    lastEpochChange: 0,
    isStale: false,
    lastSeqNumber: -1,
  });

  const epochRef = useRef<EpochInfo>({
    epoch: '',
    lastEpochChange: 0,
    isStale: false,
    lastSeqNumber: -1,
  });

  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processMessage = useCallback(
    (epoch: string, seqNumber: number): { epochChanged: boolean; isOrdered: boolean } => {
      const current = epochRef.current;

      // First message ever
      if (!current.epoch) {
        const newInfo: EpochInfo = {
          epoch,
          lastEpochChange: Date.now(),
          isStale: false,
          lastSeqNumber: seqNumber,
        };
        epochRef.current = newInfo;
        setEpochInfo(newInfo);
        return { epochChanged: false, isOrdered: true };
      }

      // Epoch changed
      if (epoch !== current.epoch) {
        const oldEpoch = current.epoch;
        const newInfo: EpochInfo = {
          epoch,
          lastEpochChange: Date.now(),
          isStale: true,
          lastSeqNumber: seqNumber,
        };
        epochRef.current = newInfo;
        setEpochInfo(newInfo);

        // Clear stale flag after staleDuration
        if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
        staleTimerRef.current = setTimeout(() => {
          epochRef.current = { ...epochRef.current, isStale: false };
          setEpochInfo((prev) => ({ ...prev, isStale: false }));
        }, staleDuration);

        onEpochChangeRef.current?.(oldEpoch, epoch);
        return { epochChanged: true, isOrdered: true };
      }

      // Same epoch - check ordering
      const isOrdered = seqNumber >= current.lastSeqNumber;
      if (isOrdered) {
        const newInfo = { ...current, lastSeqNumber: seqNumber };
        epochRef.current = newInfo;
        setEpochInfo(newInfo);
      }

      return { epochChanged: false, isOrdered };
    },
    [staleDuration]
  );

  const markFresh = useCallback(() => {
    epochRef.current = { ...epochRef.current, isStale: false };
    setEpochInfo((prev) => ({ ...prev, isStale: false }));
  }, []);

  const reset = useCallback(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    const initial: EpochInfo = {
      epoch: '',
      lastEpochChange: 0,
      isStale: false,
      lastSeqNumber: -1,
    };
    epochRef.current = initial;
    setEpochInfo(initial);
  }, []);

  return { epochInfo, processMessage, markFresh, reset };
}

export default useEpochAwareness;
