// Cloudflare Pages Function: POST /api/square/cash-receipt
// Body: { paymentId, deviceId }
//
// Tells a paired Terminal to print a receipt for an already-recorded cash
// payment (see cash-payment.js) - this is the only part that actually
// touches the Terminal hardware. print_only: true prints directly instead
// of showing the Print/Email/Text selection screen, since by the time
// this is called the customer has already said they want a physical copy.

import { resolveLocation } from '../../_shared/location.js';
import { getSquareCredentials, squareBaseUrl } from '../../_shared/square.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const body = await request.json().catch(() => ({}));
  const paymentId = (body.paymentId || '').trim();
  const deviceId = (body.deviceId || '').trim().replace(/^device:/, '');
  if (!paymentId || !deviceId) {
    return json({ error: 'paymentId and deviceId are required' }, 400);
  }

  const creds = await getSquareCredentials(env, loc.organizationId);
  if (!creds.accessToken) {
    return json({ error: 'Square is not connected for this organization' }, 400);
  }

  const baseUrl = squareBaseUrl(creds.environment);
  const headers = {
    'Authorization': `Bearer ${creds.accessToken}`,
    'Content-Type': 'application/json',
    'Square-Version': '2026-07-15'
  };

  const res = await fetch(`${baseUrl}/v2/terminals/actions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      action: {
        device_id: deviceId,
        type: 'RECEIPT',
        receipt_options: { payment_id: paymentId, print_only: true }
      }
    })
  });

  const data = await res.json();
  if (!res.ok) {
    return json({ error: data.errors?.[0]?.detail || 'Square API error (terminal receipt action)' }, res.status);
  }

  return json({ actionId: data.action.id, status: data.action.status });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
