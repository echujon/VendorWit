// TEMPORARY debug endpoint: GET /api/debug-square-tax
// Reports the real Square account data needed to design location-scoped
// tax filtering: every Square Location on the account, and every
// Catalog tax with its location-scoping fields (present_at_all_locations/
// present_at_location_ids/absent_at_location_ids). Uses the same
// credential resolution terminal-checkout.js actually uses (OAuth per
// organization, falling back to the legacy global token), scoped by the
// caller's X-Location-Code like every other endpoint.
//
// Remove this file once the tax-scoping work is done - diagnostic only.

import { resolveLocation } from '../_shared/location.js';
import { getSquareCredentials, squareBaseUrl } from '../_shared/square.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const creds = await getSquareCredentials(env, loc.organizationId);
  if (!creds.accessToken) return json({ error: 'No Square credentials resolved' }, 400);

  const baseUrl = squareBaseUrl(creds.environment);
  const headers = {
    'Authorization': `Bearer ${creds.accessToken}`,
    'Square-Version': '2026-07-15'
  };

  const [locationsRes, taxRes] = await Promise.all([
    fetch(`${baseUrl}/v2/locations`, { headers }),
    fetch(`${baseUrl}/v2/catalog/list?types=TAX`, { headers })
  ]);
  const locationsData = await locationsRes.json();
  const taxData = await taxRes.json();

  const locations = (locationsData.locations || []).map(l => ({
    id: l.id,
    name: l.name,
    address: l.address,
    status: l.status
  }));

  const taxes = (taxData.objects || []).map(obj => ({
    id: obj.id,
    name: obj.tax_data?.name,
    percentage: obj.tax_data?.percentage,
    enabled: obj.tax_data?.enabled,
    is_deleted: obj.is_deleted,
    present_at_all_locations: obj.present_at_all_locations,
    present_at_location_ids: obj.present_at_location_ids,
    absent_at_location_ids: obj.absent_at_location_ids
  }));

  return json({ environment: creds.environment, locations, taxes });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}
