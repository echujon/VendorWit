// Routed manually (see _worker.js): POST /api/consign/request-code
// Body: { slug, email }
// Public. Upserts a consignors row for this location+email, then emails
// a 6-digit one-time code (5 min expiry) via functions/_shared/email.js.
// Always responds { ok: true } regardless of whether the consignor
// already existed or the email actually sent - no signal to enumerate
// registered emails by, and a slow/failed provider shouldn't block the
// UI from advancing to the code-entry screen (the user can hit "resend").

import { randomCode } from '../../_shared/consignorSession.js';
import { sendEmail } from '../../_shared/email.js';

const CODE_TTL_MS = 5 * 60 * 1000;
const COOLDOWN_MS = 60 * 1000;

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ error: 'Server not configured (DB)' }, 500);

  const body = await request.json().catch(() => ({}));
  const slug = (body.slug || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  if (!slug || !email) return json({ error: 'slug and email are required' }, 400);

  const location = await env.DB.prepare(
    'SELECT id FROM locations WHERE consignment_slug = ?'
  ).bind(slug).first();
  if (!location) return json({ error: 'Unknown registration link' }, 404);

  const consignorId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO consignors (id, location_id, email)
    VALUES (?, ?, ?)
    ON CONFLICT(location_id, email) DO NOTHING
  `).bind(consignorId, location.id, email).run();

  const consignor = await env.DB.prepare(
    'SELECT id FROM consignors WHERE location_id = ? AND email = ?'
  ).bind(location.id, email).first();

  // A row whose expires_at is still more than (TTL - cooldown) away must
  // have been created within the cooldown window - avoids needing a
  // separate "created at" epoch column just for this check.
  const recent = await env.DB.prepare(`
    SELECT id FROM login_codes
    WHERE consignor_id = ? AND used_at IS NULL AND expires_at > ?
    ORDER BY expires_at DESC LIMIT 1
  `).bind(consignor.id, Date.now() + (CODE_TTL_MS - COOLDOWN_MS)).first();

  if (!recent) {
    const code = randomCode();
    await env.DB.prepare(`
      INSERT INTO login_codes (id, consignor_id, code, expires_at)
      VALUES (?, ?, ?, ?)
    `).bind(crypto.randomUUID(), consignor.id, code, Date.now() + CODE_TTL_MS).run();

    try {
      await sendEmail(env, {
        to: email,
        subject: `Your registration code: ${code}`,
        html: `<p>Your one-time registration code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p><p>This code expires in 5 minutes.</p>`
      });
    } catch (err) {
      // Not configured yet, or the provider failed - log the code itself
      // (visible via `wrangler pages deployment tail`) so the rest of the
      // flow is testable before an email provider is wired up.
      console.warn(`Failed to send consignment registration code email (code was ${code}):`, err.message);
    }
  }

  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
