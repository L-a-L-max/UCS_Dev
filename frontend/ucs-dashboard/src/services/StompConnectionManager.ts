import { Client, IFrame, IMessage, StompSubscription } from '@stomp/stompjs';

/**
 * T-40: STOMP 重连与降级策略（StompConnectionManager）
 *
 * 核心机制：
 * 1. 心跳检测：incoming/outgoing 各 10s，检测连接活性
 * 2. 指数退避重连：1s → 2s → 4s → ... → 30s（带 ±25% 抖动）
 * 3. 最大重连次数：10次（约 5 分钟内尝试恢复）
 * 4. REST 降级：WebSocket 彻底失败后，切换为 REST 轮询（3s 间隔）
 * 5. 自动恢复：降级期间持续尝试恢复 WebSocket 连接
 *
 * 连接状态机：
 *   CONNECTING → CONNECTED → (断开) → RECONNECTING → (重连成功) → CONNECTED
 *                                    → (超过10次) → DEGRADED (REST轮询)
 *                                    → (WebSocket恢复) → CONNECTED
 */

const getApiBase = () => {
  if (typeof import !== 'undefined' && import.meta?.env?.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:8080`;
  }
  return 'http://localhost:8080';
};

const API_BASE = getApiBase();

export type StompConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'degraded' | 'disconnected';

export interface StompManagerOptions {
  /** WebSocket URL (auto-detected from API_BASE if not provided) */
  wsUrl?: string;
  /** REST API base URL for fallback polling */
  restApiUrl?: string;
  /** Heartbeat interval for incoming messages (ms) */
  heartbeatIncoming?: number;
  /** Heartbeat interval for outgoing messages (ms) */
  heartbeatOutgoing?: number;
  /** Initial reconnect delay (ms) */
  reconnectDelay?: number;
  /** Maximum reconnect delay (ms) */
  maxReconnectDelay?: number;
  /** Backoff multiplier */
  backoffMultiplier?: number;
  /** Maximum reconnect attempts before degrading to REST */
  maxReconnectAttempts?: number;
  /** REST polling interval when degraded (ms) */
  restPollingInterval?: number;
  /** REST recovery check interval — try to restore WebSocket while in degraded mode (ms) */
  restRecoveryCheckInterval?: number;
  /** Connection state change callback */
  onStateChange?: (state: StompConnectionState) => void;
  /** Error callback */
  onError?: (error: string) => void;
}

interface SubscriptionRecord {
  topic: string;
  callback: (message: IMessage) => void;
  subscription?: StompSubscription;
}

export class StompConnectionManager {
  private client: Client | null = null;
  private state: StompConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private restPollingTimer: ReturnType<typeof setInterval> | null = null;
  private restRecoveryTimer: ReturnType<typeof setInterval> | null = null;

  // Subscription registry (survives reconnections)
  private subscriptions: Map<string, SubscriptionRecord> = new Map();
  // REST polling callbacks (used in degraded mode)
  private restPollingCallbacks: Map<string, (data: unknown) => void> = new Map();

  private readonly options: Required<StompManagerOptions>;

  constructor(opts: StompManagerOptions = {}) {
    const wsUrl = opts.wsUrl || this.buildWsUrl();
    this.options = {
      wsUrl,
      restApiUrl: opts.restApiUrl || `${API_BASE}/api`,
      heartbeatIncoming: opts.heartbeatIncoming ?? 10000,
      heartbeatOutgoing: opts.heartbeatOutgoing ?? 10000,
      reconnectDelay: opts.reconnectDelay ?? 1000,
      maxReconnectDelay: opts.maxReconnectDelay ?? 30000,
      backoffMultiplier: opts.backoffMultiplier ?? 2,
      maxReconnectAttempts: opts.maxReconnectAttempts ?? 10,
      restPollingInterval: opts.restPollingInterval ?? 3000,
      restRecoveryCheckInterval: opts.restRecoveryCheckInterval ?? 30000,
      onStateChange: opts.onStateChange || (() => {}),
      onError: opts.onError || ((err) => console.error('[StompManager]', err)),
    };
  }

  private buildWsUrl(): string {
    const url = new URL(API_BASE);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}/ws/websocket`;
  }

  /** Get current connection state */
  getState(): StompConnectionState {
    return this.state;
  }

  /** Check if currently connected via WebSocket */
  isConnected(): boolean {
    return this.state === 'connected';
  }

  /** Check if in degraded (REST polling) mode */
  isDegraded(): boolean {
    return this.state === 'degraded';
  }

  private setState(newState: StompConnectionState) {
    if (this.state !== newState) {
      const oldState = this.state;
      this.state = newState;
      console.log(`[StompManager] State: ${oldState} → ${newState}`);
      this.options.onStateChange(newState);
    }
  }

  /**
   * Connect to STOMP WebSocket
   */
  connect(): void {
    if (this.client?.active) {
      console.log('[StompManager] Already connected');
      return;
    }

    this.setState('connecting');

    this.client = new Client({
      brokerURL: this.options.wsUrl,
      heartbeatIncoming: this.options.heartbeatIncoming,
      heartbeatOutgoing: this.options.heartbeatOutgoing,
      // Disable built-in reconnect — we handle it ourselves with backoff + degradation
      reconnectDelay: 0,

      onConnect: () => {
        console.log('[StompManager] STOMP connected');
        this.reconnectAttempts = 0;
        this.setState('connected');
        this.stopRestPolling();
        this.stopRecoveryCheck();
        // Re-subscribe all registered topics
        this.resubscribeAll();
      },

      onDisconnect: () => {
        console.log('[StompManager] STOMP disconnected');
        if (this.state !== 'disconnected') {
          this.handleDisconnect();
        }
      },

      onStompError: (frame: IFrame) => {
        const errMsg = frame.headers['message'] || 'Unknown STOMP error';
        console.error('[StompManager] STOMP error:', errMsg);
        this.options.onError(`STOMP error: ${errMsg}`);
        this.handleDisconnect();
      },

      onWebSocketError: (event: Event) => {
        console.error('[StompManager] WebSocket error:', event);
        this.options.onError('WebSocket connection error');
        this.handleDisconnect();
      },

      onWebSocketClose: () => {
        if (this.state === 'connected' || this.state === 'connecting') {
          this.handleDisconnect();
        }
      },
    });

    this.client.activate();
  }

  /**
   * Disconnect and clean up all resources
   */
  disconnect(): void {
    this.setState('disconnected');
    this.reconnectAttempts = 0;
    this.clearReconnectTimer();
    this.stopRestPolling();
    this.stopRecoveryCheck();

    // Clear subscription references (but keep registry for potential reconnect)
    this.subscriptions.forEach((record) => {
      record.subscription = undefined;
    });

    if (this.client) {
      try {
        this.client.deactivate();
      } catch {
        // Ignore deactivation errors
      }
      this.client = null;
    }
  }

  /**
   * Subscribe to a STOMP topic
   * The subscription is automatically restored after reconnection
   */
  subscribe(topic: string, callback: (message: IMessage) => void): string {
    const subId = `sub-${topic}-${Date.now()}`;

    const record: SubscriptionRecord = { topic, callback };
    this.subscriptions.set(subId, record);

    // If already connected, subscribe immediately
    if (this.client?.active) {
      record.subscription = this.client.subscribe(topic, callback);
    }

    return subId;
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(subId: string): void {
    const record = this.subscriptions.get(subId);
    if (record) {
      if (record.subscription) {
        try { record.subscription.unsubscribe(); } catch { /* ignore */ }
      }
      this.subscriptions.delete(subId);
    }
  }

  /**
   * Register a REST polling callback for degraded mode
   * When WebSocket fails, this endpoint is polled at restPollingInterval
   */
  registerRestFallback(endpoint: string, callback: (data: unknown) => void): void {
    this.restPollingCallbacks.set(endpoint, callback);
  }

  /**
   * Unregister a REST polling callback
   */
  unregisterRestFallback(endpoint: string): void {
    this.restPollingCallbacks.delete(endpoint);
  }

  // ---- Internal methods ----

  private handleDisconnect(): void {
    // Clear all active STOMP subscription references
    this.subscriptions.forEach((record) => {
      record.subscription = undefined;
    });

    if (this.state === 'disconnected') return;

    this.reconnectAttempts++;
    console.log(`[StompManager] Reconnect attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts}`);

    if (this.reconnectAttempts > this.options.maxReconnectAttempts) {
      // Exceeded max retries — degrade to REST polling
      console.warn('[StompManager] Max reconnect attempts exceeded, degrading to REST polling');
      this.degradeToRest();
      return;
    }

    // Schedule reconnection with exponential backoff + jitter
    this.setState('reconnecting');
    const delay = this.calculateBackoffDelay();
    console.log(`[StompManager] Reconnecting in ${delay}ms...`);

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Deactivate old client before creating new one
      if (this.client) {
        try { this.client.deactivate(); } catch { /* ignore */ }
        this.client = null;
      }
      this.connect();
    }, delay);
  }

  private calculateBackoffDelay(): number {
    const baseDelay = this.options.reconnectDelay *
      Math.pow(this.options.backoffMultiplier, this.reconnectAttempts - 1);
    const delay = Math.min(baseDelay, this.options.maxReconnectDelay);
    // Add ±25% jitter to prevent thundering herd
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    return Math.round(delay + jitter);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  /**
   * Degrade to REST polling mode
   * Periodically polls REST endpoints to keep UI updated
   * while also attempting to restore WebSocket connection
   */
  private degradeToRest(): void {
    this.setState('degraded');

    // Start REST polling
    this.startRestPolling();

    // Periodically try to restore WebSocket
    this.startRecoveryCheck();
  }

  private startRestPolling(): void {
    this.stopRestPolling();

    if (this.restPollingCallbacks.size === 0) {
      // Register default fallback: poll drone status
      this.restPollingCallbacks.set('/drones/status', () => {});
    }

    this.restPollingTimer = setInterval(async () => {
      for (const [endpoint, callback] of this.restPollingCallbacks) {
        try {
          const url = `${this.options.restApiUrl}${endpoint}`;
          const response = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${this.getAuthToken()}`,
              'Content-Type': 'application/json',
            },
          });
          if (response.ok) {
            const data = await response.json();
            callback(data);
          }
        } catch (error) {
          console.warn(`[StompManager] REST poll failed for ${endpoint}:`, error);
        }
      }
    }, this.options.restPollingInterval);
  }

  private stopRestPolling(): void {
    if (this.restPollingTimer) {
      clearInterval(this.restPollingTimer);
      this.restPollingTimer = null;
    }
  }

  /**
   * Periodically attempt to restore WebSocket connection while in degraded mode
   */
  private startRecoveryCheck(): void {
    this.stopRecoveryCheck();

    this.restRecoveryTimer = setInterval(() => {
      console.log('[StompManager] Attempting WebSocket recovery...');
      this.reconnectAttempts = 0; // Reset counter for fresh attempt
      if (this.client) {
        try { this.client.deactivate(); } catch { /* ignore */ }
        this.client = null;
      }
      this.connect();
    }, this.options.restRecoveryCheckInterval);
  }

  private stopRecoveryCheck(): void {
    if (this.restRecoveryTimer) {
      clearInterval(this.restRecoveryTimer);
      this.restRecoveryTimer = null;
    }
  }

  /**
   * Re-subscribe all registered topics after reconnection
   */
  private resubscribeAll(): void {
    if (!this.client?.active) return;

    let resubCount = 0;
    this.subscriptions.forEach((record, subId) => {
      try {
        record.subscription = this.client!.subscribe(record.topic, record.callback);
        resubCount++;
      } catch (error) {
        console.error(`[StompManager] Failed to resubscribe ${subId} to ${record.topic}:`, error);
      }
    });
    console.log(`[StompManager] Resubscribed ${resubCount} topics`);
  }

  /**
   * Get auth token from localStorage (used for REST fallback)
   */
  private getAuthToken(): string {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('accessToken') || '';
    }
    return '';
  }
}

/**
 * Singleton instance for the application
 * Usage: import { stompManager } from './StompConnectionManager';
 */
export const stompManager = new StompConnectionManager();

export default StompConnectionManager;
