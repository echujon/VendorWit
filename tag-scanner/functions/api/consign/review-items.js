// Routed manually (see _worker.js): GET /api/consign/review-items?status=
// Staff-authenticated via X-Location-Code / resolveLocation - lists
// every item consignors have submitted for this location (optionally
// filtered by status), for staff to approve/reject (see
// review-items/[id].js). Not the public consignor flow.

import { resolveLocation } from '../../_shared/location.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  if (loc.role !== 'admin') return json({ error: 'Admins only' }, 403);

  const status = (new URL(request.url).searchParams.get('status') || '').trim();
  const query = status
    ? env.DB.prepare(`
        SELECT ci.id, ci.name, ci.description, ci.price, ci.quantity, ci.photo_data_url,
               ci.status, ci.created_at, c.email AS consignor_email
        FROM consignor_items ci
        JOIN consignors c ON c.id = ci.consignor_id
        WHERE ci.location_id = ? AND ci.status = ?
        ORDER BY ci.created_at DESC
      `).bind(loc.locationId, status)
    : env.DB.prepare(`
        SELECT ci.id, ci.name, ci.description, ci.price, ci.quantity, ci.photo_data_url,
               ci.status, ci.created_at, c.email AS consignor_email
        FROM consignor_items ci
        JOIN consignors c ON c.id = ci.consignor_id
        WHERE ci.location_id = ?
        ORDER BY ci.created_at DESC
      `).bind(loc.locationId);

  const { results } = await query.all();
  return json({
    items: results.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || '',
      price: row.price,
      quantity: row.quantity,
      photoDataUrl: row.photo_data_url || null,
      status: row.status,
      createdAt: row.created_at,
      consignorEmail: row.consignor_email
    }))
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
