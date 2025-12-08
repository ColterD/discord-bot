import { resolve } from 'node:path';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { viteWebSocketPlugin } from './src/lib/server/vite-ws-plugin';

export default defineConfig({
	plugins: [sveltekit(), viteWebSocketPlugin()],
	envDir: resolve(__dirname, '..'),
	server: {
		allowedHosts: true // Allow all hosts in development
	}
});
