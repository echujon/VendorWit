// Encrypts/decrypts Square OAuth tokens before they touch D1, using
// AES-GCM via the Web Crypto API (built into the Workers runtime, no
// dependency needed). Defensive measure: even a raw database dump/export
// shouldn't hand over directly-usable Square credentials for every
// connected organization.
//
// Requires SQUARE_OAUTH_ENCRYPTION_KEY - a base64-encoded 32-byte key,
// generated once with `openssl rand -base64 32` and stored as a Cloudflare
// Secret (never in wrangler.toml - it's as sensitive as the tokens it
// protects).

async function getKey(env) {
  if (!env.SQUARE_OAUTH_ENCRYPTION_KEY) {
    throw new Error('Server not configured: missing SQUARE_OAUTH_ENCRYPTION_KEY');
  }
  const raw = Uint8Array.from(atob(env.SQUARE_OAUTH_ENCRYPTION_KEY), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

// Returns a single string ("iv.ciphertext", both base64) so it fits in one
// TEXT column without a separate IV field to manage.
export async function encrypt(env, plaintext) {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  return `${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function decrypt(env, stored) {
  const key = await getKey(env);
  const [ivB64, ciphertextB64] = stored.split('.');
  const iv = fromBase64(ivB64);
  const ciphertext = fromBase64(ciphertextB64);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
