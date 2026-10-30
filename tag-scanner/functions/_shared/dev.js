// Dev access: one platform-wide key (the DEV_KEY Cloudflare secret, or
// .dev.vars locally), sent as X-Dev-Key. Sits above every organization/
// location - unlike join_code/aide_code (functions/_shared/location.js),
// it isn't tied to any one event.

export const DEV_HEADER = 'X-Dev-Key';
const FAILURE_DELAY_MS = 1000;

export async function requireDev(request, env) {
  if (!env.DEV_KEY) return { error: 'Dev access is not configured on this server', status: 503 };
  const provided = (request.headers.get(DEV_HEADER) || '').trim();
  if (!provided || !(await keysMatch(provided, env.DEV_KEY))) {
    // Slows down guessing; the key itself is long and random either way.
    await new Promise(r => setTimeout(r, FAILURE_DELAY_MS));
    return { error: 'Invalid dev key', status: 401 };
  }
  return { ok: true };
}

// Compares SHA-256 digests so the comparison time doesn't depend on how
// many leading characters of a guess happen to be right.
async function keysMatch(a, b) {
  const enc = new TextEncoder();
  const [da, db] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  const va = new Uint8Array(da), vb = new Uint8Array(db);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}
