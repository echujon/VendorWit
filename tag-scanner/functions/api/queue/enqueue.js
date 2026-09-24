// Cloudflare Pages Function: POST /api/queue/enqueue
// Body: { clientId, cart, note }
// Returns { status: 'assigned', deviceId, name } if a terminal is free
// right now, or { status: 'queued', queueId, position } otherwise - in
// which case the client waits for a WebSocket 'assigned' push (see
// /api/queue/connect) or falls back to polling /api/queue/status.

import { forwardToQueue } from '../../_shared/queue.js';
import { resolveLocation } from '../../_shared/location.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return json({ error: 'Server not configured' }, 500);
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  const res = await forwardToQueue(env, request, '/enqueue', loc.locationId);
  return new Response(res.body, res);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
