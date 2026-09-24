// Cloudflare Pages Function: POST /api/webhooks/square
// Receives Square event notifications (e.g. terminal.checkout.updated) and
// frees the terminal in the TerminalQueue Durable Object when a checkout
// completes or cancels, independent of whether the browser tab that sent it
// stayed open (the /api/terminal-checkout/[id].js poll does the same thing,
// so this is a redundant, tab-independent path rather than the only one).
//
// Required environment variables:
//   SQUARE_WEBHOOK_SIGNATURE_KEY   - from the webhook subscription in the
//                                    Square Developer Dashboard
//   SQUARE_WEBHOOK_NOTIFICATION_URL - the exact URL registered for this
//                                     webhook subscription (must match
//                                     byte-for-byte, including https:// and
//                                     no trailing slash unless registered
//                                     with one)

import { notifyTerminalStatus, locationForDevice } from '../../_shared/queue.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.SQUARE_WEBHOOK_SIGNATURE_KEY || !env.SQUARE_WEBHOOK_NOTIFICATION_URL) {
    return new Response('Server not configured', { status: 500 });
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-square-hmacsha256-signature');

  const valid = await verifySquareSignature(
    signatureHeader,
    rawBody,
    env.SQUARE_WEBHOOK_SIGNATURE_KEY,
    env.SQUARE_WEBHOOK_NOTIFICATION_URL
  );
  if (!valid) {
    return new Response('Invalid signature', { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (event.type === 'terminal.checkout.updated') {
    const checkout = event.data?.object?.checkout;
    const deviceId = checkout?.device_options?.device_id;
    if (checkout?.status === 'COMPLETED' || checkout?.status === 'CANCELED') {
      // Square calls this endpoint directly - there's no client request to
      // read an X-Location-Code header from, so look the location up by
      // device instead (see functions/_shared/queue.js).
      context.waitUntil?.((async () => {
        const locationId = await locationForDevice(env, deviceId);
        if (locationId) await notifyTerminalStatus(env, deviceId, 'available', locationId);
      })());
    }
  }

  return new Response('OK', { status: 200 });
}

async function verifySquareSignature(signatureHeader, rawBody, signatureKey, notificationUrl) {
  if (!signatureHeader) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signatureKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const dataToSign = notificationUrl + rawBody;
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(dataToSign));
  const computedSignature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));

  return timingSafeEqual(computedSignature, signatureHeader);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
