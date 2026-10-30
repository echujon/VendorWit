// Routed manually (see _worker.js): POST /api/consign/in-person-register
// Body: { slug, email, phone, address, signedName, agreedToTerms }
// Header: X-Consign-Access: <in-person key>
// Public. The in-person counterpart to request-code + verify + submit in
// one step: no email verification, since the consignor is standing at
// the booth. Establishes the same session cookie as verify.js so the
// rest of the flow (adding items) is shared with the online form.

import { resolveConsignForm, accessKeyFromRequest } from '../../_shared/consignForm.js';
import { randomSessionToken, sessionCookieHeader } from '../../_shared/consignorSession.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const body = await request.json().catch(() => ({}));
  const slug = (body.slug || '').trim();
  const form = await resolveConsignForm(env, slug, accessKeyFromRequest(request));
  if (form.error) return json({ error: form.error }, form.status);
  if (form.mode !== 'inperson') return json({ error: 'Unknown registration link' }, 404);

  const email = (body.email || '').trim().toLowerCase();
  const phone = (body.phone || '').trim();
  const address = (body.address || '').trim();
  const signedName = (body.signedName || '').trim();
  if (!email || !phone || !address || !signedName || body.agreedToTerms !== true) {
    return json({ error: 'Email, phone, address, signed name, and agreement are all required' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Enter a valid email address' }, 400);
  }

  // Unverified, so never hand out a session for someone else's finished
  // registration just because their email was typed in. An unsigned row
  // (online "request a code" that was never completed) holds nothing yet,
  // so it's safe to complete here.
  const existing = await env.DB.prepare(
    'SELECT id, signed_at FROM consignors WHERE location_id = ? AND email = ?'
  ).bind(form.location.id, email).first();
  if (existing?.signed_at) {
    return json({ error: 'This email is already registered for this event. Please see a staff member.' }, 409);
  }

  const consignorId = existing?.id || crypto.randomUUID();
  const signedIp = request.headers.get('CF-Connecting-IP') || '';
  if (existing) {
    await env.DB.prepare(`
      UPDATE consignors
      SET phone = ?, address = ?, signed_name = ?, signed_terms_snapshot = ?,
          signed_ip = ?, signed_at = datetime('now')
      WHERE id = ?
    `).bind(phone, address, signedName, form.location.terms, signedIp, consignorId).run();
  } else {
    await env.DB.prepare(`
      INSERT INTO consignors (id, location_id, email, phone, address, signed_name,
                              signed_terms_snapshot, signed_ip, signed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(consignorId, form.location.id, email, phone, address, signedName, form.location.terms, signedIp).run();
  }

  const sessionToken = randomSessionToken();
  await env.DB.prepare(
    'INSERT INTO consignor_sessions (token, consignor_id, expires_at) VALUES (?, ?, ?)'
  ).bind(sessionToken, consignorId, Date.now() + SESSION_TTL_MS).run();

  return new Response(JSON.stringify({ ok: true }), {
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
