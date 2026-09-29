// Routed manually (see _worker.js): GET /api/square/device-codes-status?id=X
// Polls a device code's pairing status. Named with a "-status" suffix
// rather than /device-codes/:id to keep _worker.js's routing simple (no
// path-param regex needed) - purely a URL convention, not a REST rule.

import { resolveLocation } from '../../_shared/location.js';
import { getSquareCredentials, squareBaseUrl } from '../../_shared/square.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, 400);

  let creds;
  try {
    creds = await getSquareCredentials(env, loc.organizationId);
  } catch (err) {
    return json({ error: err.message }, 500);
  }

  const baseUrl = squareBaseUrl(creds.environment);
  const res = await fetch(`${baseUrl}/v2/devices/codes/${id}`, {
    headers: {
      'Authorization': `Bearer ${creds.accessToken}`,
      'Square-Version': '2026-07-15'
    }
  });
  const data = await res.json();
  if (!res.ok) {
    return json({ error: data.errors?.[0]?.detail || 'Square API error' }, res.status);
  }

  return json({
    status: data.device_code.status,
    deviceId: data.device_code.device_id || null
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
