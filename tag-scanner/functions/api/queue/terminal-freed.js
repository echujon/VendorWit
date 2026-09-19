// Cloudflare Pages Function: POST /api/queue/terminal-freed
// Body: { deviceId }
// Client-driven fallback for marking a terminal available again. The
// server-side paths (webhooks/square.js, terminal-checkout/[id].js) rely on
// Square echoing device_options.device_id back in the checkout response/
// webhook payload - if that assumption ever turns out wrong for some
// checkout shape, this gives a path that doesn't depend on it at all: the
// client already knows which device it used, since it's the one that sent
// it in the original /api/terminal-checkout request.

import { notifyTerminalStatus } from '../../_shared/queue.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500 });

  const body = await request.json().catch(() => ({}));
  const deviceId = (body.deviceId || '').trim();
  if (!deviceId) return new Response(JSON.stringify({ error: 'deviceId is required' }), { status: 400 });

  await notifyTerminalStatus(env, deviceId, 'available');
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}
