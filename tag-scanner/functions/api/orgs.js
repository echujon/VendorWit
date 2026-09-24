// Cloudflare Pages Function: POST /api/orgs
// Body: { organizationName, locationName }
// Creates an organization and its first location, returning a join code
// staff enter once in Settings to bind their device to that location's
// shared inventory and terminal queue (see functions/_shared/location.js).
// No auth yet - intentionally simple, matching the rest of the app's
// current no-login posture; a real per-staff auth key is a later phase.

function randomJoinCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I - easy to misread
  let code = '';
  for (let i = 0; i < 8; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

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
