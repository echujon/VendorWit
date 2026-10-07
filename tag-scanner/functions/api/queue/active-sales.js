// Cloudflare Pages Function: /api/queue/active-sales
// GET  - list every active sale (queued/assigned/waiting-for-card) at
//        this location, for the shared "Queue" view
// POST - report a new sale, body { saleId, clientId, cart, total,
//        deviceId, status } - the client already generates saleId
//        locally (see js/app.js's btnReviewTerminal handler) and reuses
//        it here rather than the server minting a new one.
// Mirrors functions/api/queue/terminals.js's relay shape.

import { forwardToQueue } from '../../_shared/queue.js';
import { resolveLocation } from '../../_shared/location.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return json({ error: 'Server not configured' }, 500);
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  const res = await forwardToQueue(env, request, '/active-sales', loc.locationId);
  return new Response(res.body, res);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return json({ error: 'Server not configured' }, 500);
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  const res = await forwardToQueue(env, request, '/active-sales', loc.locationId);
  return new Response(res.body, res);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
