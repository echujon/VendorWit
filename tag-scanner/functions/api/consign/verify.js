// Routed manually (see _worker.js): POST /api/consign/verify
// Body: { slug, email, code }
// Public. Checks the most recent unexpired, unused login_codes row for
// this location+email against the submitted code. On match, establishes
// a consignor_sessions row and sets the session cookie. Responses are
// deliberately generic (no "expired" vs "wrong" distinction) so there's
// nothing to learn by guessing.

import { randomSessionToken, sessionCookieHeader } from '../../_shared/consignorSession.js';
import { resolveConsignForm } from '../../_shared/consignForm.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const body = await request.json().catch(() => ({}));
  const slug = (body.slug || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const code = (body.code || '').trim();
  if (!slug || !email || !code) return json({ error: 'slug, email, and code are required' }, 400);

  const form = await resolveConsignForm(env, slug, null);
  if (form.error) return json({ error: form.error }, form.status);
  const location = form.location;

  const consignor = await env.DB.prepare(
    'SELECT id, phone, address, signed_name, signed_at FROM consignors WHERE location_id = ? AND email = ?'
  ).bind(location.id, email).first();
  if (!consignor) return json({ error: 'Incorrect or expired code' }, 401);

  const loginCode = await env.DB.prepare(`
    SELECT id, code, attempts FROM login_codes
    WHERE consignor_id = ? AND used_at IS NULL AND expires_at > ?
    ORDER BY expires_at DESC LIMIT 1
  `).bind(consignor.id, Date.now()).first();
  if (!loginCode || loginCode.attempts >= MAX_ATTEMPTS) {
    return json({ error: 'Incorrect or expired code' }, 401);
  }

  if (loginCode.code !== code) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').bind(loginCode.id).run();
    return json({ error: 'Incorrect or expired code' }, 401);
  }

  await env.DB.prepare('UPDATE login_codes SET used_at = ? WHERE id = ?').bind(Date.now(), loginCode.id).run();

  const sessionToken = randomSessionToken();
  await env.DB.prepare(`
    INSERT INTO consignor_sessions (token, consignor_id, expires_at)
    VALUES (?, ?, ?)
  `).bind(sessionToken, consignor.id, Date.now() + SESSION_TTL_MS).run();

  return new Response(JSON.stringify({
    locationName: location.name,
    terms: location.terms,
    consignor: {
      email,
      phone: consignor.phone || '',
      address: consignor.address || '',
      signedName: consignor.signed_name || '',
      signedAt: consignor.signed_at || null
    }
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': sessionCookieHeader(sessionToken, request)
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
