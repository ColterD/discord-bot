/**
 * API Authentication Utilities
 *
 * Provides auth checking for API endpoints
 */

import { error, type RequestEvent } from '@sveltejs/kit';

/**
 * Require authentication for an API endpoint
 * Throws 401 if not authenticated
 */
export function requireAuth(event: RequestEvent): void {
	if (!event.locals.user) {
		error(401, 'Authentication required');
	}
}

/**
 * Check if user is authenticated (non-throwing)
 */
export function isAuthenticated(event: RequestEvent): boolean {
	return !!event.locals.user;
}
