// Cloudflare Pages Function: GET /api/queue/status?clientId=X
// Fallback for a client that reconnected and may have missed the
// WebSocket 'assigned' push - reports current queue position, if any.

import { forwardToQueue } from '../../_shared/queue.js';
import { resolveLocation } from '../../_shared/location.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500 });
  const loc = await resolveLocation(request, env);
  if (loc.error) return new Response(JSON.stringify({ error: loc.error }), { status: loc.status });
  const res = await forwardToQueue(env, request, '/my-status', loc.locationId);
  return new Response(res.body, res);
}
