/**
 * SvelteKit Hooks
 *
 * Handles authentication middleware and error handling for all routes
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Load environment from parent directory (works regardless of cwd)
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '..', '.env') });

import type { Handle, HandleServerError } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { getSession, SESSION_COOKIE } from '$lib/server/auth';

/**
 * Custom error handler per SvelteKit docs
 * Generates unique error IDs and logs errors for debugging
 */
export const handleError: HandleServerError = async ({ error, event, status, message }) => {
	const errorId = crypto.randomUUID();

	// Log error with context for debugging
	console.error(`[Error ${errorId}] ${status}:`, error, {
		url: event.url.pathname,
		user: event.locals.user?.id
	});

	return {
		message: message || 'An unexpected error occurred',
		errorId
	};
};

/** Public routes that don't require authentication */
const PUBLIC_ROUTES = ['/login', '/auth/discord', '/auth/callback', '/auth/logout'];

/** Public API routes (health checks, Prometheus metrics) */
const PUBLIC_API_ROUTES = ['/api/cloudflare/health', '/metrics/prometheus'];

/** API routes prefix */
const API_PREFIX = '/api/';

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	// Allow public routes
	if (PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
		return resolve(event);
	}

	// Allow specific public API routes
	if (PUBLIC_API_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
		return resolve(event);
	}

	// API routes - require authentication (deny-by-default)
	if (pathname.startsWith(API_PREFIX)) {
		const sessionId = event.cookies.get(SESSION_COOKIE);
		if (!sessionId) {
			return new Response(JSON.stringify({ error: 'Unauthorized' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const session = await getSession(sessionId);
		if (!session) {
			return new Response(JSON.stringify({ error: 'Session expired' }), {
				status: 401,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		event.locals.user = {
			id: session.userId,
			username: session.username,
			avatar: session.avatar
		};
		return resolve(event);
	}

	// Check authentication for protected routes
	const sessionId = event.cookies.get(SESSION_COOKIE);

	if (!sessionId) {
		redirect(302, '/login');
	}

	const session = await getSession(sessionId);

	if (!session) {
		// Session expired or invalid
		event.cookies.delete(SESSION_COOKIE, { path: '/' });
		redirect(302, '/login');
	}

	// Add user to locals for use in pages
	event.locals.user = {
		id: session.userId,
		username: session.username,
		avatar: session.avatar
	};

	return resolve(event);
};
