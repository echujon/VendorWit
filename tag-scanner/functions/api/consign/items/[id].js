// Routed manually (see _worker.js): /api/consign/items/:id
// PATCH { slug, name, description, price, quantity, photoDataUrl? } -
//        edit a submission. photoDataUrl is only touched if the key is
//        present in the body, so editing without picking a new photo
//        leaves the existing one alone.
// DELETE ?slug= - remove a submission
// Public, cookie-based. A consignor can edit/remove their own
// submission, but only while it's still 'pending' - once staff have
// approved or rejected it, it's a record of that decision, not
// something to quietly change.

import { resolveConsignorSession } from '../../../_shared/consignorSession.js';

const ALLOWED_CATEGORIES = ['Skis', 'Snowboard', 'Boots', 'Ski Bindings', 'Snowboard Bindings', 'Poles', 'Helmet', 'Goggles', 'Jacket', 'Pants/Bibs', 'Gloves', 'Accessories', 'Other'];

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const body = await request.json().catch(() => ({}));
  const slug = (body.slug || '').trim();
  if (!slug) return json({ error: 'slug is required' }, 400);

  const session = await resolveConsignorSession(request, env, slug);
  if (!session.authenticated) return session.closed ? json({ error: 'This page is no longer available' }, 410) : json({ error: 'Not authenticated' }, 401);

  const existing = await env.DB.prepare(
    'SELECT status FROM consignor_items WHERE id = ? AND consignor_id = ?'
  ).bind(params.id, session.consignor.id).first();
  if (!existing) return json({ error: 'Not found' }, 404);
  if (existing.status !== 'pending') return json({ error: 'Already reviewed - contact staff to change it' }, 409);

  const name = (body.name || '').trim();
  const description = (body.description || '').trim();
  const category = (body.category || '').trim();
  const price = (body.price || '').trim();
  const quantity = (body.quantity || '1').trim();
  if (!name || !price || !category) return json({ error: 'Name, category, and price are required' }, 400);
  if (!ALLOWED_CATEGORIES.includes(category)) return json({ error: 'Invalid category' }, 400);

  const sets = ['name = ?', 'description = ?', 'category = ?', 'price = ?', 'quantity = ?'];
  const values = [name, description || null, category, price, quantity];
  if ('photoDataUrl' in body) {
    sets.push('photo_data_url = ?');
    values.push(body.photoDataUrl || null);
  }
  values.push(params.id);

  await env.DB.prepare(`UPDATE consignor_items SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();

  const row = await env.DB.prepare(
    'SELECT id, name, description, category, price, quantity, photo_data_url, status, created_at FROM consignor_items WHERE id = ?'
  ).bind(params.id).first();

  return json(rowToItem(row));
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const slug = (new URL(request.url).searchParams.get('slug') || '').trim();
  if (!slug) return json({ error: 'slug is required' }, 400);

  const session = await resolveConsignorSession(request, env, slug);
  if (!session.authenticated) return session.closed ? json({ error: 'This page is no longer available' }, 410) : json({ error: 'Not authenticated' }, 401);

  const row = await env.DB.prepare(
    'SELECT status FROM consignor_items WHERE id = ? AND consignor_id = ?'
  ).bind(params.id, session.consignor.id).first();
  if (!row) return json({ error: 'Not found' }, 404);
  if (row.status !== 'pending') return json({ error: 'Already reviewed - contact staff to change it' }, 409);

  await env.DB.prepare('DELETE FROM consignor_items WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
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
