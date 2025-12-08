/**
 * WebSocket Server for Dashboard Real-time Updates
 *
 * Provides real-time container status, GPU metrics, and log streaming
 * to connected dashboard clients. Replaces polling with push-based updates.
 */

import type { Server } from 'node:http';
import { type WebSocket, WebSocketServer } from 'ws';
import type { ContainerInfo, GpuStatus, WebSocketMessage } from '$lib/types';
import { getStackContainers } from './docker.js';

/** Connected WebSocket clients */
const clients = new Set<WebSocket>();

/** WebSocket server instance */
let wss: WebSocketServer | null = null;

/** Broadcast interval handle */
let broadcastInterval: ReturnType<typeof setInterval> | null = null;

/** Container update interval (ms) */
const CONTAINER_UPDATE_INTERVAL = 3000;

/**
 * Initialize WebSocket server attached to HTTP server
 */
export function initWebSocketServer(server: Server): WebSocketServer {
  if (wss) {
    return wss;
  }

  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress ?? 'unknown';
    console.log(`[WS] Client connected from ${clientIp}`);

    clients.add(ws);

    // Send initial connection confirmation
    sendToClient(ws, {
      type: 'connected',
      data: { message: 'Connected to dashboard WebSocket' },
      timestamp: Date.now()
    });

    // Send initial container state
    sendContainerUpdate(ws).catch(console.error);

    ws.on('message', (message) => {
      try {
        const parsed = JSON.parse(message.toString());
        handleClientMessage(ws, parsed);
      } catch {
        console.error('[WS] Failed to parse message');
      }
    });

    ws.on('close', () => {
      console.log(`[WS] Client disconnected from ${clientIp}`);
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('[WS] Client error:', error.message);
      clients.delete(ws);
    });
  });

  // Start broadcasting container updates
  startBroadcastLoop();

  console.log('[WS] WebSocket server initialized on /ws');
  return wss;
}

/**
 * Handle messages from connected clients
 */
function handleClientMessage(ws: WebSocket, message: unknown): void {
  if (!message || typeof message !== 'object' || !('type' in message)) {
    return;
  }

  const { type } = message as { type: string };

  switch (type) {
    case 'ping':
      sendToClient(ws, {
        type: 'connected',
        data: { message: 'pong' },
        timestamp: Date.now()
      });
      break;

    case 'refresh':
      // Force immediate container update for this client
      sendContainerUpdate(ws).catch(console.error);
      break;

    default:
      console.log(`[WS] Unknown message type: ${type}`);
  }
}

/**
 * Send message to a single client
 */
function sendToClient<T>(ws: WebSocket, message: WebSocketMessage<T>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Broadcast message to all connected clients
 */
export function broadcast<T>(message: WebSocketMessage<T>): void {
  const json = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === client.OPEN) {
      client.send(json);
    }
  }
}

/**
 * Send container update to a specific client
 */
async function sendContainerUpdate(ws: WebSocket): Promise<void> {
  try {
    const containers = await getStackContainers();
    sendToClient(ws, {
      type: 'containers',
      data: containers as ContainerInfo[],
      timestamp: Date.now()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    sendToClient(ws, {
      type: 'error',
      data: { message: `Failed to fetch containers: ${message}` },
      timestamp: Date.now()
    });
  }
}

/**
 * Broadcast container update to all clients
 */
async function broadcastContainerUpdate(): Promise<void> {
  if (clients.size === 0) {
    return; // No clients connected, skip the work
  }

  try {
    const containers = await getStackContainers();
    broadcast({
      type: 'containers',
      data: containers as ContainerInfo[],
      timestamp: Date.now()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    broadcast({
      type: 'error',
      data: { message: `Failed to fetch containers: ${message}` },
      timestamp: Date.now()
    });
  }
}

/**
 * Broadcast GPU status update to all clients
 */
export function broadcastGpuUpdate(gpu: GpuStatus): void {
  broadcast({
    type: 'gpu',
    data: gpu,
    timestamp: Date.now()
  });
}

/**
 * Start the broadcast loop for container updates
 */
function startBroadcastLoop(): void {
  if (broadcastInterval) {
    return;
  }

  broadcastInterval = setInterval(() => {
    broadcastContainerUpdate().catch(console.error);
  }, CONTAINER_UPDATE_INTERVAL);

  console.log(`[WS] Started broadcast loop (${CONTAINER_UPDATE_INTERVAL}ms interval)`);
}

/**
 * Stop the broadcast loop
 */
export function stopBroadcastLoop(): void {
  if (broadcastInterval) {
    clearInterval(broadcastInterval);
    broadcastInterval = null;
    console.log('[WS] Stopped broadcast loop');
  }
}

/**
 * Close WebSocket server and all connections
 */
export function closeWebSocketServer(): void {
  stopBroadcastLoop();

  for (const client of clients) {
    client.close(1000, 'Server shutting down');
  }
  clients.clear();

  if (wss) {
    wss.close();
    wss = null;
    console.log('[WS] WebSocket server closed');
  }
}

/**
 * Get number of connected clients
 */
export function getClientCount(): number {
  return clients.size;
}
