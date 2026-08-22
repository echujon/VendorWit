// Cloudflare Pages Function: POST /api/terminal-checkout
// Creates a Square Terminal checkout on a paired device. The Square access
// token never reaches the client — it's read here from Pages environment
// variables (Cloudflare dashboard > Pages project > Settings > Environment
// variables), configured as a secret. The device id is not secret and is
// supplied per-request by the client (see js/app.js / settings), so a single
// deployment isn't locked to one fixed Terminal.
//
// Required environment variables:
//   SQUARE_ACCESS_TOKEN  - sandbox or production access token
//   SQUARE_ENVIRONMENT   - "production" or "sandbox" (defaults to sandbox)

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const amount = parseFloat(body.amount);
  if (isNaN(amount) || amount <= 0) {
    return json({ error: 'amount must be a positive number' }, 400);
  }

  // The Terminal Checkout API wants the plain device id, not the "device:"-
  // prefixed form the newer unified Devices API (GET /v2/devices) returns.
  const deviceId = (body.deviceId || '').trim().replace(/^device:/, '');
  if (!deviceId) {
    return json({ error: 'deviceId is required (set it in Settings)' }, 400);
  }

  if (!env.SQUARE_ACCESS_TOKEN) {
    return json({ error: 'Server not configured: missing SQUARE_ACCESS_TOKEN' }, 500);
  }

  const baseUrl = env.SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  const squareRes = await fetch(`${baseUrl}/v2/terminals/checkouts`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      'Square-Version': '2026-07-15'
    },
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      checkout: {
        amount_money: { amount: Math.round(amount * 100), currency: 'USD' },
        device_options: { device_id: deviceId },
        note: body.note || ''
      }
    })
  });

  const data = await squareRes.json();
  if (!squareRes.ok) {
    return json({ error: data.errors?.[0]?.detail || 'Square API error' }, squareRes.status);
  }

  return json({ checkoutId: data.checkout.id, status: data.checkout.status });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
