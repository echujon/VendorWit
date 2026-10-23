// Routed manually (see _worker.js): POST /api/consign/submit
// Body: { slug, phone, address, signedName, agreedToTerms }
// Public, cookie-based. Finalizes a consignor's registration: phone,
// address, and a digital signature on that event's current consignment
// agreement. signed_terms_snapshot captures the agreement text as it
// read AT signing time, since locations.consignment_terms could be
// edited by staff later - this is the legal record of what was actually
// agreed to.

import { resolveConsignorSession } from '../../_shared/consignorSession.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const body = await request.json().catch(() => ({}));
  const slug = (body.slug || '').trim();
  if (!slug) return json({ error: 'slug is required' }, 400);

  const session = await resolveConsignorSession(request, env, slug);
  if (!session.authenticated) return json({ error: 'Not authenticated' }, 401);

  const phone = (body.phone || '').trim();
  const address = (body.address || '').trim();
  const signedName = (body.signedName || '').trim();
  if (!phone || !address || !signedName || body.agreedToTerms !== true) {
    return json({ error: 'Phone, address, signed name, and agreement are all required' }, 400);
  }

  const signedIp = request.headers.get('CF-Connecting-IP') || '';

  await env.DB.prepare(`
    UPDATE consignors
    SET phone = ?, address = ?, signed_name = ?, signed_terms_snapshot = ?,
        signed_ip = ?, signed_at = datetime('now')
    WHERE id = ?
  `).bind(phone, address, signedName, session.location.terms, signedIp, session.consignor.id).run();

  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
