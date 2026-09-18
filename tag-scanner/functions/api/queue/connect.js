// Cloudflare Pages Function: GET /api/queue/connect?clientId=X
// Upgrades to a WebSocket and hands it to the TerminalQueue Durable Object,
// which pushes terminal-availability and queue-assignment events.

import { forwardToQueue } from '../../_shared/queue.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return new Response('Server not configured', { status: 500 });
  return forwardToQueue(env, request, '/connect');
}
