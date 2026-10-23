// Routed manually (see _worker.js): GET /api/consign/me?slug=
// Public, cookie-based. Lets a reloaded/returning browser skip back to
// the right step (already authenticated, or already signed) without
// re-requesting a code.

import { resolveConsignorSession } from '../../_shared/consignorSession.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const slug = (new URL(request.url).searchParams.get('slug') || '').trim();
  if (!slug) return json({ error: 'slug is required' }, 400);

  const session = await resolveConsignorSession(request, env, slug);
  if (!session.authenticated) return json({ authenticated: false });

  return json({
    authenticated: true,
    locationName: session.location.name,
    terms: session.location.terms,
    consignor: session.consignor
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
