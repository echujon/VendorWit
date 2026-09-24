// Cloudflare Pages Function: POST /api/queue/clear
// Admin escape hatch: empties the wait queue entirely. For when requests
// got stuck (e.g. queued while a terminal was wrongly stuck "busy", then
// never auto-assigned once it recovered) and there's no single clientId
// to target with /api/queue/cancel.

import { forwardToQueue } from '../../_shared/queue.js';
import { resolveLocation } from '../../_shared/location.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500 });
  const loc = await resolveLocation(request, env);
  if (loc.error) return new Response(JSON.stringify({ error: loc.error }), { status: loc.status });
  const res = await forwardToQueue(env, request, '/clear-queue', loc.locationId);
  return new Response(res.body, res);
}
