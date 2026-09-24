// Cloudflare Pages "Advanced Mode" entrypoint.
//
// This project uses a single _worker.js instead of file-based Pages
// Functions routing (functions/api/**.js auto-mapped to routes) so routing
// is done by hand below. The actual handler logic still lives in
// functions/**.js, unchanged - they're just plain modules now, invoked
// directly instead of auto-routed.
//
// The TerminalQueue Durable Object class itself does NOT live in this
// project - Pages can't self-host a Durable Object class, so it's defined
// in the separate ../terminal-queue-worker/ Worker and bound cross-script
// here via script_name (see wrangler.toml).

import * as terminalCheckout from './functions/api/terminal-checkout.js';
import * as terminalCheckoutStatus from './functions/api/terminal-checkout/[id].js';
import * as terminalCheckoutCancel from './functions/api/terminal-checkout/cancel.js';
import * as webhookSquare from './functions/api/webhooks/square.js';
import * as queueConnect from './functions/api/queue/connect.js';
import * as queueEnqueue from './functions/api/queue/enqueue.js';
import * as queueStatus from './functions/api/queue/status.js';
import * as queueCancel from './functions/api/queue/cancel.js';
import * as queueClear from './functions/api/queue/clear.js';
import * as queueTerminalFreed from './functions/api/queue/terminal-freed.js';
import * as queueTerminals from './functions/api/queue/terminals.js';
import * as debugSquare from './functions/api/debug-square.js';
import * as orgs from './functions/api/orgs.js';
import * as items from './functions/api/items.js';
import * as itemsById from './functions/api/items/[id].js';

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

    if (pathname === '/api/debug-square' && method === 'GET') {
      return debugSquare.onRequestGet(context);
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
    if (pathname === '/api/queue/clear' && method === 'POST') {
      return queueClear.onRequestPost(context);
    }
    if (pathname === '/api/queue/terminal-freed' && method === 'POST') {
      return queueTerminalFreed.onRequestPost(context);
    }
    if (pathname === '/api/queue/terminals') {
      if (method === 'GET') return queueTerminals.onRequestGet(context);
      if (method === 'POST') return queueTerminals.onRequestPost(context);
      if (method === 'DELETE') return queueTerminals.onRequestDelete(context);
    }

    if (pathname === '/api/orgs' && method === 'POST') {
      return orgs.onRequestPost(context);
    }
    if (pathname === '/api/items') {
      if (method === 'GET') return items.onRequestGet(context);
      if (method === 'POST') return items.onRequestPost(context);
    }
    const itemIdMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
    if (itemIdMatch) {
      context.params = { id: itemIdMatch[1] };
      if (method === 'PATCH') return itemsById.onRequestPatch(context);
      if (method === 'DELETE') return itemsById.onRequestDelete(context);
    }

    // Not an API route - serve the static site (index.html, css/, js/,
    // settings/, manifest.json, sw.js) exactly as file-based routing did.
    return env.ASSETS.fetch(request);
  }
};
