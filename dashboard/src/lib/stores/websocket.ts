/**
 * WebSocket Store for Real-time Dashboard Updates
 *
 * Manages WebSocket connection to the server and provides reactive
 * stores for container status, GPU metrics, and connection state.
 */

import { get, writable } from 'svelte/store';
import type {
  ContainerInfo,
  DashboardStats,
  GpuStatus,
  MemoryInfo,
  WebSocketMessage
} from '$lib/types';

/**
 * Sanitize user-provided values for safe logging
 * Prevents log injection by removing newlines and control characters
 *
 * @remarks Uses String.prototype.replace() which CodeQL recognizes as a
 * log injection sanitizer. The regex removes all C0 control characters
 * (0x00-0x1F including \n, \r, \t) and DEL (0x7F).
 */
function sanitizeForLog(value: unknown): string {
  const str = String(value);
  // Remove control characters using .replaceAll() - CodeQL recognizes this pattern
  // as a sanitizer for log injection when the regex matches \n explicitly
  // Includes \n \r explicitly so CodeQL's StringReplaceSanitizer detects this
  const sanitized = str.replaceAll(/[\n\r\p{Cc}]/gu, '');

  // Truncate to prevent log flooding (max 100 chars per value)
  return sanitized.length > 100 ? `${sanitized.slice(0, 100)}...` : sanitized;
}

/** WebSocket connection state */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

/** Connection state store */
export const connectionState = writable<ConnectionState>('disconnected');

/** Containers from WebSocket */
export const wsContainers = writable<ContainerInfo[]>([]);

/** GPU status from WebSocket */
export const wsGpu = writable<GpuStatus | null>(null);

/** Last error message */
export const wsError = writable<string | null>(null);

/** Last update timestamp */
export const lastUpdate = writable<number>(0);

/** Dashboard stats derived from containers */
export const wsStats = writable<DashboardStats>({
  totalContainers: 0,
  runningContainers: 0,
  stoppedContainers: 0,
  totalCpu: 0,
  totalMemory: null,
  gpu: null
});

/** WebSocket instance */
let ws: WebSocket | null = null;

/** Reconnection state */
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_BASE = 1000;
const RECONNECT_DELAY_MAX = 30000;

/**
 * Calculate reconnection delay with exponential backoff
 */
function getReconnectDelay(): number {
  const delay = Math.min(
    RECONNECT_DELAY_BASE * 2 ** reconnectAttempts,
    RECONNECT_DELAY_MAX
  );
  // Add jitter to prevent thundering herd
  return delay + Math.random() * 1000;
}

/**
 * Update stats from containers
 */
function updateStats(containers: ContainerInfo[]): void {
  const running = containers.filter(c => c.state === 'running');
  const stopped = containers.filter(c => c.state === 'exited');
  const totalCpu = running.reduce((sum, c) => sum + (c.cpu ?? 0), 0);

  let totalMemory: MemoryInfo | null = null;
  const memoryContainers = running.filter(c => c.memory !== null);
  if (memoryContainers.length > 0) {
    const totalUsed = memoryContainers.reduce((sum, c) => sum + (c.memory?.used ?? 0), 0);
    const totalLimit = memoryContainers.reduce((sum, c) => sum + (c.memory?.limit ?? 0), 0);
    totalMemory = {
      used: totalUsed,
      limit: totalLimit,
      percent: totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0
    };
  }

  wsStats.set({
    totalContainers: containers.length,
    runningContainers: running.length,
    stoppedContainers: stopped.length,
    totalCpu,
    totalMemory,
    gpu: get(wsGpu)
  });
}

/** Track previous state for change detection - use sessionStorage to survive HMR */
function getPrevState(key: string): string | null {
  if (typeof globalThis === 'undefined') return null;
  return sessionStorage.getItem(`ws_fingerprint_${key}`);
}

function setPrevState(key: string, value: string): void {
  if (typeof globalThis === 'undefined') return;
  sessionStorage.setItem(`ws_fingerprint_${key}`, value);
}

/**
 * Generate a fingerprint of container state for change detection
 * Only tracks name and state - CPU/memory fluctuate too much
 */
function getContainerFingerprint(containers: ContainerInfo[]): string {
  return containers
    .map(c => `${c.name}:${c.state}`)
    .sort()
    .join('|');
}

/**
 * Handle incoming WebSocket message
 */
function handleMessage(event: MessageEvent): void {
  try {
    const message = JSON.parse(event.data) as WebSocketMessage;
    lastUpdate.set(message.timestamp);
    wsError.set(null);

    switch (message.type) {
      case 'containers': {
        const containers = message.data as ContainerInfo[];
        const fingerprint = getContainerFingerprint(containers);
        const prevContainerState = getPrevState('containers');

        // Only log if state actually changed (container added/removed/state changed)
        if (fingerprint !== prevContainerState) {
          if (prevContainerState !== null) {
            // Don't log on first load, only on actual changes
            const summary = containers.map(c => `${sanitizeForLog(c.name)}:${sanitizeForLog(c.state)}`).join(', ');
            console.log('[WS] Containers changed:', summary);
          }
          setPrevState('containers', fingerprint);
        }

        // Always update the store (for CPU/memory updates) but don't log
        wsContainers.set(containers);
        updateStats(containers);
        break;
      }

      case 'gpu': {
        const gpuData = message.data as GpuStatus;
        const gpuFingerprint = JSON.stringify(gpuData);
        const prevGpuState = getPrevState('gpu');

        // Only log if GPU state changed
        if (gpuFingerprint !== prevGpuState) {
          if (prevGpuState !== null) {
            console.log('[WS] GPU status changed');
          }
          setPrevState('gpu', gpuFingerprint);
        }

        // Always update the store
        wsGpu.set(gpuData);
        wsStats.update(s => ({ ...s, gpu: gpuData }));
        break;
      }

      case 'connected':
        connectionState.set('connected');
        reconnectAttempts = 0;
        break;

      case 'error': {
        const errorData = message.data as { message: string };
        wsError.set(errorData.message);
        break;
      }

      default:
        console.log('[WS Client] Unknown message type:', sanitizeForLog(message.type));
    }
  } catch (error) {
    console.error('[WS Client] Failed to parse message:', error);
  }
}

/**
 * Connect to WebSocket server
 */
export function connect(): void {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
    return;
  }

  // Determine WebSocket URL based on current location
  const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${globalThis.location.host}/ws`;

  connectionState.set('connecting');
  wsError.set(null);

  ws = new WebSocket(url);

  ws.onopen = () => {
    console.log('[WS Client] Connected');
    connectionState.set('connected');
    reconnectAttempts = 0;
  };

  ws.onmessage = handleMessage;

  ws.onclose = (event) => {
    console.log('[WS Client] Disconnected:', event.code, event.reason);
    connectionState.set('disconnected');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = (error) => {
    console.error('[WS Client] Error:', error);
    connectionState.set('error');
    wsError.set('WebSocket connection error');
  };
}

/**
 * Schedule reconnection attempt
 */
function scheduleReconnect(): void {
  if (reconnectTimeout) {
    return;
  }

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    wsError.set(`Failed to connect after ${MAX_RECONNECT_ATTEMPTS} attempts`);
    return;
  }

  reconnectAttempts++;
  const delay = getReconnectDelay();

  console.log(`[WS Client] Reconnecting in ${Math.round(delay)}ms (attempt ${reconnectAttempts})`);

  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = null;
    connect();
  }, delay);
}

/**
 * Disconnect from WebSocket server
 */
export function disconnect(): void {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }

  if (ws) {
    ws.close(1000, 'Client disconnecting');
    ws = null;
  }

  connectionState.set('disconnected');
}

/**
 * Send message to server
 */
export function send(message: { type: string; data?: unknown }): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Request immediate refresh
 */
export function refresh(): void {
  send({ type: 'refresh' });
}

/**
 * Check if connected
 */
export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}
