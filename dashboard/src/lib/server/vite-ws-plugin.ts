/**
 * Vite Plugin for WebSocket Development Server
 *
 * Provides WebSocket support during development mode by attaching
 * a WebSocket server to Vite's HTTP server using noServer mode
 * to avoid conflicts with Vite's HMR WebSocket.
 */

import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Plugin, ViteDevServer } from 'vite';
import { type WebSocket, WebSocketServer } from 'ws';
import type { WebSocketMessage } from '$lib/types';

/** Connected clients */
const clients = new Set<WebSocket>();

/** Broadcast interval */
let broadcastInterval: ReturnType<typeof setInterval> | null = null;

/** Container update interval (ms) */
const UPDATE_INTERVAL = 3000;

/** WebSocket server instance (module-level for singleton) */
let wss: WebSocketServer | null = null;

/** Track the current HTTP server to detect restarts */
let currentHttpServer: object | null = null;

/**
 * Send message to a specific client
 */
function sendToClient(client: WebSocket, message: WebSocketMessage): void {
	if (client.readyState === 1) {
		// WebSocket.OPEN
		client.send(JSON.stringify(message));
	}
}

/**
 * Broadcast message to all clients
 */
function broadcast(message: WebSocketMessage): void {
	for (const client of clients) {
		sendToClient(client, message);
	}
}

/**
 * Fetch container data and broadcast to clients
 */
async function fetchAndBroadcastContainers(): Promise<void> {
	try {
		// Dynamically import docker module to avoid SSR issues
		const { getStackContainers } = await import('./docker.js');
		const containers = await getStackContainers();

		console.log(`[WS Dev] Broadcasting ${containers.length} containers`);

		broadcast({
			type: 'containers',
			data: containers,
			timestamp: Date.now()
		});
	} catch (error) {
		console.error('[WS Dev] Failed to fetch containers:', error);
	}
}

/**
 * Fetch GPU data and broadcast to clients
 */
async function fetchAndBroadcastGpu(): Promise<void> {
	try {
		const { getGpuInfo } = await import('./gpu.js');
		const gpuInfo = await getGpuInfo();

		console.log(`[WS Dev] GPU info: ollama=${gpuInfo.ollamaHealthy}, gpu=${gpuInfo.gpu ? 'yes' : 'no'}`);

		broadcast({
			type: 'gpu',
			data: gpuInfo.gpu,
			timestamp: Date.now()
		});
	} catch (error) {
		console.error('[WS Dev] Failed to fetch GPU:', error);
	}
}

/**
 * Start periodic broadcasts
 */
function startBroadcasting(): void {
	if (broadcastInterval) return;

	// Initial fetch
	void fetchAndBroadcastContainers();
	void fetchAndBroadcastGpu();

	// Set up periodic updates
	broadcastInterval = setInterval(() => {
		void fetchAndBroadcastContainers();
		void fetchAndBroadcastGpu();
	}, UPDATE_INTERVAL);
}

/**
 * Stop periodic broadcasts
 */
function stopBroadcasting(): void {
	if (broadcastInterval) {
		clearInterval(broadcastInterval);
		broadcastInterval = null;
	}
}

/**
 * Vite plugin that adds WebSocket support during development
 * Uses noServer mode to avoid conflicts with Vite's HMR WebSocket
 */
export function viteWebSocketPlugin(): Plugin {
	return {
		name: 'vite-websocket-plugin',
		apply: 'serve', // Only run in dev mode

		configureServer(server: ViteDevServer): void {
			if (!server.httpServer) {
				console.warn('[WS Dev] No HTTP server available');
				return;
			}

			// Detect if httpServer changed (Vite restart) - need to reattach handlers
			const isNewServer = currentHttpServer !== server.httpServer;
			currentHttpServer = server.httpServer;

			// Create WSS once
			if (!wss) {
				wss = new WebSocketServer({ noServer: true });
				console.log('[WS Dev] WebSocket server created (noServer mode)');

				// Attach connection handler once to the WSS
				wss.on('connection', (ws, req) => {
					const clientIp = req.socket.remoteAddress ?? 'unknown';
					console.log(`[WS Dev] Client connected from ${clientIp}`);

					clients.add(ws);

					// Send connection confirmation
					sendToClient(ws, {
						type: 'connected',
						data: { message: 'Connected to dev WebSocket' },
						timestamp: Date.now()
					});

					// Start broadcasting if first client
					if (clients.size === 1) {
						startBroadcasting();
					}

					// Send initial data
					void fetchAndBroadcastContainers();
					void fetchAndBroadcastGpu();

					ws.on('message', (message) => {
						try {
							const parsed = JSON.parse(message.toString()) as { type: string };

							// Handle refresh requests
							if (parsed.type === 'refresh') {
								void fetchAndBroadcastContainers();
								void fetchAndBroadcastGpu();
							}
						} catch {
							console.error('[WS Dev] Failed to parse message');
						}
					});

					ws.on('close', () => {
						console.log(`[WS Dev] Client disconnected from ${clientIp}`);
						clients.delete(ws);

						// Stop broadcasting if no clients
						if (clients.size === 0) {
							stopBroadcasting();
						}
					});

					ws.on('error', (error) => {
						console.error('[WS Dev] WebSocket error:', error);
						clients.delete(ws);
					});
				});
			}

			// Attach upgrade handler to the current httpServer (or reattach if server changed)
			if (isNewServer) {
				// Handle upgrade requests manually to avoid conflicts with Vite HMR
				server.httpServer.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
					const pathname = new URL(request.url ?? '', `http://${request.headers.host}`).pathname;

					// Only handle /ws path, let Vite handle its own HMR WebSocket
					if (pathname === '/ws') {
						wss?.handleUpgrade(request, socket, head, (ws) => {
							wss?.emit('connection', ws, request);
						});
					}
					// Don't close socket for other paths - let Vite handle them
				});

				console.log('[WS Dev] WebSocket server initialized on /ws');
			}
		},

		closeBundle(): void {
			// Cleanup on server close
			stopBroadcasting();
			clients.clear();
			if (wss) {
				wss.close();
				wss = null;
			}
		}
	};
}
