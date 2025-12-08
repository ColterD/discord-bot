/**
 * Custom Server Entry Point for SvelteKit with WebSocket
 *
 * This server wraps the SvelteKit handler and adds WebSocket support
 * for real-time dashboard updates.
 */

import { createServer } from 'node:http';
import { handler } from './build/handler.js';
import { closeWebSocketServer, initWebSocketServer } from './src/lib/server/websocket.js';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

// Create HTTP server
const server = createServer((req, res) => {
  // Let SvelteKit handle all HTTP requests
  handler(req, res);
});

// Initialize WebSocket server
initWebSocketServer(server);

// Start listening
server.listen(PORT, HOST, () => {
  console.log(`🚀 Dashboard server running at http://${HOST}:${PORT}`);
  console.log(`📡 WebSocket available at ws://${HOST}:${PORT}/ws`);
});

// Graceful shutdown
function shutdown() {
  console.log('Shutting down...');
  closeWebSocketServer();
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
