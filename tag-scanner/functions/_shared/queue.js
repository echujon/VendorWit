// Shared helper for talking to the TERMINAL_QUEUE Durable Object from
// Pages Functions. Not a route itself (the leading underscore on the
// containing directory excludes it from file-based routing).
//
// One Durable Object instance per location (idFromName(locationId)) - each
// location gets its own terminal pool and wait queue, completely isolated
// from every other location. Callers resolve locationId first, usually via
// functions/_shared/location.js's resolveLocation() from the client's
// X-Location-Code header - except webhooks/square.js, which has no client
// request to read a header from and instead looks the location up from the
// device_locations D1 table by device_id.

export function getQueueStub(env, locationId) {
  const id = env.TERMINAL_QUEUE.idFromName(locationId);
  return env.TERMINAL_QUEUE.get(id);
}

// Forwards a client request to the Durable Object at the given internal
// path, preserving method/headers/body (and WebSocket upgrade headers).
export function forwardToQueue(env, request, internalPath, locationId) {
  const url = new URL(request.url);
  url.pathname = internalPath;
  return getQueueStub(env, locationId).fetch(new Request(url, request));
}

// Best-effort notification that a terminal's status changed (busy when a
// checkout is sent to it, available when it completes/cancels). Never
// throws - callers shouldn't fail a Square API call just because the queue
// hasn't been deployed yet or a notification hiccups.
export async function notifyTerminalStatus(env, deviceId, status, locationId) {
  if (!env.TERMINAL_QUEUE || !deviceId || !locationId) return;
  try {
    const stub = getQueueStub(env, locationId);
    await stub.fetch('https://internal/terminal-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, status })
    });
  } catch (err) {
    console.log('notifyTerminalStatus failed:', err.message);
  }
}

// webhooks/square.js's only way to resolve a location, since Square calls
// it directly with no X-Location-Code header available.
export async function locationForDevice(env, deviceId) {
  if (!env.DB || !deviceId) return null;
  const row = await env.DB.prepare('SELECT location_id FROM device_locations WHERE device_id = ?')
    .bind(deviceId).first();
  return row ? row.location_id : null;
}
