// Routed manually (see _worker.js): POST /api/square/set-location
// Body: { squareLocationId }
// Saves which of the connected Square account's Locations this app
// location corresponds to (see locations.js for the picker list this
// feeds). Scoped to the caller's own location - one organization running
// several events at once each sets their own mapping independently.

import { resolveLocation } from '../../_shared/location.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const body = await request.json().catch(() => ({}));
  const squareLocationId = (body.squareLocationId || '').trim() || null;

  await env.DB.prepare('UPDATE locations SET square_location_id = ? WHERE id = ?')
    .bind(squareLocationId, loc.locationId)
    .run();

  return json({ ok: true, squareLocationId });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
