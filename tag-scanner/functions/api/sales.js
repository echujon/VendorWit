// Cloudflare Pages Function: /api/sales
// GET  - list every completed sale for the location resolved from
//        X-Location-Code, most recent first - this is the data behind the
//        in-app Sales Report and its CSV export.
// POST - record one completed sale (Cash, Venmo, or a Square Terminal card
//        payment) - called right when a sale actually finishes, alongside
//        the existing inventory-decrement step (see recordSale in
//        js/app.js), not before.

import { resolveLocation } from '../_shared/location.js';

function rowToSale(row) {
  return {
    id: row.id,
    total: row.total,
    paymentMethod: row.payment_method,
    items: JSON.parse(row.items_json),
    createdAt: row.created_at
  };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const { results } = await env.DB.prepare(
    'SELECT * FROM sales WHERE location_id = ? ORDER BY created_at DESC'
  ).bind(loc.locationId).all();

  return json(results.map(rowToSale));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const body = await request.json().catch(() => ({}));
  if (!body.total || !body.paymentMethod || !Array.isArray(body.items) || !body.items.length) {
    return json({ error: 'total, paymentMethod, and a non-empty items array are required' }, 400);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO sales (id, location_id, total, payment_method, items_json)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, loc.locationId, String(body.total), body.paymentMethod, JSON.stringify(body.items)).run();

  const row = await env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first();
  return json(rowToSale(row));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
