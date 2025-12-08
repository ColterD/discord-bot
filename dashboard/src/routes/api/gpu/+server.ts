/**
 * GPU Status API Endpoint
 *
 * Returns GPU/VRAM usage, loaded models, and service health
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGpuInfo } from '$lib/server/gpu';

export const GET: RequestHandler = async () => {
  try {
    const gpuInfo = await getGpuInfo();
    return json(gpuInfo);
  } catch (err) {
    // Use SvelteKit's error() helper for proper HTTP error responses
    const message = err instanceof Error ? err.message : 'Failed to fetch GPU info';
    error(500, { message });
  }
};
