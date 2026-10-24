// Routed manually (see _worker.js): GET /api/square/connection
// Reports whether the caller's location's organization has connected a
// Square account via OAuth yet, for Settings to render connection status.
// Never returns the tokens themselves - just enough to show "Connected as
// [merchant]" or "Not connected".
//
// Also doubles as the main app's (js/app.js) way of learning its own
// server-verified role on every load - shared, not admin-gated, and
// already fetched there for the business-name display, so no extra
// round trip is needed just to keep the Settings-link visibility honest.

import { resolveLocation } from '../../_shared/location.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const row = await env.DB.prepare(
    'SELECT merchant_id, business_name, environment FROM square_connections WHERE organization_id = ?'
  ).bind(loc.organizationId).first();

  return json(row
    ? { connected: true, merchantId: row.merchant_id, businessName: row.business_name || null, environment: row.environment, role: loc.role }
    : { connected: false, role: loc.role });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
