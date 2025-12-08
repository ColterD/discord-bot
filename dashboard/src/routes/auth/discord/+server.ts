/**
 * Discord OAuth Login Endpoint
 *
 * Redirects to Discord for authentication
 */

import { redirect } from '@sveltejs/kit';
import { getAuthUrl } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	// Generate a random state for CSRF protection
	const state = crypto.randomUUID();

	// Store state in cookie for verification
	cookies.set('oauth_state', state, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
		sameSite: 'lax',
		maxAge: 300 // 5 minutes
	});

	const authUrl = getAuthUrl(state);
	redirect(302, authUrl);
};
