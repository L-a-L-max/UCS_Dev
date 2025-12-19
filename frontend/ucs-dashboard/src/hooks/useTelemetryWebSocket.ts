import { useEffect, useRef, useCallback, useState } from 'react';
import { Client, IMessage } from '@stomp/stompjs';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8080';

// Convert HTTP URL to WebSocket URL
const getWsUrl = () => {
  const url = new URL(API_BASE);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${url.host}/ws`;
};

export interface TelemetryData {
  uavId: number;
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

interface UseTelemetryWebSocketOptions {
  enabled?: boolean;
  onTelemetryReceived?: (batch: TelemetryBatch) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export function useTelemetryWebSocket(options: UseTelemetryWebSocketOptions = {}) {
  const { enabled = true, onTelemetryReceived, onConnectionChange } = options;
  const clientRef = useRef<Client | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastBatch, setLastBatch] = useState<TelemetryBatch | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleMessage = useCallback((message: IMessage) => {
    try {
      const batch: TelemetryBatch = JSON.parse(message.body);
      setLastBatch(batch);
      onTelemetryReceived?.(batch);
    } catch (error) {
      console.error('Failed to parse telemetry message:', error);
    }
  }, [onTelemetryReceived]);

  const connect = useCallback(() => {
    if (clientRef.current?.active) {
      return;
    }

    const wsUrl = getWsUrl();
    console.log('Connecting to WebSocket:', wsUrl);

    const client = new Client({
      brokerURL: wsUrl,
      reconnectDelay: 5000,
      heartbeatIncoming: 4000,
      heartbeatOutgoing: 4000,
      onConnect: () => {
        console.log('WebSocket connected');
        setConnected(true);
        onConnectionChange?.(true);
        
        // Subscribe to telemetry topic
        client.subscribe('/topic/telemetry', handleMessage);
      },
      onDisconnect: () => {
        console.log('WebSocket disconnected');
        setConnected(false);
        onConnectionChange?.(false);
      },
      onStompError: (frame) => {
        console.error('STOMP error:', frame.headers['message']);
        setConnected(false);
        onConnectionChange?.(false);
      },
      onWebSocketError: (event) => {
        console.error('WebSocket error:', event);
        setConnected(false);
        onConnectionChange?.(false);
      },
    });

    clientRef.current = client;
    client.activate();
  }, [handleMessage, onConnectionChange]);

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
  }, [enabled, connect, disconnect]);

  return {
    connected,
    lastBatch,
    connect,
    disconnect,
  };
}

export default useTelemetryWebSocket;
