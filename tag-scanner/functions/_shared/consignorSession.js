// Session/token helpers for the public consignor registration flow (see
// migrations/0010_consignment.sql). Entirely separate from the staff
// app's join_code (see functions/_shared/location.js) - these are
// high-entropy random values looked up directly in D1, same trust model
// as join_code, just scoped to one consignor instead of a whole location.

const SESSION_COOKIE_NAME = 'consignor_session';

function toBase64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomSessionToken() {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

// Slight modulo bias from %1000000 on a uint32 is negligible here - this
// is a short-lived, attempt-limited OTP code, not a cryptographic key.
export function randomCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

// Scoped to /api/consign so it's never sent on the staff app's own
// /api/* calls, and only marked Secure when the request is actually
// https - local dev over plain http would otherwise silently drop it.
export function sessionCookieHeader(token, request) {
  const isHttps = new URL(request.url).protocol === 'https:';
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/api/consign',
    'SameSite=Lax',
    `Max-Age=${7 * 24 * 60 * 60}`
  ];
  if (isHttps) parts.push('Secure');
  return parts.join('; ');
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return match ? match.slice(name.length + 1) : null;
}

// Also checks the session's consignor belongs to `slug`'s location, so
// registering for two different events in the same browser can't
// cross-contaminate sessions (same cookie name/path covers both).
export async function resolveConsignorSession(request, env, slug) {
  const token = getCookie(request, SESSION_COOKIE_NAME);
  if (!token) return { authenticated: false };

  const row = await env.DB.prepare(`
    SELECT c.id, c.email, c.phone, c.address, c.signed_name, c.signed_at,
           l.name AS location_name, l.consignment_terms, l.consignment_slug,
           s.expires_at
    FROM consignor_sessions s
    JOIN consignors c ON c.id = s.consignor_id
    JOIN locations l ON l.id = c.location_id
    WHERE s.token = ?
  `).bind(token).first();

  if (!row || row.expires_at < Date.now() || row.consignment_slug !== slug) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    consignor: {
      id: row.id,
      email: row.email,
      phone: row.phone || '',
      address: row.address || '',
      signedName: row.signed_name || '',
      signedAt: row.signed_at || null
    },
    location: { name: row.location_name, terms: row.consignment_terms || '' }
  };
}

export { SESSION_COOKIE_NAME };
