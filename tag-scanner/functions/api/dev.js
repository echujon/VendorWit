// Routed manually (see _worker.js). All require X-Dev-Key (see
// functions/_shared/dev.js).
// GET  /api/dev/overview  - every organization with its locations and codes
// POST /api/dev/locations { organizationId, locationName } - add an event
//      to an existing organization
// (Creating a new organization is POST /api/orgs, also dev-only.)

import { requireDev } from '../_shared/dev.js';
import { randomJoinCode } from './orgs.js';

export async function onRequestGetOverview(context) {
  const { request, env } = context;
  const dev = await requireDev(request, env);
  if (dev.error) return json({ error: dev.error }, dev.status);

  const [{ results: orgs }, { results: locations }] = await Promise.all([
    env.DB.prepare('SELECT id, name FROM organizations ORDER BY name COLLATE NOCASE').all(),
    env.DB.prepare(`
      SELECT id, organization_id, name, join_code, aide_code,
             consignment_slug, consignment_event_name
      FROM locations ORDER BY name COLLATE NOCASE
    `).all()
  ]);

  return json({
    organizations: orgs.map(o => ({
      id: o.id,
      name: o.name,
      locations: locations.filter(l => l.organization_id === o.id).map(l => ({
        id: l.id,
        name: l.name,
        joinCode: l.join_code,
        aideCode: l.aide_code || null,
        consignmentSlug: l.consignment_slug || null,
        eventName: l.consignment_event_name || null
      }))
    }))
  });
}

export async function onRequestPostLocation(context) {
  const { request, env } = context;
  const dev = await requireDev(request, env);
  if (dev.error) return json({ error: dev.error }, dev.status);

  const body = await request.json().catch(() => ({}));
  const organizationId = (body.organizationId || '').trim();
  const locationName = (body.locationName || '').trim();
  if (!organizationId || !locationName) return json({ error: 'organizationId and locationName are required' }, 400);

  const org = await env.DB.prepare('SELECT id FROM organizations WHERE id = ?').bind(organizationId).first();
  if (!org) return json({ error: 'Unknown organization' }, 404);

  const locationId = crypto.randomUUID();
  const joinCode = randomJoinCode();
  await env.DB.prepare('INSERT INTO locations (id, organization_id, name, join_code) VALUES (?, ?, ?, ?)')
    .bind(locationId, organizationId, locationName, joinCode).run();

  return json({ organizationId, locationId, locationName, joinCode });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
