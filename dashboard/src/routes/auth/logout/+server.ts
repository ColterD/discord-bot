/**
 * Logout Endpoint
 *
 * Clears session and redirects to login
 */

import { redirect } from '@sveltejs/kit';
import { deleteSession, SESSION_COOKIE } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const sessionId = cookies.get(SESSION_COOKIE);

	if (sessionId) {
		await deleteSession(sessionId);
		cookies.delete(SESSION_COOKIE, { path: '/' });
		console.log('[Auth] User logged out');
	}

	redirect(302, '/login');
};
