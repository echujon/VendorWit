// Routed manually (see _worker.js): /api/items/:id
// PATCH  - partial update (only fields present in the body are changed)
// DELETE - remove one item
// Scoped by the same X-Location-Code resolution as items.js - the WHERE
// clause on location_id means one location can never touch another's item,
// even if it somehow knew the id.

import { resolveLocation } from '../../_shared/location.js';
import { rowToRecord } from '../../_shared/items.js';

const COLUMN_BY_FIELD = {
  uniqueId: 'unique_id', name: 'name', item: 'item', brand: 'brand', size: 'size',
  color: 'color', price: 'price', quantity: 'quantity', location: 'bin_location',
  stripeId: 'stripe_id', priceId: 'price_id', sentToStripe: 'sent_to_stripe',
  photoDataUrl: 'photo_data_url'
};

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const body = await request.json().catch(() => ({}));
  const sets = [];
  const values = [];
  for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
    if (field in body) {
      sets.push(`${column} = ?`);
      values.push(field === 'sentToStripe' ? (body[field] ? 1 : 0) : body[field]);
    }
  }
  if ('embeddingGemini' in body) { sets.push('embedding_gemini = ?'); values.push(JSON.stringify(body.embeddingGemini)); }
  if ('embeddingClip' in body) { sets.push('embedding_clip = ?'); values.push(JSON.stringify(body.embeddingClip)); }
  if ('otherFields' in body) { sets.push('other_fields_json = ?'); values.push(JSON.stringify(body.otherFields)); }
  if (!sets.length) return json({ error: 'No fields to update' }, 400);

  sets.push("updated_at = datetime('now')");
  values.push(params.id, loc.locationId);

  await env.DB.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ? AND location_id = ?`).bind(...values).run();

  const row = await env.DB.prepare('SELECT * FROM items WHERE id = ? AND location_id = ?').bind(params.id, loc.locationId).first();
  if (!row) return json({ error: 'Not found' }, 404);
  return json(rowToRecord(row));
}

export async function onRequestDelete(context) {
  const { request, env, params } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  await env.DB.prepare('DELETE FROM items WHERE id = ? AND location_id = ?').bind(params.id, loc.locationId).run();
  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
