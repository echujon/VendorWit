// Cloudflare Pages Function: POST /api/queue/cancel
// Body: { clientId }
// Removes that client's pending request from the wait queue, for when
// someone backs out before a terminal was assigned to them. Canceling a
// checkout that's already in progress on a terminal goes through
// POST /api/terminal-checkout/:id/cancel instead.

import { forwardToQueue } from '../../_shared/queue.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500 });
  const res = await forwardToQueue(env, request, '/dequeue');
  return new Response(res.body, res);
}
