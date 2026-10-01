// Routed manually (see _worker.js): GET /api/square/oauth/callback
// Square redirects here after the user approves (or denies) access.
// Exchanges the authorization code for tokens and stores them (encrypted,
// see functions/_shared/crypto.js) against whichever organization started
// the flow (via the `state` row created in oauth/start.js).
//
// This exact URL must be registered byte-for-byte as the app's OAuth
// redirect URI in the Square Developer Dashboard.

import { encrypt } from '../../../_shared/crypto.js';
import { squareBaseUrl } from '../../../_shared/square.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) return redirectToSettings(url, false, error);
  if (!code || !state) return redirectToSettings(url, false, 'missing_code_or_state');
  if (!env.DB) return new Response('Server not configured (DB)', { status: 500 });

  const stateRow = await env.DB.prepare(
    'SELECT organization_id FROM square_oauth_states WHERE state = ?'
  ).bind(state).first();
  if (!stateRow) return redirectToSettings(url, false, 'invalid_state');

  // Single-use - delete immediately regardless of what happens next.
  await env.DB.prepare('DELETE FROM square_oauth_states WHERE state = ?').bind(state).run();

  const baseUrl = squareBaseUrl(env.SQUARE_ENVIRONMENT);
  const tokenRes = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.SQUARE_OAUTH_CLIENT_ID,
      client_secret: env.SQUARE_OAUTH_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code'
    })
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) {
    return redirectToSettings(url, false, tokenData.error_description || tokenData.error || 'token_exchange_failed');
  }

  const encryptedAccess = await encrypt(env, tokenData.access_token);
  const encryptedRefresh = await encrypt(env, tokenData.refresh_token);
  const environment = env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

  await env.DB.prepare(`
    INSERT INTO square_connections (organization_id, merchant_id, access_token, refresh_token, environment, expires_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(organization_id) DO UPDATE SET
      merchant_id = excluded.merchant_id,
      access_token = excluded.access_token,
      refresh_token = excluded.refresh_token,
      environment = excluded.environment,
      expires_at = excluded.expires_at,
      updated_at = datetime('now')
  `).bind(
    stateRow.organization_id, tokenData.merchant_id, encryptedAccess, encryptedRefresh, environment, tokenData.expires_at
  ).run();

  return redirectToSettings(url, true);
}

// Response.redirect() needs an absolute URL, not a relative path - build
// one from the incoming request's own origin rather than hardcoding a
// domain (which would break across local dev/tunnel/production).
function redirectToSettings(requestUrl, success, reason) {
  const qs = success ? 'square_connected=1' : `square_connect_error=${encodeURIComponent(reason || 'unknown')}`;
  return Response.redirect(`${requestUrl.origin}/settings?${qs}`, 302);
}
