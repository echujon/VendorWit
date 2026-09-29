// Resolves which Square credentials to use for a given organization: its
// own OAuth connection if one exists (refreshing the token first if it's
// expired or close to it), else the legacy global env vars as a fallback.
// See tag-scanner/README.md - this is additive, not a cutover: an
// organization that hasn't connected via OAuth keeps working exactly as
// it did before this feature existed.

import { encrypt, decrypt } from './crypto.js';

export function squareBaseUrl(environment) {
  return environment === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

export async function getSquareCredentials(env, organizationId) {
  if (env.DB && organizationId) {
    const row = await env.DB.prepare(
      'SELECT * FROM square_connections WHERE organization_id = ?'
    ).bind(organizationId).first();

    if (row) {
      const expiresAt = Date.parse(row.expires_at);
      const needsRefresh = !expiresAt || expiresAt - Date.now() < 5 * 60 * 1000; // refresh 5 min early
      if (needsRefresh) return refreshConnection(env, row);
      return { accessToken: await decrypt(env, row.access_token), environment: row.environment };
    }
  }

  return { accessToken: env.SQUARE_ACCESS_TOKEN, environment: env.SQUARE_ENVIRONMENT };
}

async function refreshConnection(env, row) {
  const baseUrl = squareBaseUrl(row.environment);
  const refreshToken = await decrypt(env, row.refresh_token);

  const res = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.SQUARE_OAUTH_CLIENT_ID,
      client_secret: env.SQUARE_OAUTH_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.errors?.[0]?.detail || data.error_description || 'Square OAuth refresh failed');
  }

  const encryptedAccess = await encrypt(env, data.access_token);
  const encryptedRefresh = await encrypt(env, data.refresh_token || refreshToken);

  await env.DB.prepare(`
    UPDATE square_connections
    SET access_token = ?, refresh_token = ?, expires_at = ?, updated_at = datetime('now')
    WHERE organization_id = ?
  `).bind(encryptedAccess, encryptedRefresh, data.expires_at, row.organization_id).run();

  return { accessToken: data.access_token, environment: row.environment };
}
