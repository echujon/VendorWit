// Routed manually (see _worker.js): PATCH /api/consign/review-items/:id
// Body: { status: 'approved' | 'rejected' }
// Staff-authenticated via X-Location-Code / resolveLocation. Scoped to
// the caller's own location, same as every other staff endpoint -
// cannot touch another location's submissions even if it somehow knew
// the id. Approving doesn't create a real `items` row automatically -
// that still happens through the normal scan-and-tag flow once the item
// physically arrives (see migrations/0012_consignment_items.sql).

import { resolveLocation } from '../../../_shared/location.js';

const ALLOWED_STATUSES = ['approved', 'rejected'];

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  if (loc.role !== 'admin') return json({ error: 'Admins only' }, 403);

  const body = await request.json().catch(() => ({}));
  if (!ALLOWED_STATUSES.includes(body.status)) {
    return json({ error: 'status must be "approved" or "rejected"' }, 400);
  }

  const result = await env.DB.prepare(
    "UPDATE consignor_items SET status = ?, reviewed_at = datetime('now') WHERE id = ? AND location_id = ?"
  ).bind(body.status, params.id, loc.locationId).run();

  if (!result.meta.changes) return json({ error: 'Not found' }, 404);
  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
