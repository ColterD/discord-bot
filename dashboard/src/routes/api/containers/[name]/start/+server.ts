import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/api-auth';
import { startContainer } from '$lib/server/docker';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
  requireAuth(event);
  const { name } = event.params;

  try {
    await startContainer(name);
    return json({ success: true, message: `Container ${name} started` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return json({ error: message }, { status: 500 });
  }
};
