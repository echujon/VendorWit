// Routed manually (see _worker.js): GET /api/square/locations
// Lists the connected Square account's own Locations (a separate concept
// from tag-scanner's own organizations/locations) - for Settings to let
// staff pick which one this app location corresponds to, so terminal
// checkouts apply only that event's tax instead of every tax in the
// whole Square account. See functions/api/terminal-checkout.js for where
// the selected squareLocationId actually gets used.

import { resolveLocation } from '../../_shared/location.js';
import { getSquareCredentials, squareBaseUrl } from '../../_shared/square.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const creds = await getSquareCredentials(env, loc.organizationId);
  if (!creds.accessToken) return json({ error: 'Square is not connected for this organization' }, 400);

  const baseUrl = squareBaseUrl(creds.environment);
  const res = await fetch(`${baseUrl}/v2/locations`, {
    headers: {
      'Authorization': `Bearer ${creds.accessToken}`,
      'Square-Version': '2026-07-15'
    }
  });
  const data = await res.json();
  if (!res.ok) return json({ error: data.errors?.[0]?.detail || 'Square API error (locations)' }, res.status);

  const locations = (data.locations || [])
    .filter(l => l.status === 'ACTIVE')
    .map(l => ({ id: l.id, name: l.name }));

  return json({ locations, selectedSquareLocationId: loc.squareLocationId });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
