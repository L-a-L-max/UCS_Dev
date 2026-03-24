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
  batteryPercent?: number;
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

/**
 * Command acknowledgment message from PX4 via DDS gateway -> backend -> WebSocket.
 * Used for two-stage command feedback:
 *   Stage 1: Backend accepted the command (immediate HTTP response)
 *   Stage 2: PX4 acknowledged execution (this WebSocket message)
 */
export interface CommandAckMessage {
  type: 'command_ack';
  uavId: string;
  command: number;
  result: number;
  resultText: string;
  timestamp: string;
}

/**
 * Drone status change message (online/offline) from DroneHeartbeatService.
 */
export interface DroneStatusMessage {
  type: 'drone_offline' | 'drone_online';
  uavId: string;
  timestamp: string;
  reason?: string;
}

interface UseTelemetryWebSocketOptions {
  enabled?: boolean;
  partitions?: string[];
  onTelemetryReceived?: (batch: TelemetryBatch) => void;
  onPartitionDataReceived?: (data: PartitionTelemetryMessage) => void;
  onDroneRemoved?: (removedUavIds: string[]) => void;
  onCommandAck?: (ack: CommandAckMessage) => void;
  onDroneStatusChange?: (status: DroneStatusMessage) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export function useTelemetryWebSocket(options: UseTelemetryWebSocketOptions = {}) {
  const { enabled = true, partitions, onTelemetryReceived, onPartitionDataReceived, onDroneRemoved, onCommandAck, onDroneStatusChange, onConnectionChange } = options;
  const clientRef = useRef<Client | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use refs for callbacks and partitions to avoid recreating connect/disconnect on every render
  const onTelemetryReceivedRef = useRef(onTelemetryReceived);
  const onPartitionDataReceivedRef = useRef(onPartitionDataReceived);
  const onDroneRemovedRef = useRef(onDroneRemoved);
  const onCommandAckRef = useRef(onCommandAck);
  const onDroneStatusChangeRef = useRef(onDroneStatusChange);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const partitionsRef = useRef(partitions);

  // Keep refs in sync with latest props
  useEffect(() => { onTelemetryReceivedRef.current = onTelemetryReceived; }, [onTelemetryReceived]);
  useEffect(() => { onPartitionDataReceivedRef.current = onPartitionDataReceived; }, [onPartitionDataReceived]);
  useEffect(() => { onDroneRemovedRef.current = onDroneRemoved; }, [onDroneRemoved]);
  useEffect(() => { onCommandAckRef.current = onCommandAck; }, [onCommandAck]);
  useEffect(() => { onDroneStatusChangeRef.current = onDroneStatusChange; }, [onDroneStatusChange]);
  useEffect(() => { onConnectionChangeRef.current = onConnectionChange; }, [onConnectionChange]);
  useEffect(() => { partitionsRef.current = partitions; }, [partitions]);

  // ==================== Buffer + Throttle ====================
  // Instead of calling setState on every WebSocket message (which triggers re-render),
  // we buffer partition data into a Map and flush at 10Hz (100ms).
  // This eliminates flickering caused by per-message React state updates.
  const partitionBufferRef = useRef<Map<string, TelemetryData>>(new Map());
  const partitionBufferDirtyRef = useRef(false);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPartitionBuffer = useCallback(() => {
    flushTimerRef.current = null;
    if (!partitionBufferDirtyRef.current) return;
    partitionBufferDirtyRef.current = false;

    // Build a synthetic PartitionTelemetryMessage from buffer snapshot
    const drones = Array.from(partitionBufferRef.current.values());
    if (drones.length === 0) return;

    const syntheticMsg: PartitionTelemetryMessage = {
      partition: '_buffered',
      timestamp: new Date().toISOString(),
      drones,
    };
    onPartitionDataReceivedRef.current?.(syntheticMsg);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!flushTimerRef.current) {
      flushTimerRef.current = setTimeout(flushPartitionBuffer, 100); // 10Hz
    }
  }, [flushPartitionBuffer]);

  // handleMessage: /topic/telemetry — NO setState, just callback
  const handleMessage = useCallback((message: IMessage) => {
    try {
      const batch: TelemetryBatch = JSON.parse(message.body);
      // Do NOT call setLastBatch — it causes React re-render on every message
      // which is the root cause of UI flickering.
      onTelemetryReceivedRef.current?.(batch);
    } catch (error) {
      console.error('Failed to parse telemetry message:', error);
    }
  }, []);

  // handlePartitionMessage: buffer data, flush at 10Hz instead of per-message setState
  const handlePartitionMessage = useCallback((message: IMessage) => {
    try {
      const data: PartitionTelemetryMessage = JSON.parse(message.body);
      // Handle drone removal notifications immediately (low frequency event)
      if (data.type === 'drone_removed' && data.removedDrones && data.removedDrones.length > 0) {
        data.removedDrones.forEach(id => partitionBufferRef.current.delete(id));
        onDroneRemovedRef.current?.(data.removedDrones);
        return;
      }
      // Buffer drone data — only keep latest per uavId
      if (data.drones) {
        data.drones.forEach(d => {
          partitionBufferRef.current.set(d.uavId, d);
        });
        partitionBufferDirtyRef.current = true;
        scheduleFlush();
      }
    } catch (error) {
      console.error('Failed to parse partition telemetry message:', error);
    }
  }, [scheduleFlush]);

  const handleCommandAck = useCallback((message: IMessage) => {
    try {
      const ack: CommandAckMessage = JSON.parse(message.body);
      console.log('[WS] Command ack received:', ack.uavId, 'result:', ack.resultText);
      onCommandAckRef.current?.(ack);
    } catch (error) {
      console.error('Failed to parse command ack message:', error);
    }
  }, []);

  // Handle drone status changes (online/offline from DroneHeartbeatService)
  const handleDroneStatus = useCallback((message: IMessage) => {
    try {
      const status: DroneStatusMessage = JSON.parse(message.body);
      console.log('[WS] Drone status:', status.uavId, status.type);
      // Remove offline drones from buffer
      if (status.type === 'drone_offline') {
        partitionBufferRef.current.delete(status.uavId);
        onDroneRemovedRef.current?.([status.uavId]);
      }
      onDroneStatusChangeRef.current?.(status);
    } catch (error) {
      console.error('Failed to parse drone status message:', error);
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
        
        // Subscribe to command acknowledgment topic
        client.subscribe('/topic/command-ack', handleCommandAck);
        console.log('[WS] Subscribed to /topic/command-ack');
        
        // Subscribe to drone status topic (online/offline from heartbeat service)
        client.subscribe('/topic/drone-status', handleDroneStatus);
        console.log('[WS] Subscribed to /topic/drone-status');
        
        // Subscribe to partition-specific topics if partitions are provided
        if (currentPartitions && currentPartitions.length > 0) {
          console.log('[WS] Subscribing to partition topics:', currentPartitions);
          currentPartitions.forEach(partition => {
            const topic = `/topic/telemetry/partition/${partition}`;
            console.log('[WS] Subscribing to:', topic);
            client.subscribe(topic, handlePartitionMessage);
            // Subscribe to partition-specific command acks
            client.subscribe(`/topic/command-ack/partition/${partition}`, handleCommandAck);
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
  }, [handleMessage, handlePartitionMessage, handleCommandAck, handleDroneStatus]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    // Clean up flush timer
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
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
    connect,
    disconnect,
  };
}

export default useTelemetryWebSocket;
