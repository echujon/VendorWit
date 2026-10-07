// Routed manually (see _worker.js): GET /api/square/connection
// Reports whether the caller's location's organization has connected a
// Square account via OAuth yet, for Settings to render connection status.
// Never returns the tokens themselves - just enough to show "Connected as
// [merchant]" or "Not connected".

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
    ? { connected: true, merchantId: row.merchant_id, businessName: row.business_name || null, environment: row.environment }
    : { connected: false });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
