// Routed manually (see _worker.js): /api/consign/items
// GET  ?slug= - list the current session's own submitted items (any
//               status), for the consign page to show what's pending
// POST { slug, name, description, category, price, quantity, photoDataUrl } -
//      submit a new item for review (status starts 'pending' - see
//      migrations/0012_consignment_items.sql for why these aren't live
//      inventory yet)
// Public, cookie-based via resolveConsignorSession - NOT the staff
// review endpoints (see review-items.js).

import { resolveConsignorSession } from '../../_shared/consignorSession.js';

const ALLOWED_CATEGORIES = ['Skis', 'Snowboard', 'Boots', 'Ski Bindings', 'Snowboard Bindings', 'Poles', 'Helmet', 'Goggles', 'Jacket', 'Pants/Bibs', 'Gloves', 'Accessories', 'Other'];

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const slug = (new URL(request.url).searchParams.get('slug') || '').trim();
  if (!slug) return json({ error: 'slug is required' }, 400);

  const session = await resolveConsignorSession(request, env, slug);
  if (!session.authenticated) return json({ error: 'Not authenticated' }, 401);

  const { results } = await env.DB.prepare(
    'SELECT id, name, description, category, price, quantity, photo_data_url, status, created_at FROM consignor_items WHERE consignor_id = ? ORDER BY created_at DESC'
  ).bind(session.consignor.id).all();

  return json({ items: results.map(rowToItem) });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const body = await request.json().catch(() => ({}));
  const slug = (body.slug || '').trim();
  if (!slug) return json({ error: 'slug is required' }, 400);

  const session = await resolveConsignorSession(request, env, slug);
  if (!session.authenticated) return json({ error: 'Not authenticated' }, 401);
  if (!session.consignor.signedAt) {
    return json({ error: 'Finish signing the consignment agreement before adding items' }, 403);
  }

  const name = (body.name || '').trim();
  const description = (body.description || '').trim();
  const category = (body.category || '').trim();
  const price = (body.price || '').trim();
  const quantity = (body.quantity || '1').trim();
  const photoDataUrl = body.photoDataUrl || null;
  if (!name || !price || !category) return json({ error: 'Name, category, and price are required' }, 400);
  if (!ALLOWED_CATEGORIES.includes(category)) return json({ error: 'Invalid category' }, 400);

  const location = await env.DB.prepare(
    'SELECT consignment_max_items FROM locations WHERE id = ?'
  ).bind(session.location.id).first();

  if (location && location.consignment_max_items) {
    const { count } = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM consignor_items WHERE consignor_id = ? AND status != 'rejected'"
    ).bind(session.consignor.id).first();
    if (count >= location.consignment_max_items) {
      return json({ error: `This event allows up to ${location.consignment_max_items} items per consignor` }, 400);
    }
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO consignor_items (id, consignor_id, location_id, name, description, category, price, quantity, photo_data_url)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, session.consignor.id, session.location.id, name, description || null, category, price, quantity, photoDataUrl).run();

  const row = await env.DB.prepare(
    'SELECT id, name, description, category, price, quantity, photo_data_url, status, created_at FROM consignor_items WHERE id = ?'
  ).bind(id).first();

  return json(rowToItem(row));
}

function rowToItem(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    category: row.category || '',
    price: row.price,
    quantity: row.quantity,
    photoDataUrl: row.photo_data_url || null,
    status: row.status,
    createdAt: row.created_at
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
