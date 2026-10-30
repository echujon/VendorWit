// Routed manually (see _worker.js): /api/location/aide-code
// GET  - the caller's own location's current Vendor Aide code, if set
// POST - generate/regenerate it
// Admin only - a Vendor Aide logging in with the aide code can't mint
// new ones (see functions/_shared/location.js for how role is derived).

import { resolveLocation } from '../../_shared/location.js';
import { randomJoinCode as randomCode } from '../orgs.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  if (loc.role !== 'admin') return json({ error: 'Admins only' }, 403);

  const row = await env.DB.prepare('SELECT aide_code FROM locations WHERE id = ?').bind(loc.locationId).first();
  return json({ aideCode: row.aide_code || null });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  if (loc.role !== 'admin') return json({ error: 'Admins only' }, 403);

  const code = randomCode();
  await env.DB.prepare('UPDATE locations SET aide_code = ? WHERE id = ?').bind(code, loc.locationId).run();
  return json({ aideCode: code });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
