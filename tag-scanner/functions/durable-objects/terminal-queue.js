// Durable Object: coordinates a shared pool of Square Terminals across
// multiple simultaneous app instances. Holds the terminal registry and an
// ordered wait queue in durable storage (survives hibernation/restarts),
// and pushes live updates to connected clients over hibernatable
// WebSockets so idle connections don't cost compute.
//
// Bound as env.TERMINAL_QUEUE (see wrangler.toml). Always addressed as the
// single instance idFromName('default') — see functions/_shared/queue.js.
//
// HTTP surface (paths are relative; callers are the Pages Functions relays
// under functions/api/queue/):
//   GET    /connect?clientId=X  - upgrade to WebSocket, tagged with clientId
//   GET    /state               - snapshot of terminals + queue length
//   GET    /terminals           - list registered terminals
//   POST   /terminals           - register/update one {deviceId, name}
//   DELETE /terminals           - remove one {deviceId}
//   POST   /enqueue             - {clientId, cart, note} -> assigns a free
//                                  terminal immediately or queues the request
//   POST   /dequeue             - {clientId} -> removes that client's
//                                  pending request from the wait queue
//                                  (customer/staff backed out before a
//                                  terminal was assigned)
//   POST   /terminal-status     - {deviceId, status: 'busy'|'available'}
//                                  'available' assigns the next queued
//                                  request to that terminal, if any
//   GET    /my-status?clientId=X - assignment/queue position for a client
//                                   that may have missed a WebSocket push

export class TerminalQueue {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.terminals = new Map(); // deviceId -> { name, status, queueId }
    this.queue = [];            // { id, clientId, cart, note, createdAt }

    this.ready = state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get(['terminals', 'queue']);
      if (stored.get('terminals')) this.terminals = new Map(stored.get('terminals'));
      if (stored.get('queue')) this.queue = stored.get('queue');
    });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/connect') return this.handleConnect(request, url);
    if (pathname === '/state' && request.method === 'GET') return json(this.snapshot());
    if (pathname === '/terminals' && request.method === 'GET') return json(this.terminalList());
    if (pathname === '/terminals' && request.method === 'POST') return this.registerTerminal(request);
    if (pathname === '/terminals' && request.method === 'DELETE') return this.removeTerminal(request);
    if (pathname === '/enqueue' && request.method === 'POST') return this.enqueue(request);
    if (pathname === '/dequeue' && request.method === 'POST') return this.dequeue(request);
    if (pathname === '/terminal-status' && request.method === 'POST') return this.setTerminalStatus(request);
    if (pathname === '/my-status' && request.method === 'GET') return json(this.myStatus(url.searchParams.get('clientId')));

    return new Response('Not found', { status: 404 });
  }

  handleConnect(request, url) {
    const clientId = (url.searchParams.get('clientId') || '').trim();
    if (!clientId) return new Response('clientId required', { status: 400 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected websocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server, [clientId]);

    this.sendTo(clientId, { type: 'state', ...this.snapshot() });

    return new Response(null, { status: 101, webSocket: client });
  }

  // Required by the hibernation API even though clients don't send us
  // anything today - enqueue/status changes go over plain HTTP so a
  // request still succeeds even if the socket briefly dropped.
  async webSocketMessage() {}

  async webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }

  async webSocketError() {}

  terminalList() {
    return Array.from(this.terminals.entries()).map(([deviceId, t]) => ({ deviceId, ...t }));
  }

  async persistTerminals() {
    await this.state.storage.put('terminals', Array.from(this.terminals.entries()));
  }

  async persistQueue() {
    await this.state.storage.put('queue', this.queue);
  }

  async registerTerminal(request) {
    const body = await request.json().catch(() => ({}));
    const deviceId = (body.deviceId || '').trim();
    const name = (body.name || '').trim();
    if (!deviceId || !name) return json({ error: 'deviceId and name are required' }, 400);

    const existing = this.terminals.get(deviceId);
    this.terminals.set(deviceId, {
      name,
      status: existing?.status || 'available',
      queueId: existing?.queueId || null
    });
    await this.persistTerminals();
    this.broadcastState();
    return json({ ok: true });
  }

  async removeTerminal(request) {
    const body = await request.json().catch(() => ({}));
    const deviceId = (body.deviceId || '').trim();
    this.terminals.delete(deviceId);
    await this.persistTerminals();
    this.broadcastState();
    return json({ ok: true });
  }

  async enqueue(request) {
    const body = await request.json().catch(() => ({}));
    const clientId = (body.clientId || '').trim();
    if (!clientId) return json({ error: 'clientId is required' }, 400);

    const free = Array.from(this.terminals.entries()).find(([, t]) => t.status === 'available');
    if (free) {
      const [deviceId, terminal] = free;
      terminal.status = 'busy';
      terminal.queueId = null;
      await this.persistTerminals();
      this.broadcastState();
      return json({ status: 'assigned', deviceId, name: terminal.name });
    }

    if (!this.terminals.size) {
      return json({ error: 'No terminals registered yet (add one in Settings)' }, 409);
    }

    const entry = {
      id: crypto.randomUUID(),
      clientId,
      cart: body.cart || null,
      note: body.note || '',
      createdAt: Date.now()
    };
    this.queue.push(entry);
    await this.persistQueue();
    this.broadcastState();
    return json({ status: 'queued', queueId: entry.id, position: this.queue.length });
  }

  async dequeue(request) {
    const body = await request.json().catch(() => ({}));
    const clientId = (body.clientId || '').trim();
    const idx = this.queue.findIndex(e => e.clientId === clientId);
    if (idx !== -1) {
      this.queue.splice(idx, 1);
      await this.persistQueue();
      this.broadcastState();
    }
    return json({ ok: true });
  }

  async setTerminalStatus(request) {
    const body = await request.json().catch(() => ({}));
    const deviceId = (body.deviceId || '').trim();
    const status = body.status === 'busy' ? 'busy' : 'available';
    if (!deviceId) return json({ error: 'deviceId is required' }, 400);

    let terminal = this.terminals.get(deviceId);
    if (!terminal) {
      // A device we don't have registered reported in (e.g. a checkout sent
      // before it was added to the pool) - track it anyway so the queue
      // still functions.
      terminal = { name: deviceId, status: 'available', queueId: null };
      this.terminals.set(deviceId, terminal);
    }
    terminal.status = status;

    if (status === 'available' && this.queue.length) {
      const next = this.queue.shift();
      terminal.status = 'busy';
      terminal.queueId = null;
      await this.persistQueue();
      this.sendTo(next.clientId, { type: 'assigned', deviceId, name: terminal.name, queueId: next.id });
    }

    await this.persistTerminals();
    this.broadcastState();
    return json({ ok: true });
  }

  myStatus(clientId) {
    if (!clientId) return { error: 'clientId required' };
    const idx = this.queue.findIndex(e => e.clientId === clientId);
    if (idx !== -1) return { status: 'queued', position: idx + 1 };
    return { status: 'unknown' };
  }

  snapshot() {
    return { terminals: this.terminalList(), queueLength: this.queue.length };
  }

  sendTo(clientId, message) {
    const sockets = this.state.getWebSockets(clientId);
    const payload = JSON.stringify(message);
    for (const ws of sockets) {
      try { ws.send(payload); } catch {}
    }
  }

  broadcastState() {
    const sockets = this.state.getWebSockets();
    const payload = JSON.stringify({ type: 'state', ...this.snapshot() });
    for (const ws of sockets) {
      try { ws.send(payload); } catch {}
    }
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
