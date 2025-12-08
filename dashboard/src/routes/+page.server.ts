/**
 * Server-side Page Load for Containers
 *
 * Pre-fetches container data so the page renders with data immediately
 * instead of waiting for WebSocket connection + first data push.
 * This eliminates the ~1 second perceived load time.
 */

import { getStackContainers } from '$lib/server/docker';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		const containers = await getStackContainers();
		return {
			containers,
			loadedAt: Date.now()
		};
	} catch (error) {
		// Return empty array on error - WebSocket will retry
		console.error('[SSR] Failed to load containers:', error);
		return {
			containers: [],
			loadedAt: Date.now()
		};
	}
};
