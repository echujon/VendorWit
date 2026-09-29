// Routed manually (see _worker.js): POST /api/terminal-checkout/:id/cancel
// Cancels an in-progress Terminal checkout - e.g. the customer backed out
// while waiting for their card to be tapped. Same env vars as
// /api/terminal-checkout.

import { notifyTerminalStatus } from '../../_shared/queue.js';
import { resolveLocation } from '../../_shared/location.js';
import { getSquareCredentials, squareBaseUrl } from '../../_shared/square.js';

export async function onRequestPost(context) {
  const { request, params, env } = context;
  const checkoutId = params.id;

  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const creds = await getSquareCredentials(env, loc.organizationId);
  if (!creds.accessToken) {
    return json({ error: 'Server not configured: missing SQUARE_ACCESS_TOKEN' }, 500);
  }

  const baseUrl = squareBaseUrl(creds.environment);

  const squareRes = await fetch(`${baseUrl}/v2/terminals/checkouts/${checkoutId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${creds.accessToken}`,
      'Square-Version': '2026-07-15'
    }
  });

  const data = await squareRes.json();
  if (!squareRes.ok) {
    return json({ error: data.errors?.[0]?.detail || 'Square API error (cancel)' }, squareRes.status);
  }

  const deviceId = data.checkout?.device_options?.device_id;
  context.waitUntil?.(notifyTerminalStatus(env, deviceId, 'available', loc.locationId));

  return json({ checkoutId, status: data.checkout.status });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
