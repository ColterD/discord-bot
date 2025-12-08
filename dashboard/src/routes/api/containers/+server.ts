import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getStackContainers } from '$lib/server/docker';

export const GET: RequestHandler = async () => {
  try {
    const containers = await getStackContainers();
    return json(containers);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return json({ error: message }, { status: 500 });
  }
};
