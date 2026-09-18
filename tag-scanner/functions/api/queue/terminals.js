// Cloudflare Pages Function: /api/queue/terminals
// GET    - list registered terminals { deviceId, name, status }
// POST   - register/update one, body { deviceId, name }
// DELETE - remove one, body { deviceId }
// Backs the Settings page's terminal manager - the pool is shared globally
// (stored in the Durable Object) rather than per-browser localStorage,
// since the queue needs one canonical view of what terminals exist.

import { forwardToQueue } from '../../_shared/queue.js';

async function relay(context, internalPath) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return new Response(JSON.stringify({ error: 'Server not configured' }), { status: 500 });
  const res = await forwardToQueue(env, request, internalPath);
  return new Response(res.body, res);
}

export const onRequestGet = (context) => relay(context, '/terminals');
export const onRequestPost = (context) => relay(context, '/terminals');
export const onRequestDelete = (context) => relay(context, '/terminals');
