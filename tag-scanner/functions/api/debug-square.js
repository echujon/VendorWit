// TEMPORARY debug endpoint: GET /api/debug-square
// Reports what this Worker actually sees for Square config at runtime, and
// makes the same merchants/me call terminal-checkout.js makes, so we can
// compare against a direct curl test. Never reveals the full access token -
// only its length and first/last few characters, enough to catch a
// copy-paste issue (stray whitespace, wrong token, etc.) without leaking it.
//
// Remove this file once the Terminal auth issue is resolved - it's a
// diagnostic tool, not something that should stay in production.

export async function onRequestGet(context) {
  const { env } = context;

  const token = env.SQUARE_ACCESS_TOKEN || '';
  const tokenInfo = token
    ? `present, length ${token.length}, starts "${token.slice(0, 4)}", ends "${token.slice(-4)}"`
    : 'MISSING';

  const baseUrl = env.SQUARE_ENVIRONMENT === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';

  const result = {
    SQUARE_ENVIRONMENT: env.SQUARE_ENVIRONMENT || 'MISSING (defaults to sandbox)',
    resolvedBaseUrl: baseUrl,
    SQUARE_ACCESS_TOKEN: tokenInfo
  };

  if (token) {
    try {
      const res = await fetch(`${baseUrl}/v2/merchants/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Square-Version': '2026-07-15'
        }
      });
      const data = await res.json();
      result.merchantLookup = { status: res.status, body: data };
    } catch (err) {
      result.merchantLookup = { error: err.message };
    }
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}
