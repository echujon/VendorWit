// Cloudflare Pages Function: GET /api/terminal-checkout/:id
// Polls Square for the current status of a Terminal checkout created via
// POST /api/terminal-checkout. Same env vars as that endpoint.

import { notifyTerminalStatus } from '../../_shared/queue.js';

export async function onRequestGet(context) {
  const { params, env } = context;
  const checkoutId = params.id;

  if (!env.SQUARE_ACCESS_TOKEN) {
    return json({ error: 'Server not configured: missing SQUARE_ACCESS_TOKEN' }, 500);
  }

  const baseUrl = env.SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  const squareRes = await fetch(`${baseUrl}/v2/terminals/checkouts/${checkoutId}`, {
    headers: {
      'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Square-Version': '2026-07-15'
    }
  });

  const data = await squareRes.json();
  if (!squareRes.ok) {
    return json({ error: data.errors?.[0]?.detail || 'Square API error' }, squareRes.status);
  }

  // Free up the terminal in the queue as soon as we see a terminal status
  // (works even if the Square webhook isn't configured for this deployment,
  // since the client already polls this endpoint regardless).
  if (data.checkout.status === 'COMPLETED' || data.checkout.status === 'CANCELED') {
    const deviceId = data.checkout.device_options?.device_id;
    context.waitUntil?.(notifyTerminalStatus(env, deviceId, 'available'));
  }

  // Relay Square's status verbatim rather than guessing at the full enum —
  // verify exact values (PENDING/IN_PROGRESS/COMPLETED/CANCELED/etc.) against
  // a real sandbox checkout before relying on any specific string client-side.
  return json({ checkoutId, status: data.checkout.status });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
