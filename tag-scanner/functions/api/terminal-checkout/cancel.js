// Routed manually (see _worker.js): POST /api/terminal-checkout/:id/cancel
// Cancels an in-progress Terminal checkout - e.g. the customer backed out
// while waiting for their card to be tapped. Same env vars as
// /api/terminal-checkout.

import { notifyTerminalStatus } from '../../_shared/queue.js';

export async function onRequestPost(context) {
  const { params, env } = context;
  const checkoutId = params.id;

  if (!env.SQUARE_ACCESS_TOKEN) {
    return json({ error: 'Server not configured: missing SQUARE_ACCESS_TOKEN' }, 500);
  }

  const baseUrl = env.SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  const squareRes = await fetch(`${baseUrl}/v2/terminals/checkouts/${checkoutId}/cancel`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': '2026-07-15'
    }
  });

  const data = await squareRes.json();
  if (!squareRes.ok) {
    return json({ error: data.errors?.[0]?.detail || 'Square API error (cancel)' }, squareRes.status);
  }

  const deviceId = data.checkout?.device_options?.device_id;
  context.waitUntil?.(notifyTerminalStatus(env, deviceId, 'available'));

  return json({ checkoutId, status: data.checkout.status });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
