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
import * as queueAssignmentStatus from './functions/api/queue/assignment-status.js';
import * as queueActiveSales from './functions/api/queue/active-sales.js';
import * as queueActiveSalesById from './functions/api/queue/active-sales/[id].js';
import * as queueActiveSalesKeep from './functions/api/queue/active-sales/keep.js';
import * as debugSquare from './functions/api/debug-square.js';
import * as orgs from './functions/api/orgs.js';
import * as items from './functions/api/items.js';
import * as itemsById from './functions/api/items/[id].js';
import * as sales from './functions/api/sales.js';
import * as squareOauthStart from './functions/api/square/oauth/start.js';
import * as squareOauthCallback from './functions/api/square/oauth/callback.js';
import * as squareConnection from './functions/api/square/connection.js';
import * as squareLocations from './functions/api/square/locations.js';
import * as squareSetLocation from './functions/api/square/set-location.js';
import * as squareDeviceCodes from './functions/api/square/device-codes.js';
import * as squareDeviceCodesStatus from './functions/api/square/device-codes-status.js';
import * as squareCashPayment from './functions/api/square/cash-payment.js';
import * as squareCashReceipt from './functions/api/square/cash-receipt.js';
import * as consignLocation from './functions/api/consign/location.js';
import * as consignRequestCode from './functions/api/consign/request-code.js';
import * as consignVerify from './functions/api/consign/verify.js';
import * as consignMe from './functions/api/consign/me.js';
import * as consignSubmit from './functions/api/consign/submit.js';
import * as consignSettings from './functions/api/consign/settings.js';

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
    if (pathname === '/api/queue/assignment-status' && method === 'GET') {
      return queueAssignmentStatus.onRequestGet(context);
    }
    if (pathname === '/api/queue/terminals') {
      if (method === 'GET') return queueTerminals.onRequestGet(context);
      if (method === 'POST') return queueTerminals.onRequestPost(context);
      if (method === 'DELETE') return queueTerminals.onRequestDelete(context);
    }
    if (pathname === '/api/queue/active-sales') {
      if (method === 'GET') return queueActiveSales.onRequestGet(context);
      if (method === 'POST') return queueActiveSales.onRequestPost(context);
    }
    const activeSaleIdMatch = pathname.match(/^\/api\/queue\/active-sales\/([^/]+)$/);
    if (activeSaleIdMatch) {
      context.params = { id: activeSaleIdMatch[1] };
      if (method === 'PATCH') return queueActiveSalesById.onRequestPatch(context);
      if (method === 'DELETE') return queueActiveSalesById.onRequestDelete(context);
    }
    const activeSaleKeepMatch = pathname.match(/^\/api\/queue\/active-sales\/([^/]+)\/keep$/);
    if (activeSaleKeepMatch && method === 'POST') {
      context.params = { id: activeSaleKeepMatch[1] };
      return queueActiveSalesKeep.onRequestPost(context);
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
    if (pathname === '/api/sales') {
      if (method === 'GET') return sales.onRequestGet(context);
      if (method === 'POST') return sales.onRequestPost(context);
    }

    if (pathname === '/api/square/oauth/start' && method === 'GET') {
      return squareOauthStart.onRequestGet(context);
    }
    if (pathname === '/api/square/oauth/callback' && method === 'GET') {
      return squareOauthCallback.onRequestGet(context);
    }
    if (pathname === '/api/square/connection' && method === 'GET') {
      return squareConnection.onRequestGet(context);
    }
    if (pathname === '/api/square/locations' && method === 'GET') {
      return squareLocations.onRequestGet(context);
    }
    if (pathname === '/api/square/set-location' && method === 'POST') {
      return squareSetLocation.onRequestPost(context);
    }
    if (pathname === '/api/square/device-codes' && method === 'POST') {
      return squareDeviceCodes.onRequestPost(context);
    }
    if (pathname === '/api/square/device-codes-status' && method === 'GET') {
      return squareDeviceCodesStatus.onRequestGet(context);
    }
    if (pathname === '/api/square/cash-payment' && method === 'POST') {
      return squareCashPayment.onRequestPost(context);
    }
    if (pathname === '/api/square/cash-receipt' && method === 'POST') {
      return squareCashReceipt.onRequestPost(context);
    }

    if (pathname === '/api/consign/location' && method === 'GET') {
      return consignLocation.onRequestGet(context);
    }
    if (pathname === '/api/consign/request-code' && method === 'POST') {
      return consignRequestCode.onRequestPost(context);
    }
    if (pathname === '/api/consign/verify' && method === 'POST') {
      return consignVerify.onRequestPost(context);
    }
    if (pathname === '/api/consign/me' && method === 'GET') {
      return consignMe.onRequestGet(context);
    }
    if (pathname === '/api/consign/submit' && method === 'POST') {
      return consignSubmit.onRequestPost(context);
    }
    if (pathname === '/api/consign/settings') {
      if (method === 'GET') return consignSettings.onRequestGet(context);
      if (method === 'POST') return consignSettings.onRequestPost(context);
    }

    // Public consignor registration shell - Pages' ASSETS binding only
    // resolves exact paths, so every /consign/<slug> sub-path is
    // rewritten here to the one static shell; client JS reads the slug
    // from location.pathname itself. Rewriting to the directory path
    // ('/consign/', which Pages resolves to consign/index.html's content
    // directly) rather than the literal filename ('/consign/index.html')
    // matters: requesting that literal filename gets a 308 redirect back
    // to the directory form from Pages' own asset server, which would
    // then match this same regex again - an infinite redirect loop.
    if (/^\/consign(?:\/.*)?$/.test(pathname) && method === 'GET') {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = '/consign/';
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    // Not an API route - serve the static site (index.html, css/, js/,
    // settings/, manifest.json, sw.js) exactly as file-based routing did.
    return env.ASSETS.fetch(request);
  }
};
