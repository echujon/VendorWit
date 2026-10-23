// Routed manually (see _worker.js): /api/consign/settings
// GET  - current consignment_slug/consignment_terms for the caller's own
//        location, plus the full shareable URL once a slug is set
// POST { slug, terms } - update them
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

  const row = await env.DB.prepare(
    'SELECT consignment_slug, consignment_terms FROM locations WHERE id = ?'
  ).bind(loc.locationId).first();

  return json({
    slug: row.consignment_slug || '',
    terms: row.consignment_terms || '',
    shareUrl: row.consignment_slug ? `${new URL(request.url).origin}/consign/${row.consignment_slug}` : null
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const body = await request.json().catch(() => ({}));
  const slug = (body.slug || '').trim().toLowerCase();
  const terms = (body.terms || '').trim();
  if (!SLUG_RE.test(slug)) {
    return json({ error: 'Link must be 3-40 characters: lowercase letters, numbers, and hyphens only' }, 400);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM locations WHERE consignment_slug = ? AND id != ?'
  ).bind(slug, loc.locationId).first();
  if (existing) return json({ error: 'That link is already in use - pick a different one' }, 409);

  await env.DB.prepare(
    'UPDATE locations SET consignment_slug = ?, consignment_terms = ? WHERE id = ?'
  ).bind(slug, terms, loc.locationId).run();

  return json({
    slug,
    terms,
    shareUrl: `${new URL(request.url).origin}/consign/${slug}`
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
