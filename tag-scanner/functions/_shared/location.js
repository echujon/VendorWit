// Resolves the X-Location-Code request header to a location via D1. Every
// inventory/queue endpoint that needs to scope data per location calls this
// first. There's no full user auth yet (see tag-scanner/README.md) -
// anyone holding a location's code can act as that location, matching the
// app's existing no-login posture everywhere else.
//
// Each location has two codes: join_code (admin - full access) and
// aide_code (Vendor Aide - everything except admin-gated endpoints, see
// migrations/0013_location_roles.sql). Role is derived here from which
// column actually matched, so it's enforced server-side on every request
// rather than trusted from anything the client claims - a client-side-only
// role flag (what this started as) isn't real security, since anyone can
// edit localStorage in devtools.

export async function resolveLocation(request, env) {
  // Browsers can't set custom headers on a WebSocket handshake, so
  // /api/queue/connect passes the code as a query param instead; every
  // other endpoint uses the header.
  const url = new URL(request.url);
  const code = (request.headers.get('X-Location-Code') || url.searchParams.get('locationCode') || '').trim();
  if (!code) return { error: 'Missing location code', status: 401 };
  if (!env.DB) return { error: 'Server not configured (DB)', status: 500 };

  const row = await env.DB.prepare(
    'SELECT id, organization_id, name, square_location_id, join_code, aide_code FROM locations WHERE join_code = ? OR aide_code = ?'
  ).bind(code, code).first();
  if (!row) return { error: 'Invalid location code', status: 401 };

  return {
    locationId: row.id,
    organizationId: row.organization_id,
    locationName: row.name,
    squareLocationId: row.square_location_id || null,
    role: code === row.aide_code ? 'aide' : 'admin'
  };
}
