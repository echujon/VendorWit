// Routed manually (see _worker.js): POST /api/square/sync-sales
// Body: { startDate, endDate } (ISO date strings)
// Admin only. Pulls completed Square Orders for this location's
// connected Square Location, for a date range, and inserts any that
// aren't already recorded locally - e.g. sales rung up through the
// phone "Send to Square POS" deep-link (launchSquarePOS in js/app.js),
// which complete entirely inside Square's own app with no callback
// here. Terminal checkouts this app creates itself (terminal-
// checkout.js) already carry their Square order id locally (see
// migrations/0016_sales_square_sync.sql), so this naturally skips
// those via ON CONFLICT(square_order_id) DO NOTHING rather than
// double-counting them - but only going forward; a range covering
// Terminal sales recorded before that id was threaded through will
// still double-count (flagged in the Settings UI, not solved here).

import { resolveLocation } from '../../_shared/location.js';
import { getSquareCredentials, squareBaseUrl } from '../../_shared/square.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  if (loc.role !== 'admin') return json({ error: 'Admins only' }, 403);
  if (!loc.squareLocationId) {
    return json({ error: 'No Square Location configured for this location yet - set it in Settings first.' }, 400);
  }

  const body = await request.json().catch(() => ({}));
  const startDate = (body.startDate || '').trim();
  const endDate = (body.endDate || '').trim();
  if (!startDate || !endDate) return json({ error: 'startDate and endDate are required' }, 400);

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

  let imported = 0;
  let skipped = 0;
  let cursor = null;

  do {
    const searchBody = {
      location_ids: [loc.squareLocationId],
      return_entries: false,
      limit: 100,
      query: {
        filter: {
          state_filter: { states: ['COMPLETED'] },
          date_time_filter: {
            closed_at: {
              start_at: new Date(startDate).toISOString(),
              end_at: new Date(endDate + 'T23:59:59.999Z').toISOString()
            }
          }
        },
        sort: { sort_field: 'CLOSED_AT', sort_order: 'ASC' }
      }
    };
    if (cursor) searchBody.cursor = cursor;

    const res = await fetch(`${baseUrl}/v2/orders/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify(searchBody)
    });
    const data = await res.json();
    if (!res.ok) {
      return json({ error: data.errors?.[0]?.detail || 'Square API error (orders search)' }, res.status);
    }

    for (const order of data.orders || []) {
      const items = (order.line_items || []).map(li => ({
        id: `square:${order.id}:${li.uid}`,
        name: li.name || '(no name)',
        price: ((li.base_price_money?.amount || 0) / 100).toFixed(2),
        quantity: parseInt(li.quantity, 10) || 1,
        subVendor: '',
        uniqueId: ''
      }));
      if (!items.length) continue;

      const total = ((order.total_money?.amount || 0) / 100).toFixed(2);
      const createdAt = order.closed_at || order.created_at || new Date().toISOString();

      const result = await env.DB.prepare(`
        INSERT INTO sales (id, location_id, total, payment_method, items_json, square_order_id, created_at)
        VALUES (?, ?, ?, 'square', ?, ?, ?)
        ON CONFLICT(square_order_id) DO NOTHING
      `).bind(crypto.randomUUID(), loc.locationId, total, JSON.stringify(items), order.id, createdAt).run();

      if (result.meta.changes) imported++;
      else skipped++;
    }

    cursor = data.cursor || null;
  } while (cursor);

  return json({ imported, skipped });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
