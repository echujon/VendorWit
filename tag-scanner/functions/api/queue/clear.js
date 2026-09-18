// Cloudflare Pages Function: POST /api/queue/clear
// Admin escape hatch: empties the wait queue entirely. For when requests
// got stuck (e.g. queued while a terminal was wrongly stuck "busy", then
// never auto-assigned once it recovered) and there's no single clientId
// to target with /api/queue/cancel.

import { forwardToQueue } from '../../_shared/queue.js';

export async function onRequestPost(context) {
  const { env } = context;
  if (!env.TERMINAL_QUEUE) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500 });
  const res = await forwardToQueue(env, context.request, '/clear-queue');
  return new Response(res.body, res);
}
