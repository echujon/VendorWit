// Cloudflare Pages Function: POST /api/terminal-checkout
// Creates a Square Order for the cart, then a Terminal checkout referencing
// that order (with show_itemized_cart) so the paired Terminal displays each
// item, not just a flat total. The Square access token never reaches the
// client — it's read here from Pages environment variables (Cloudflare
// dashboard > Pages project > Settings > Environment variables), configured
// as a secret. The device id is not secret and is supplied per-request by
// the client (see js/app.js / settings), so a single deployment isn't locked
// to one fixed Terminal.
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

  const items = Array.isArray(body.items) ? body.items : [];
  const lineItems = [];
  for (const item of items) {
    const price = parseFloat(item.price);
    const quantity = parseInt(item.quantity, 10) || 1;
    if (!item.name || isNaN(price) || price <= 0) {
      return json({ error: 'Each item needs a name and a positive price' }, 400);
    }
    lineItems.push({
      name: String(item.name),
      quantity: String(quantity),
      base_price_money: { amount: Math.round(price * 100), currency: 'USD' }
    });
  }
  if (!lineItems.length) {
    return json({ error: 'items must be a non-empty array' }, 400);
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

  const headers = {
    'Authorization': `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
    'Content-Type': 'application/json',
    'Square-Version': '2026-07-15'
  };

  // The order needs a location id — pull the merchant's main location rather
  // than requiring it as separate config.
  const merchantRes = await fetch(`${baseUrl}/v2/merchants/me`, { headers });
  const merchantData = await merchantRes.json();
  if (!merchantRes.ok) {
    return json({ error: merchantData.errors?.[0]?.detail || 'Square API error (merchant lookup)' }, merchantRes.status);
  }
  const locationId = merchantData.merchant.main_location_id;

  const orderRes = await fetch(`${baseUrl}/v2/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      order: { location_id: locationId, line_items: lineItems }
    })
  });
  const orderData = await orderRes.json();
  if (!orderRes.ok) {
    return json({ error: orderData.errors?.[0]?.detail || 'Square API error (order)' }, orderRes.status);
  }

  const squareRes = await fetch(`${baseUrl}/v2/terminals/checkouts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      checkout: {
        order_id: orderData.order.id,
        device_options: { device_id: deviceId, show_itemized_cart: true },
        note: body.note || ''
      }
    })
  });

  const data = await squareRes.json();
  if (!squareRes.ok) {
    return json({ error: data.errors?.[0]?.detail || 'Square API error (checkout)' }, squareRes.status);
  }

  return json({ checkoutId: data.checkout.id, status: data.checkout.status });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
