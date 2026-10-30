// Cloudflare Pages Function: POST /api/orgs
// Body: { organizationName, locationName }
// Creates an organization and its first location, returning a join code
// staff enter once in Settings to bind their device to that location's
// shared inventory and terminal queue (see functions/_shared/location.js).
// Dev-only (X-Dev-Key, see functions/_shared/dev.js) - otherwise anyone
// could mint organizations.

import { requireDev } from '../_shared/dev.js';

// These codes are credentials, so crypto randomness rather than Math.random.
// 32-char alphabet divides 256 evenly, so `% 32` has no bias.
export function randomJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I - easy to misread
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);
  const dev = await requireDev(request, env);
  if (dev.error) return json({ error: dev.error }, dev.status);

  const body = await request.json().catch(() => ({}));
  const organizationName = (body.organizationName || '').trim();
  const locationName = (body.locationName || '').trim();
  if (!organizationName || !locationName) {
    return json({ error: 'organizationName and locationName are required' }, 400);
  }

  const organizationId = crypto.randomUUID();
  const locationId = crypto.randomUUID();
  const joinCode = randomJoinCode();

  await env.DB.batch([
    env.DB.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)').bind(organizationId, organizationName),
    env.DB.prepare('INSERT INTO locations (id, organization_id, name, join_code) VALUES (?, ?, ?, ?)')
      .bind(locationId, organizationId, locationName, joinCode)
  ]);

  return json({ organizationId, locationId, locationName, joinCode });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
