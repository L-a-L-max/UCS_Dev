import { useRef, useCallback, useState, useEffect } from 'react';

/**
 * Phase 5: WebSocket Resilience Hook
 *
 * Provides exponential backoff reconnection strategy for WebSocket connections.
 * Tracks connection state and retry attempts for UI feedback.
 */

export type ConnectionState = 'connected' | 'reconnecting' | 'failed';

interface UseWebSocketResilienceOptions {
  /** Max number of reconnection attempts before giving up */
  maxRetries?: number;
  /** Initial delay between retries in ms */
  initialDelay?: number;
  /** Maximum delay between retries in ms */
  maxDelay?: number;
  /** Backoff multiplier */
  backoffMultiplier?: number;
  /** Callback when connection state changes */
  onStateChange?: (state: ConnectionState) => void;
}

interface UseWebSocketResilienceReturn {
  connectionState: ConnectionState;
  retryCount: number;
  nextRetryIn: number; // seconds until next retry
  resetRetries: () => void;
  recordSuccess: () => void;
  recordFailure: () => { shouldRetry: boolean; delay: number };
  getBackoffDelay: () => number;
}

export function useWebSocketResilience(
  options: UseWebSocketResilienceOptions = {}
): UseWebSocketResilienceReturn {
  const {
    maxRetries = 10,
    initialDelay = 1000,
    maxDelay = 30000,
    backoffMultiplier = 2,
    onStateChange,
  } = options;

  const [connectionState, setConnectionState] = useState<ConnectionState>('reconnecting');
  const [retryCount, setRetryCount] = useState(0);
  const [nextRetryIn, setNextRetryIn] = useState(0);
  const retryCountRef = useRef(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onStateChangeRef = useRef(onStateChange);

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  const updateState = useCallback((state: ConnectionState) => {
    setConnectionState(state);
    onStateChangeRef.current?.(state);
  }, []);

  const getBackoffDelay = useCallback(() => {
    const delay = Math.min(
      initialDelay * Math.pow(backoffMultiplier, retryCountRef.current),
      maxDelay
    );
    // Add jitter: ±25% randomization to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }, [initialDelay, maxDelay, backoffMultiplier]);

  const startCountdown = useCallback((delayMs: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    let remaining = Math.ceil(delayMs / 1000);
    setNextRetryIn(remaining);
    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setNextRetryIn(Math.max(0, remaining));
      if (remaining <= 0 && countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }, 1000);
  }, []);

  const recordSuccess = useCallback(() => {
    retryCountRef.current = 0;
    setRetryCount(0);
    setNextRetryIn(0);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    updateState('connected');
  }, [updateState]);

  const recordFailure = useCallback((): { shouldRetry: boolean; delay: number } => {
    retryCountRef.current += 1;
    const count = retryCountRef.current;
    setRetryCount(count);

    if (count > maxRetries) {
      updateState('failed');
      return { shouldRetry: false, delay: 0 };
    }

    const delay = getBackoffDelay();
    updateState('reconnecting');
    startCountdown(delay);
    return { shouldRetry: true, delay };
  }, [maxRetries, getBackoffDelay, startCountdown, updateState]);

  const resetRetries = useCallback(() => {
    retryCountRef.current = 0;
    setRetryCount(0);
    setNextRetryIn(0);
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    updateState('reconnecting');
  }, [updateState]);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  return {
    connectionState,
    retryCount,
    nextRetryIn,
    resetRetries,
    recordSuccess,
    recordFailure,
    getBackoffDelay,
  };
}

export default useWebSocketResilience;
