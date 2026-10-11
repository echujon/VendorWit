// Cloudflare Pages Function: POST /api/square/cash-payment
// Body: { amount }
//
// Records a cash sale as a real Square Payment (source_id: "CASH") so it
// shows up in Square's own Dashboard/reports alongside card sales, not
// just in this app's local Sales Report. This never touches a Terminal -
// it's a plain Payments API call. Printing a physical receipt for it is a
// separate, later step (see cash-receipt.js) that references the
// payment_id this returns.
//
// Square computes change_back_money itself from the gap between
// amount_money and cash_details.buyer_supplied_money - there's no
// "amount tendered" step in this app yet, so both are set equal (no
// change due) rather than asking the customer to type in cash handed over.

import { resolveLocation } from '../../_shared/location.js';
import { getSquareCredentials, squareBaseUrl } from '../../_shared/square.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const body = await request.json().catch(() => ({}));
  const amount = parseFloat(body.amount);
  if (isNaN(amount) || amount <= 0) {
    return json({ error: 'A positive amount is required' }, 400);
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

  const amountCents = Math.round(amount * 100);
  const res = await fetch(`${baseUrl}/v2/payments`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      source_id: 'CASH',
      amount_money: { amount: amountCents, currency: 'USD' },
      cash_details: {
        buyer_supplied_money: { amount: amountCents, currency: 'USD' }
      }
    })
  });

  const data = await res.json();
  if (!res.ok) {
    return json({ error: data.errors?.[0]?.detail || 'Square API error (cash payment)' }, res.status);
  }

  return json({ paymentId: data.payment.id });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
