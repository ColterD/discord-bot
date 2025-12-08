/**
 * Server-side Layout Load
 *
 * Passes user data to all pages
 */

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	return {
		user: locals.user ?? null
	};
};
