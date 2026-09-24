// Cloudflare Pages Function: /api/items
// GET  - list every item for the location resolved from X-Location-Code
// POST - create one
//
// Replaces the old localStorage-based record store (js/storage.js) with a
// shared D1-backed one, scoped per location so everyone at a location sees
// the same inventory. See migrations/0001_init.sql for the schema and
// functions/_shared/location.js for how the location is resolved.

import { resolveLocation } from '../_shared/location.js';
import { rowToRecord } from '../_shared/items.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const { results } = await env.DB.prepare(
    'SELECT * FROM items WHERE location_id = ? ORDER BY created_at DESC'
  ).bind(loc.locationId).all();

  return json(results.map(rowToRecord));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const body = await request.json().catch(() => ({}));
  const id = crypto.randomUUID();

  await env.DB.prepare(`
    INSERT INTO items (
      id, location_id, unique_id, name, item, brand, size, color, price,
      quantity, bin_location, stripe_id, price_id, sent_to_stripe,
      photo_data_url, embedding_gemini, embedding_clip, other_fields_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, loc.locationId,
    body.uniqueId || null, body.name || null, body.item || null, body.brand || null,
    body.size || null, body.color || null, body.price || null, body.quantity || null,
    body.location || null, body.stripeId || null, body.priceId || null,
    body.sentToStripe ? 1 : 0, body.photoDataUrl || null,
    body.embeddingGemini ? JSON.stringify(body.embeddingGemini) : null,
    body.embeddingClip ? JSON.stringify(body.embeddingClip) : null,
    body.otherFields ? JSON.stringify(body.otherFields) : null
  ).run();

  const row = await env.DB.prepare('SELECT * FROM items WHERE id = ?').bind(id).first();
  return json(rowToRecord(row));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
