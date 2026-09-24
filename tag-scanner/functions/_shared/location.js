// Resolves the X-Location-Code request header to a location via D1. Every
// inventory/queue endpoint that needs to scope data per location calls this
// first. There's no full user auth yet (see tag-scanner/README.md) -
// anyone holding a location's join code can act as that location, matching
// the app's existing no-login posture everywhere else; a real per-staff
// auth key is planned as a later phase, not this one.

export async function resolveLocation(request, env) {
  // Browsers can't set custom headers on a WebSocket handshake, so
  // /api/queue/connect passes the code as a query param instead; every
  // other endpoint uses the header.
  const url = new URL(request.url);
  const code = (request.headers.get('X-Location-Code') || url.searchParams.get('locationCode') || '').trim();
  if (!code) return { error: 'Missing location code', status: 401 };
  if (!env.DB) return { error: 'Server not configured (DB)', status: 500 };

  const row = await env.DB.prepare(
    'SELECT id, organization_id, name FROM locations WHERE join_code = ?'
  ).bind(code).first();
  if (!row) return { error: 'Invalid location code', status: 401 };

  return { locationId: row.id, organizationId: row.organization_id, locationName: row.name };
}
