// Routed manually (see _worker.js): POST /api/square/device-codes
// Generates a Square Terminal pairing code using the caller's location's
// organization's own connected Square account (falling back to the
// legacy global token if they haven't connected one - see
// functions/_shared/square.js). This is the actual feature requested:
// replaces manually running curl against Square's Devices API.
//
// Body: { name } - a label for the terminal being paired (e.g. "Register 1")

import { resolveLocation } from '../../_shared/location.js';
import { getSquareCredentials, squareBaseUrl } from '../../_shared/square.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const body = await request.json().catch(() => ({}));
  const name = (body.name || '').trim() || 'Terminal';

  let creds;
  try {
    creds = await getSquareCredentials(env, loc.organizationId);
  } catch (err) {
    return json({ error: err.message }, 500);
  }
  if (!creds.accessToken) {
    return json({ error: 'No Square account connected for this organization, and no fallback token configured' }, 400);
  }

  const baseUrl = squareBaseUrl(creds.environment);
  const headers = {
    'Authorization': `Bearer ${creds.accessToken}`,
    'Content-Type': 'application/json',
    'Square-Version': '2026-07-15'
  };

  const merchantRes = await fetch(`${baseUrl}/v2/merchants/me`, { headers });
  const merchantData = await merchantRes.json();
  if (!merchantRes.ok) {
    return json({ error: merchantData.errors?.[0]?.detail || 'Square API error (merchant lookup)' }, merchantRes.status);
  }

  const codeRes = await fetch(`${baseUrl}/v2/devices/codes`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      device_code: {
        name,
        product_type: 'TERMINAL_API',
        location_id: merchantData.merchant.main_location_id
      }
    })
  });
  const codeData = await codeRes.json();
  if (!codeRes.ok) {
    return json({ error: codeData.errors?.[0]?.detail || 'Square API error (device code)' }, codeRes.status);
  }

  return json({
    id: codeData.device_code.id,
    code: codeData.device_code.code,
    status: codeData.device_code.status
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
