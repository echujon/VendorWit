// Routed manually (see _worker.js): /api/queue/active-sales/:id
// PATCH  - report a status change (e.g. "assigned" -> "waiting-for-card"
//          once a real Square checkoutId exists)
// DELETE - report the sale is done (completed/canceled/left queue) -
//          same moment removePendingSale() already runs client-side

import { forwardToQueue } from '../../../_shared/queue.js';
import { resolveLocation } from '../../../_shared/location.js';

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  if (!env.TERMINAL_QUEUE) return json({ error: 'Server not configured' }, 500);
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  const res = await forwardToQueue(env, request, `/active-sales/${params.id}`, loc.locationId);
  return new Response(res.body, res);
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  if (!env.TERMINAL_QUEUE) return json({ error: 'Server not configured' }, 500);
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  const res = await forwardToQueue(env, request, `/active-sales/${params.id}`, loc.locationId);
  return new Response(res.body, res);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
