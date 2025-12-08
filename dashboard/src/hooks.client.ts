/**
 * SvelteKit Client Hooks
 *
 * Handles client-side error handling
 */

import type { HandleClientError } from '@sveltejs/kit';

/**
 * Custom client error handler per SvelteKit docs
 * Generates unique error IDs and logs errors for debugging
 */
export const handleError: HandleClientError = async ({ error, status, message }) => {
	const errorId = crypto.randomUUID();

	// Log error to console for debugging
	console.error(`[Client Error ${errorId}] ${status}:`, error);

	return {
		message: message || 'An unexpected error occurred',
		errorId
	};
};
