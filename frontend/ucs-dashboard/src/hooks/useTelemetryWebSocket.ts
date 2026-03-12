import { useEffect, useRef, useCallback, useState } from 'react';
import { Client, IMessage } from '@stomp/stompjs';

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

// Convert HTTP URL to WebSocket URL
// Use /ws/websocket path for raw WebSocket through SockJS transport layer.
// Spring Boot registers SockJS at /ws which intercepts raw /ws connections;
// the actual raw WebSocket endpoint is at /ws/websocket.
const getWsUrl = () => {
  const url = new URL(API_BASE);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}/ws/websocket`;
};

export interface TelemetryData {
  uavId: string;
  uavName: string;
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
  dataAge: number;
  msgCount: number;
  isActive: boolean;
  armed: boolean;
  flightMode: string;
}

export interface TelemetryBatch {
  timestamp: string;
  msgSeqNumber: number;
  homeLat: number;
  homeLon: number;
  homeAlt: number;
  numUavsTotal: number;
  numUavsActive: number;
  uavs: TelemetryData[];
}

/**
 * Partition-specific telemetry message from server routing gateway.
 */
export interface PartitionTelemetryMessage {
  partition: string;
  timestamp: string;
  type?: string; // 'drone_removed' for removal notifications
  drones: TelemetryData[];
  removedDrones?: string[]; // uavIds removed from this partition
}

interface UseTelemetryWebSocketOptions {
  enabled?: boolean;
  partitions?: string[];
  onTelemetryReceived?: (batch: TelemetryBatch) => void;
  onPartitionDataReceived?: (data: PartitionTelemetryMessage) => void;
  onDroneRemoved?: (removedUavIds: string[]) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export function useTelemetryWebSocket(options: UseTelemetryWebSocketOptions = {}) {
  const { enabled = true, partitions, onTelemetryReceived, onPartitionDataReceived, onDroneRemoved, onConnectionChange } = options;
  const clientRef = useRef<Client | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastBatch, setLastBatch] = useState<TelemetryBatch | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Use refs for callbacks and partitions to avoid recreating connect/disconnect on every render
  const onTelemetryReceivedRef = useRef(onTelemetryReceived);
  const onPartitionDataReceivedRef = useRef(onPartitionDataReceived);
  const onDroneRemovedRef = useRef(onDroneRemoved);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const partitionsRef = useRef(partitions);

  // Keep refs in sync with latest props
  useEffect(() => { onTelemetryReceivedRef.current = onTelemetryReceived; }, [onTelemetryReceived]);
  useEffect(() => { onPartitionDataReceivedRef.current = onPartitionDataReceived; }, [onPartitionDataReceived]);
  useEffect(() => { onDroneRemovedRef.current = onDroneRemoved; }, [onDroneRemoved]);
  useEffect(() => { onConnectionChangeRef.current = onConnectionChange; }, [onConnectionChange]);
  useEffect(() => { partitionsRef.current = partitions; }, [partitions]);

  const handleMessage = useCallback((message: IMessage) => {
    try {
      const batch: TelemetryBatch = JSON.parse(message.body);
      setLastBatch(batch);
      onTelemetryReceivedRef.current?.(batch);
    } catch (error) {
      console.error('Failed to parse telemetry message:', error);
    }
  }, []);

  const handlePartitionMessage = useCallback((message: IMessage) => {
    try {
      const data: PartitionTelemetryMessage = JSON.parse(message.body);
      // Handle drone removal notifications
      if (data.type === 'drone_removed' && data.removedDrones && data.removedDrones.length > 0) {
        console.log('[WS] Drone removal notification:', data.partition, 'removed:', data.removedDrones);
        onDroneRemovedRef.current?.(data.removedDrones);
        return;
      }
      console.log('[WS] Partition message received:', data.partition, 'drones:', data.drones?.length, data.drones?.map(d => `${d.uavId}(${d.lat},${d.lon},armed=${d.armed})`));
      onPartitionDataReceivedRef.current?.(data);
    } catch (error) {
      console.error('Failed to parse partition telemetry message:', error);
    }
  }, []);

  const connect = useCallback(() => {
    if (clientRef.current?.active) {
      return;
    }

    const wsUrl = getWsUrl();
    console.log('[WS] Connecting to WebSocket:', wsUrl);

    const currentPartitions = partitionsRef.current;

    const client = new Client({
      brokerURL: wsUrl,
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      onConnect: () => {
        console.log('[WS] WebSocket connected');
        setConnected(true);
        onConnectionChangeRef.current?.(true);
        
        // Subscribe to legacy telemetry topic (backward compatibility)
        client.subscribe('/topic/telemetry', handleMessage);
        console.log('[WS] Subscribed to /topic/telemetry');
        
        // Subscribe to partition-specific topics if partitions are provided
        if (currentPartitions && currentPartitions.length > 0) {
          console.log('[WS] Subscribing to partition topics:', currentPartitions);
          currentPartitions.forEach(partition => {
            const topic = `/topic/telemetry/partition/${partition}`;
            console.log('[WS] Subscribing to:', topic);
            client.subscribe(topic, handlePartitionMessage);
          });
        } else {
          console.warn('[WS] No partitions provided, partition topics will not be subscribed');
        }
      },
      onDisconnect: () => {
        console.log('[WS] WebSocket disconnected');
        setConnected(false);
        onConnectionChangeRef.current?.(false);
      },
      onStompError: (frame) => {
        console.error('[WS] STOMP error:', frame.headers['message']);
        setConnected(false);
        onConnectionChangeRef.current?.(false);
      },
      onWebSocketError: (event) => {
        console.error('[WS] WebSocket error:', event);
        setConnected(false);
        onConnectionChangeRef.current?.(false);
      },
    });

    clientRef.current = client;
    client.activate();
  }, [handleMessage, handlePartitionMessage]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    if (clientRef.current) {
      clientRef.current.deactivate();
      clientRef.current = null;
    }
    
    setConnected(false);
  }, []);

  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    connected,
    lastBatch,
    connect,
    disconnect,
  };
}

export default useTelemetryWebSocket;
