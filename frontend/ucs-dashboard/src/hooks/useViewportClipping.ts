import { useCallback, useRef, useEffect } from 'react';
import { Client } from '@stomp/stompjs';

/**
 * Phase 4.4: 视口裁剪 + 降采样 Hook
 *
 * 功能：
 * 1. 监听地图 moveend 事件，获取当前视口边界
 * 2. 通过 WebSocket STOMP 发送视口信息到后端 /app/viewport/update
 * 3. 后端根据视口过滤无人机，只推送视口内的无人机数据
 * 4. 降采样：根据缩放级别自动调整推送频率
 *    - zoom >= 15 (近): 10Hz 全速率
 *    - zoom 10~14 (中): 2Hz
 *    - zoom < 10 (远): 0.5Hz
 *
 * 用法：
 *   const { sendViewportUpdate, handleMapMoveEnd } = useViewportClipping(stompClientRef);
 *   // 在地图 moveend 事件中调用:
 *   map.on('moveend', () => handleMapMoveEnd(map));
 */

export interface ViewportBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  zoomLevel: number;
}

interface UseViewportClippingOptions {
  /** STOMP client ref (from useTelemetryWebSocket) */
  stompClient?: Client | null;
  /** Debounce interval in ms (default 300ms to avoid flooding) */
  debounceMs?: number;
  /** Callback when viewport updates are sent */
  onViewportUpdate?: (bounds: ViewportBounds) => void;
  /** Callback when visible drone list is received */
  onVisibleDronesReceived?: (droneIds: string[]) => void;
}

export function useViewportClipping(options: UseViewportClippingOptions = {}) {
  const { stompClient, debounceMs = 300, onViewportUpdate, onVisibleDronesReceived } = options;
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastViewportRef = useRef<ViewportBounds | null>(null);
  const onViewportUpdateRef = useRef(onViewportUpdate);
  const onVisibleDronesReceivedRef = useRef(onVisibleDronesReceived);

  useEffect(() => { onViewportUpdateRef.current = onViewportUpdate; }, [onViewportUpdate]);
  useEffect(() => { onVisibleDronesReceivedRef.current = onVisibleDronesReceived; }, [onVisibleDronesReceived]);

  /**
   * Send viewport bounds to backend via STOMP.
   */
  const sendViewportUpdate = useCallback((bounds: ViewportBounds) => {
    if (!stompClient?.connected) {
      console.debug('[Viewport] STOMP not connected, skipping viewport update');
      return;
    }

    try {
      stompClient.publish({
        destination: '/app/viewport/update',
        body: JSON.stringify(bounds),
      });
      lastViewportRef.current = bounds;
      onViewportUpdateRef.current?.(bounds);
      console.debug(
        `[Viewport] Sent: zoom=${bounds.zoomLevel}, bounds=[${bounds.minLat.toFixed(4)},${bounds.maxLat.toFixed(4)},${bounds.minLon.toFixed(4)},${bounds.maxLon.toFixed(4)}]`
      );
    } catch (error) {
      console.error('[Viewport] Failed to send viewport update:', error);
    }
  }, [stompClient]);

  /**
   * Handle map moveend event with debouncing.
   * Pass the maplibre-gl Map instance.
   *
   * Usage: map.on('moveend', () => handleMapMoveEnd(map));
   */
  const handleMapMoveEnd = useCallback((mapInstance: { getBounds: () => { getSouthWest: () => { lat: number; lng: number }; getNorthEast: () => { lat: number; lng: number } }; getZoom: () => number }) => {
    // Clear previous debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      const bounds = mapInstance.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const zoom = Math.round(mapInstance.getZoom());

      const viewport: ViewportBounds = {
        minLat: sw.lat,
        maxLat: ne.lat,
        minLon: sw.lng,
        maxLon: ne.lng,
        zoomLevel: zoom,
      };

      sendViewportUpdate(viewport);
    }, debounceMs);
  }, [sendViewportUpdate, debounceMs]);

  /**
   * Get the current push frequency description based on zoom level.
   */
  const getPushFrequencyLabel = useCallback((zoomLevel: number): string => {
    if (zoomLevel >= 15) return '10Hz (全速率)';
    if (zoomLevel >= 10) return '2Hz (中等)';
    return '0.5Hz (低频)';
  }, []);

  /**
   * Get the last sent viewport bounds.
   */
  const getLastViewport = useCallback((): ViewportBounds | null => {
    return lastViewportRef.current;
  }, []);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    sendViewportUpdate,
    handleMapMoveEnd,
    getPushFrequencyLabel,
    getLastViewport,
  };
}

export default useViewportClipping;
