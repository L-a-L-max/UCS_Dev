import { useEffect, useRef, useCallback, useState } from 'react';
import { Client, IMessage, StompSubscription } from '@stomp/stompjs';

/**
 * T-37: WebSocket 增量推送 Hook
 *
 * 替代全量广播方式，采用两级订阅模型：
 * 1. /topic/drones/summary — 摘要频道（5s 推送一次全局汇总：在线数、低电量数等）
 * 2. /topic/drone/{uavId}  — 单机频道（选中/视口内的无人机实时遥测，1s 推送）
 *
 * 视口感知：根据地图可视范围自动订阅/取消订阅单机频道，
 * 只接收当前屏幕上可见的无人机数据，大幅减少 WebSocket 流量。
 */

const getApiBase = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return 'http://localhost:8080';
};

const API_BASE = getApiBase();

const getWsUrl = () => {
  const url = new URL(API_BASE);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}/ws/websocket`;
};

/** 全局摘要消息（低频，5s 间隔） */
export interface DroneSummaryMessage {
  timestamp: string;
  totalDrones: number;
  onlineDrones: number;
  flyingDrones: number;
  lowBatteryDrones: number;
  /** 简要无人机列表：仅包含 uavId + 位置 + 状态（用于地图概览渲染） */
  drones: Array<{
    uavId: string;
    lat: number;
    lon: number;
    alt: number;
    online: boolean;
    armed: boolean;
    batteryPercent?: number;
  }>;
}

/** 单机遥测消息（高频，1s 间隔，仅针对订阅的无人机） */
export interface DroneDetailMessage {
  uavId: string;
  timestamp: string;
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  groundSpeed: number;
  verticalSpeed: number;
  nedX: number;
  nedY: number;
  nedZ: number;
  vx: number;
  vy: number;
  vz: number;
  batteryPercent?: number;
  armed: boolean;
  flightMode: string;
  dataAge: number;
  msgCount: number;
}

interface UseIncrementalWebSocketOptions {
  enabled?: boolean;
  /** 当前选中的无人机（始终订阅其单机频道） */
  selectedDroneId?: string | null;
  /** 视口内可见的无人机 ID 列表（自动订阅/取消订阅） */
  visibleDroneIds?: string[];
  /** 最大同时订阅的单机频道数（防止视口内无人机过多） */
  maxDetailSubscriptions?: number;
  onSummaryReceived?: (summary: DroneSummaryMessage) => void;
  onDroneDetailReceived?: (detail: DroneDetailMessage) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export function useIncrementalWebSocket(options: UseIncrementalWebSocketOptions = {}) {
  const {
    enabled = true,
    selectedDroneId,
    visibleDroneIds = [],
    maxDetailSubscriptions = 50,
    onSummaryReceived,
    onDroneDetailReceived,
    onConnectionChange,
  } = options;

  const clientRef = useRef<Client | null>(null);
  const [connected, setConnected] = useState(false);

  // Track active drone-level subscriptions
  const droneSubscriptionsRef = useRef<Map<string, StompSubscription>>(new Map());

  // Refs for latest callback values
  const onSummaryReceivedRef = useRef(onSummaryReceived);
  const onDroneDetailReceivedRef = useRef(onDroneDetailReceived);
  const onConnectionChangeRef = useRef(onConnectionChange);

  useEffect(() => { onSummaryReceivedRef.current = onSummaryReceived; }, [onSummaryReceived]);
  useEffect(() => { onDroneDetailReceivedRef.current = onDroneDetailReceived; }, [onDroneDetailReceived]);
  useEffect(() => { onConnectionChangeRef.current = onConnectionChange; }, [onConnectionChange]);

  // Handle summary messages
  const handleSummary = useCallback((message: IMessage) => {
    try {
      const summary: DroneSummaryMessage = JSON.parse(message.body);
      onSummaryReceivedRef.current?.(summary);
    } catch (error) {
      console.error('[WS-Incremental] Failed to parse summary:', error);
    }
  }, []);

  // Handle individual drone detail messages
  const handleDroneDetail = useCallback((message: IMessage) => {
    try {
      const detail: DroneDetailMessage = JSON.parse(message.body);
      onDroneDetailReceivedRef.current?.(detail);
    } catch (error) {
      console.error('[WS-Incremental] Failed to parse drone detail:', error);
    }
  }, []);

  // Subscribe to a specific drone's detail channel
  const subscribeDrone = useCallback((uavId: string) => {
    const client = clientRef.current;
    if (!client?.active) return;
    if (droneSubscriptionsRef.current.has(uavId)) return; // Already subscribed

    const topic = `/topic/drone/${uavId}`;
    const sub = client.subscribe(topic, handleDroneDetail);
    droneSubscriptionsRef.current.set(uavId, sub);
    console.log('[WS-Incremental] Subscribed to drone:', uavId);
  }, [handleDroneDetail]);

  // Unsubscribe from a specific drone's detail channel
  const unsubscribeDrone = useCallback((uavId: string) => {
    const sub = droneSubscriptionsRef.current.get(uavId);
    if (sub) {
      sub.unsubscribe();
      droneSubscriptionsRef.current.delete(uavId);
      console.log('[WS-Incremental] Unsubscribed from drone:', uavId);
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (clientRef.current?.active) return;

    const wsUrl = getWsUrl();
    console.log('[WS-Incremental] Connecting to:', wsUrl);

    const client = new Client({
      brokerURL: wsUrl,
      reconnectDelay: 5000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      onConnect: () => {
        console.log('[WS-Incremental] Connected');
        setConnected(true);
        onConnectionChangeRef.current?.(true);

        // Always subscribe to summary channel (low frequency, 5s)
        client.subscribe('/topic/drones/summary', handleSummary);
        console.log('[WS-Incremental] Subscribed to /topic/drones/summary');
      },
      onDisconnect: () => {
        console.log('[WS-Incremental] Disconnected');
        setConnected(false);
        onConnectionChangeRef.current?.(false);
        droneSubscriptionsRef.current.clear();
      },
      onStompError: (frame) => {
        console.error('[WS-Incremental] STOMP error:', frame.headers['message']);
        setConnected(false);
        onConnectionChangeRef.current?.(false);
      },
      onWebSocketError: (event) => {
        console.error('[WS-Incremental] WebSocket error:', event);
        setConnected(false);
        onConnectionChangeRef.current?.(false);
      },
    });

    clientRef.current = client;
    client.activate();
  }, [handleSummary]);

  const disconnect = useCallback(() => {
    // Unsubscribe all drone channels
    droneSubscriptionsRef.current.forEach((sub) => sub.unsubscribe());
    droneSubscriptionsRef.current.clear();

    if (clientRef.current) {
      clientRef.current.deactivate();
      clientRef.current = null;
    }
    setConnected(false);
  }, []);

  // Lifecycle: connect/disconnect based on enabled flag
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }
    return () => { disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Viewport-aware subscription management
  // Whenever visibleDroneIds or selectedDroneId changes, reconcile subscriptions
  useEffect(() => {
    if (!connected || !clientRef.current?.active) return;

    // Build the desired set of subscribed drones
    const desiredSet = new Set<string>();

    // Selected drone always subscribed
    if (selectedDroneId) {
      desiredSet.add(selectedDroneId);
    }

    // Add visible drones up to max limit
    for (const id of visibleDroneIds) {
      if (desiredSet.size >= maxDetailSubscriptions) break;
      desiredSet.add(id);
    }

    // Unsubscribe drones no longer in desired set
    const currentSubs = droneSubscriptionsRef.current;
    for (const uavId of currentSubs.keys()) {
      if (!desiredSet.has(uavId)) {
        unsubscribeDrone(uavId);
      }
    }

    // Subscribe new drones
    for (const uavId of desiredSet) {
      subscribeDrone(uavId);
    }
  }, [connected, selectedDroneId, visibleDroneIds, maxDetailSubscriptions, subscribeDrone, unsubscribeDrone]);

  return {
    connected,
    connect,
    disconnect,
    /** Manually subscribe to a drone (e.g., on hover) */
    subscribeDrone,
    /** Manually unsubscribe from a drone */
    unsubscribeDrone,
    /** Number of active drone-level subscriptions */
    activeSubscriptions: droneSubscriptionsRef.current.size,
  };
}

export default useIncrementalWebSocket;
