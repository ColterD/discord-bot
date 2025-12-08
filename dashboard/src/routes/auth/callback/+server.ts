/**
 * Discord OAuth Callback Endpoint
 *
 * Handles the callback from Discord after user authorizes
 */

import { error, redirect } from '@sveltejs/kit';
import {
	createSession,
	exchangeCode,
	fetchUser,
	getSessionCookieOptions, 
	isAuthorized,
	SESSION_COOKIE
} from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const errorParam = url.searchParams.get('error');
	const errorDescription = url.searchParams.get('error_description');

	// Handle OAuth errors
	if (errorParam) {
		console.error('[Auth] OAuth error:', errorParam, errorDescription);
		redirect(302, '/?error=oauth_denied');
	}

	// Validate required parameters
	if (!code || !state) {
		error(400, 'Missing code or state parameter');
	}

	// Verify state to prevent CSRF
	const storedState = cookies.get('oauth_state');
	cookies.delete('oauth_state', { path: '/' });

	if (!storedState || storedState !== state) {
		console.error('[Auth] State mismatch:', { storedState, receivedState: state });
		error(400, 'Invalid state parameter');
	}

	try {
		// Exchange code for tokens
		const tokens = await exchangeCode(code);

		// Fetch user info
		const user = await fetchUser(tokens.access_token);
		console.log(`[Auth] User authenticated: ${user.username} (${user.id})`);

		// Check authorization
		if (!isAuthorized(user.id)) {
			console.warn(`[Auth] Unauthorized user attempted access: ${user.username} (${user.id})`);
			redirect(302, '/?error=unauthorized');
		}

		// Create session
		const { sessionId } = await createSession(user, tokens);

		// Set session cookie
		cookies.set(SESSION_COOKIE, sessionId, getSessionCookieOptions());

		console.log(`[Auth] Session created for ${user.username}`);
		redirect(302, '/');
	} catch (err) {
		// SvelteKit's redirect() throws a Redirect object - rethrow it
		if (err && typeof err === 'object' && 'status' in err && 'location' in err) {
			throw err;
		}
		console.error('[Auth] Callback error:', err);
		redirect(302, '/?error=auth_failed');
	}
};
