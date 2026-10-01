// Routed manually (see _worker.js): GET /api/square/oauth/start
// Redirects to Square's OAuth consent screen for the organization the
// caller's location resolves to. No role gating yet - anyone with a
// location join code can trigger this, same as every other endpoint in
// the app today (see the plan's "Explicitly deferred: admin vs. staff
// roles" note).

import { resolveLocation } from '../../../_shared/location.js';
import { squareBaseUrl } from '../../../_shared/square.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DB) return new Response('Server not configured (DB)', { status: 500 });
  if (!env.SQUARE_OAUTH_CLIENT_ID) return new Response('Server not configured (SQUARE_OAUTH_CLIENT_ID)', { status: 500 });

  const loc = await resolveLocation(request, env);
  if (loc.error) return new Response(loc.error, { status: loc.status });

  const state = crypto.randomUUID();
  await env.DB.prepare(
    'INSERT INTO square_oauth_states (state, organization_id) VALUES (?, ?)'
  ).bind(state, loc.organizationId).run();

  const baseUrl = squareBaseUrl(env.SQUARE_ENVIRONMENT);
  // MERCHANT_PROFILE_READ is needed for the merchants/me lookup in
  // device-codes.js (finds which Square location to attach a pairing code
  // to) - easy to miss since the legacy global token this falls back to
  // is a broader personal access token, not scope-limited like OAuth.
  const scope = ['DEVICE_CREDENTIAL_MANAGEMENT', 'PAYMENTS_WRITE', 'ORDERS_WRITE', 'MERCHANT_PROFILE_READ'].join('+');
  const authorizeUrl = `${baseUrl}/oauth2/authorize`
    + `?client_id=${encodeURIComponent(env.SQUARE_OAUTH_CLIENT_ID)}`
    + `&scope=${scope}`
    + `&session=false`
    + `&state=${encodeURIComponent(state)}`;

  return Response.redirect(authorizeUrl, 302);
}
