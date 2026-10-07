// Cloudflare Pages Function: GET /api/queue/assignment-status?queueId=X
// Recovery path for a client whose WebSocket was disconnected at the
// exact moment it got assigned a terminal - the real-time 'assigned' push
// (see terminal-queue-worker/worker.js's assignFromQueue) would otherwise
// be silently lost, leaving the client waiting forever and the terminal
// falsely marked busy forever. Called by app.js right after the
// WebSocket reconnects, once per outstanding queueId it's still tracking.

import { forwardToQueue } from '../../_shared/queue.js';
import { resolveLocation } from '../../_shared/location.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500 });
  const loc = await resolveLocation(request, env);
  if (loc.error) return new Response(JSON.stringify({ error: loc.error }), { status: loc.status });
  const res = await forwardToQueue(env, request, '/assignment-status', loc.locationId);
  return new Response(res.body, res);
}
