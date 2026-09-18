// Cloudflare Pages "Advanced Mode" entrypoint.
//
// This project used to rely on file-based routing (functions/api/**.js
// mapping automatically to routes). That stops working once a Durable
// Object is involved: Pages' auto-generated entrypoint for file-based
// routing only wires up onRequest* handlers - it doesn't re-export other
// top-level bindings like a Durable Object class, which wrangler needs to
// find on *this* module. Advanced Mode (a single _worker.js at the deploy
// root) is the documented way around that: it replaces file-based routing
// entirely, so routing is done by hand below, but this file can export
// whatever the runtime needs.
//
// The actual handler logic still lives in functions/**.js, unchanged -
// they're just plain modules now, invoked directly instead of auto-routed.

export { TerminalQueue } from './functions/durable-objects/terminal-queue.js';

import * as terminalCheckout from './functions/api/terminal-checkout.js';
import * as terminalCheckoutStatus from './functions/api/terminal-checkout/[id].js';
import * as terminalCheckoutCancel from './functions/api/terminal-checkout/cancel.js';
import * as webhookSquare from './functions/api/webhooks/square.js';
import * as queueConnect from './functions/api/queue/connect.js';
import * as queueEnqueue from './functions/api/queue/enqueue.js';
import * as queueStatus from './functions/api/queue/status.js';
import * as queueCancel from './functions/api/queue/cancel.js';
import * as queueTerminals from './functions/api/queue/terminals.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    const context = { request, env, waitUntil: ctx.waitUntil.bind(ctx), params: {} };

    if (pathname === '/api/terminal-checkout' && method === 'POST') {
      return terminalCheckout.onRequestPost(context);
    }

    const checkoutIdMatch = pathname.match(/^\/api\/terminal-checkout\/([^/]+)$/);
    if (checkoutIdMatch && method === 'GET') {
      context.params = { id: checkoutIdMatch[1] };
      return terminalCheckoutStatus.onRequestGet(context);
    }

    const checkoutCancelMatch = pathname.match(/^\/api\/terminal-checkout\/([^/]+)\/cancel$/);
    if (checkoutCancelMatch && method === 'POST') {
      context.params = { id: checkoutCancelMatch[1] };
      return terminalCheckoutCancel.onRequestPost(context);
    }

    if (pathname === '/api/webhooks/square' && method === 'POST') {
      return webhookSquare.onRequestPost(context);
    }

    if (pathname === '/api/queue/connect' && method === 'GET') {
      return queueConnect.onRequestGet(context);
    }
    if (pathname === '/api/queue/enqueue' && method === 'POST') {
      return queueEnqueue.onRequestPost(context);
    }
    if (pathname === '/api/queue/status' && method === 'GET') {
      return queueStatus.onRequestGet(context);
    }
    if (pathname === '/api/queue/cancel' && method === 'POST') {
      return queueCancel.onRequestPost(context);
    }
    if (pathname === '/api/queue/terminals') {
      if (method === 'GET') return queueTerminals.onRequestGet(context);
      if (method === 'POST') return queueTerminals.onRequestPost(context);
      if (method === 'DELETE') return queueTerminals.onRequestDelete(context);
    }

    // Not an API route - serve the static site (index.html, css/, js/,
    // settings/, manifest.json, sw.js) exactly as file-based routing did.
    return env.ASSETS.fetch(request);
  }
};
