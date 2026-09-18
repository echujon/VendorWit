// Shared helper for talking to the TERMINAL_QUEUE Durable Object from
// Pages Functions. Not a route itself (the leading underscore on the
// containing directory excludes it from file-based routing).

export function getQueueStub(env) {
  const id = env.TERMINAL_QUEUE.idFromName('default');
  return env.TERMINAL_QUEUE.get(id);
}

// Forwards a client request to the Durable Object at the given internal
// path, preserving method/headers/body (and WebSocket upgrade headers).
export function forwardToQueue(env, request, internalPath) {
  const url = new URL(request.url);
  url.pathname = internalPath;
  return getQueueStub(env).fetch(new Request(url, request));
}

// Best-effort notification that a terminal's status changed (busy when a
// checkout is sent to it, available when it completes/cancels). Never
// throws - callers shouldn't fail a Square API call just because the queue
// hasn't been deployed yet or a notification hiccups.
export async function notifyTerminalStatus(env, deviceId, status) {
  if (!env.TERMINAL_QUEUE || !deviceId) return;
  try {
    const stub = getQueueStub(env);
    await stub.fetch('https://internal/terminal-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, status })
    });
  } catch (err) {
    console.log('notifyTerminalStatus failed:', err.message);
  }
}
