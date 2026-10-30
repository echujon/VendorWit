// Routed manually (see _worker.js): GET /api/consign/location?slug=
// Public (no X-Location-Code, no session) - resolves a shareable
// consignment_slug (plus the in-person key, if any, via X-Consign-Access)
// to the event's display name and which form this is, for the first
// screen of the public registration page (consign/index.html). 410 once
// that form's window has closed.

import { resolveConsignForm, accessKeyFromRequest } from '../../_shared/consignForm.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const slug = (new URL(request.url).searchParams.get('slug') || '').trim();
  const form = await resolveConsignForm(env, slug, accessKeyFromRequest(request));
  if (form.error) return json({ error: form.error }, form.status);

  return json({
    locationName: form.location.name,
    mode: form.mode,
    // The in-person form signs without a session first, so it needs the
    // terms up front; the online form gets them after verifying.
    terms: form.mode === 'inperson' ? form.location.terms : undefined,
    expiresAt: form.expiresAt
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
