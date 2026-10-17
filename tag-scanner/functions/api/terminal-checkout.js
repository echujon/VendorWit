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
// Credentials come from functions/_shared/square.js: the organization's
// own connected Square account (via OAuth) if one exists, else these
// legacy global env vars as a fallback:
//   SQUARE_ACCESS_TOKEN  - sandbox or production access token
//   SQUARE_ENVIRONMENT   - "production" or "sandbox" (defaults to sandbox)

import { notifyTerminalStatus } from '../_shared/queue.js';
import { resolveLocation } from '../_shared/location.js';
import { getSquareCredentials, squareBaseUrl } from '../_shared/square.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  // Named appLocationId to avoid confusion with Square's own "location"
  // concept (a business location within Square's own system) used further
  // down in this file - the two are unrelated.
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  const appLocationId = loc.locationId;

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

  const creds = await getSquareCredentials(env, loc.organizationId);
  if (!creds.accessToken) {
    return json({ error: 'Server not configured: missing SQUARE_ACCESS_TOKEN' }, 500);
  }

  const baseUrl = squareBaseUrl(creds.environment);

  const headers = {
    'Authorization': `Bearer ${creds.accessToken}`,
    'Content-Type': 'application/json',
    'Square-Version': '2026-07-15'
  };

  // The order needs a Square location id - this used to default to the
  // merchant's main_location_id, which is wrong for an account with
  // several Square Locations (one per event/city, each with its own
  // region-scoped tax - confirmed via a debug check that this account has
  // 9, e.g. "Fort Collins Ski Swap", "Denver Ski Swap"). Each had every
  // tax in the whole account applied regardless of which event was
  // actually running. Now it's required to be configured per app
  // location (Settings - see functions/api/square/set-location.js)
  // rather than guessed, since getting this wrong means charging the
  // wrong sales tax.
  const squareLocationId = loc.squareLocationId;
  if (!squareLocationId) {
    return json({ error: 'No Square Location configured for this location yet - set it in Settings before charging via Terminal.' }, 400);
  }

  // Apply only the tax(es) actually scoped to this Square Location,
  // using Square's own location-scoping fields on the catalog object
  // (present_at_all_locations / present_at_location_ids /
  // absent_at_location_ids - see developer.squareup.com/reference/
  // square/objects/CatalogObject) - not just "every enabled tax in the
  // whole catalog" like before, which applied every city/state's tax to
  // every sale regardless of which event was running.
  const taxRes = await fetch(`${baseUrl}/v2/catalog/list?types=TAX`, { headers });
  const taxData = await taxRes.json();
  if (!taxRes.ok) {
    return json({ error: taxData.errors?.[0]?.detail || 'Square API error (catalog tax lookup)' }, taxRes.status);
  }
  const taxes = (taxData.objects || [])
    .filter(obj => {
      if (obj.is_deleted || obj.tax_data?.enabled === false) return false;
      const presentIds = obj.present_at_location_ids || [];
      const absentIds = obj.absent_at_location_ids || [];
      return obj.present_at_all_locations
        ? !absentIds.includes(squareLocationId)
        : presentIds.includes(squareLocationId);
    })
    .map(obj => ({ catalog_object_id: obj.id, scope: 'ORDER' }));

  // Square's own processing fee passed on to the customer, calculated on
  // the full total (subtotal + tax, not taxed itself) rather than just
  // the item subtotal - TOTAL_PHASE is what applies after tax is figured
  // in. Not configurable yet; a flat 2.5% was explicitly requested.
  const serviceCharges = [{
    name: 'Processing Fee',
    percentage: '2.5',
    calculation_phase: 'TOTAL_PHASE',
    taxable: false
  }];

  const orderRes = await fetch(`${baseUrl}/v2/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotency_key: crypto.randomUUID(),
      order: { location_id: squareLocationId, line_items: lineItems, taxes, service_charges: serviceCharges }
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
        amount_money: { amount: orderData.order.total_money.amount, currency: 'USD' },
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

  context.waitUntil?.(notifyTerminalStatus(env, deviceId, 'busy', appLocationId));

  return json({ checkoutId: data.checkout.id, status: data.checkout.status });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
