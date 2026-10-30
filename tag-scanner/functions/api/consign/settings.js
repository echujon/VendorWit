// Routed manually (see _worker.js): /api/consign/settings
// GET  - current consignment_slug/eventName/terms/maxItems for the
//        caller's own location, plus the full shareable URL once a
//        slug is set
// POST { slug, eventName, terms, maxItems } - update them
// POST /window - open/close the online or in-person form (see below)
// Staff-authenticated via the existing X-Location-Code / resolveLocation
// (see functions/_shared/location.js) - NOT the public consignor flow in
// the rest of this directory. Scoped to the caller's own location, same
// as every other staff endpoint.

import { resolveLocation } from '../../_shared/location.js';

const SLUG_RE = /^[a-z0-9-]{3,40}$/;

export async function onRequestGet(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  if (loc.role !== 'admin') return json({ error: 'Admins only' }, 403);

  const row = await env.DB.prepare(
    `SELECT consignment_slug, consignment_event_name, consignment_terms, consignment_max_items,
            consignment_online_expires_at, consignment_inperson_expires_at, consignment_inperson_key
     FROM locations WHERE id = ?`
  ).bind(loc.locationId).first();

  return json({
    slug: row.consignment_slug || '',
    eventName: row.consignment_event_name || '',
    terms: row.consignment_terms || '',
    maxItems: row.consignment_max_items || null,
    ...windowFields(row, new URL(request.url).origin)
  });
}

// POST /api/consign/settings/window  { form: 'online' | 'inperson', days }
// Opens that form for `days` days from now (reopening restarts the
// clock); days = 0 closes it immediately. The in-person key is created on
// first open and then kept, so a printed QR code keeps working across
// reopenings.
export async function onRequestPostWindow(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  if (loc.role !== 'admin') return json({ error: 'Admins only' }, 403);

  const body = await request.json().catch(() => ({}));
  const form = body.form;
  const days = Number(body.days);
  if (form !== 'online' && form !== 'inperson') return json({ error: 'form must be online or inperson' }, 400);
  if (!Number.isFinite(days) || days < 0 || days > 60) return json({ error: 'Days must be between 0 and 60' }, 400);

  const row = await env.DB.prepare(
    'SELECT consignment_slug, consignment_inperson_key FROM locations WHERE id = ?'
  ).bind(loc.locationId).first();
  if (!row.consignment_slug) return json({ error: 'Save a Shareable Link Name first' }, 400);

  const expiresAt = Date.now() + Math.round(days * 24 * 60 * 60 * 1000);
  if (form === 'online') {
    await env.DB.prepare('UPDATE locations SET consignment_online_expires_at = ? WHERE id = ?')
      .bind(expiresAt, loc.locationId).run();
  } else {
    const key = row.consignment_inperson_key || randomKey();
    await env.DB.prepare('UPDATE locations SET consignment_inperson_expires_at = ?, consignment_inperson_key = ? WHERE id = ?')
      .bind(expiresAt, key, loc.locationId).run();
  }

  const updated = await env.DB.prepare(
    'SELECT consignment_slug, consignment_online_expires_at, consignment_inperson_expires_at, consignment_inperson_key FROM locations WHERE id = ?'
  ).bind(loc.locationId).first();
  return json(windowFields(updated, new URL(request.url).origin));
}

function windowFields(row, origin) {
  const slug = row.consignment_slug;
  return {
    shareUrl: slug ? `${origin}/consign/${slug}` : null,
    inPersonUrl: slug && row.consignment_inperson_key ? `${origin}/consign/${slug}/in-person/${row.consignment_inperson_key}` : null,
    onlineExpiresAt: row.consignment_online_expires_at || null,
    inPersonExpiresAt: row.consignment_inperson_expires_at || null
  };
}

function randomKey() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  if (loc.role !== 'admin') return json({ error: 'Admins only' }, 403);

  const body = await request.json().catch(() => ({}));
  const slug = (body.slug || '').trim().toLowerCase();
  const eventName = (body.eventName || '').trim();
  const terms = (body.terms || '').trim();
  const maxItemsRaw = (body.maxItems ?? '').toString().trim();
  const maxItems = maxItemsRaw ? parseInt(maxItemsRaw, 10) : null;
  if (!SLUG_RE.test(slug)) {
    return json({ error: 'Link must be 3-40 characters: lowercase letters, numbers, and hyphens only' }, 400);
  }
  if (maxItemsRaw && (!Number.isInteger(maxItems) || maxItems <= 0)) {
    return json({ error: 'Max items must be a positive whole number, or left blank' }, 400);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM locations WHERE consignment_slug = ? AND id != ?'
  ).bind(slug, loc.locationId).first();
  if (existing) return json({ error: 'That link is already in use - pick a different one' }, 409);

  await env.DB.prepare(
    'UPDATE locations SET consignment_slug = ?, consignment_event_name = ?, consignment_terms = ?, consignment_max_items = ? WHERE id = ?'
  ).bind(slug, eventName || null, terms, maxItems, loc.locationId).run();

  const updated = await env.DB.prepare(
    'SELECT consignment_slug, consignment_online_expires_at, consignment_inperson_expires_at, consignment_inperson_key FROM locations WHERE id = ?'
  ).bind(loc.locationId).first();

  return json({
    slug,
    eventName,
    terms,
    maxItems,
    ...windowFields(updated, new URL(request.url).origin)
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
