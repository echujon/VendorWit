// Routed manually (see _worker.js): POST /api/queue/active-sales/:id/keep
// Resets a stale-looking active-sale entry's clock, same as if it were
// just created - used by the "Keep" button shown once an entry is old
// enough that the shared Queue view starts warning it'll be auto-removed.
// Any staff member viewing the Queue can call this, not just the device
// that originally started the sale.

import { forwardToQueue } from '../../../_shared/queue.js';
import { resolveLocation } from '../../../_shared/location.js';

export async function onRequestPost(context) {
  const { request, env, params } = context;
  if (!env.TERMINAL_QUEUE) return json({ error: 'Server not configured' }, 500);
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  const res = await forwardToQueue(env, request, `/active-sales/${params.id}/keep`, loc.locationId);
  return new Response(res.body, res);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
