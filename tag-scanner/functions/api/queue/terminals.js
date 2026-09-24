// Cloudflare Pages Function: /api/queue/terminals
// GET    - list registered terminals { deviceId, name, status }
// POST   - register/update one, body { deviceId, name }
// DELETE - remove one, body { deviceId }
// Backs the Settings page's terminal manager - the pool is shared per
// location (stored in that location's Durable Object) rather than
// per-browser localStorage, since the queue needs one canonical view of
// what terminals exist at a given location.

import { forwardToQueue } from '../../_shared/queue.js';
import { resolveLocation } from '../../_shared/location.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return json({ error: 'Server not configured' }, 500);
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  const res = await forwardToQueue(env, request, '/terminals', loc.locationId);
  return new Response(res.body, res);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return json({ error: 'Server not configured' }, 500);
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);

  const body = await request.json().catch(() => ({}));

  // Keep device_locations in sync so webhooks/square.js (which Square
  // calls directly, with no X-Location-Code header to resolve from) can
  // still find the right location for this device.
  if (body.deviceId && env.DB) {
    await env.DB.prepare(
      'INSERT INTO device_locations (device_id, location_id) VALUES (?, ?) ' +
      'ON CONFLICT(device_id) DO UPDATE SET location_id = excluded.location_id'
    ).bind(body.deviceId, loc.locationId).run();
  }

  const forwarded = new Request('https://internal/terminals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const res = await forwardToQueue(env, forwarded, '/terminals', loc.locationId);
  return new Response(res.body, res);
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!env.TERMINAL_QUEUE) return json({ error: 'Server not configured' }, 500);
  const loc = await resolveLocation(request, env);
  if (loc.error) return json({ error: loc.error }, loc.status);
  const res = await forwardToQueue(env, request, '/terminals', loc.locationId);
  return new Response(res.body, res);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
