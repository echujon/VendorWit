// Standalone Worker whose only job is to host the TerminalQueue Durable
// Object so the tag-scanner Pages project can bind to it cross-script (a
// Pages project's own script can't self-host a Durable Object class -
// Cloudflare requires the class to live in a separately deployed Worker,
// referenced by script_name; see tag-scanner/wrangler.toml).
//
// Deploy with `wrangler deploy` from this directory whenever this file
// changes. Nothing calls this Worker's own fetch() directly - it's only
// ever reached through the Durable Object binding from tag-scanner.

export class TerminalQueue {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.terminals = new Map(); // deviceId -> { name, status, queueId }
    this.queue = [];            // { id, clientId, cart, note, createdAt }
    // Parallel to the above, purely additive: lets everyone at a location
    // see every pending/in-progress sale, not just their own. The client
    // reports its own lifecycle transitions here (it already tracks these
    // locally in pendingSales - see js/app.js) rather than this being
    // derived from `queue`/`terminals`, which only ever tracked "terminal
    // busy", never "busy with what".
    this.activeSales = new Map(); // saleId -> { clientId, cart, total, deviceId, checkoutId, status, createdAt }
    // Durable record of "this queue entry got assigned to this device",
    // kept even if the real-time WebSocket push to deliver that news
    // fails (e.g. the client's socket briefly dropped) - without this, a
    // missed push meant the client waited forever and the terminal stayed
    // falsely "busy" forever, since nothing else would ever use it. A
    // reconnecting client checks this via /assignment-status.
    this.pendingAssignments = new Map(); // queueId -> { deviceId, name }

    this.ready = state.blockConcurrencyWhile(async () => {
      const stored = await state.storage.get(['terminals', 'queue', 'activeSales', 'pendingAssignments']);
      if (stored.get('terminals')) this.terminals = new Map(stored.get('terminals'));
      if (stored.get('queue')) this.queue = stored.get('queue');
      if (stored.get('activeSales')) this.activeSales = new Map(stored.get('activeSales'));
      if (stored.get('pendingAssignments')) this.pendingAssignments = new Map(stored.get('pendingAssignments'));
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
    if (pathname === '/clear-queue' && request.method === 'POST') return this.clearQueue();

    if (pathname === '/assignment-status' && request.method === 'GET') {
      return json(this.checkAssignment(url.searchParams.get('queueId')));
    }
    if (pathname === '/active-sales' && request.method === 'GET') return json(this.activeSaleList());
    if (pathname === '/active-sales' && request.method === 'POST') return this.createActiveSale(request);
    const activeSaleMatch = pathname.match(/^\/active-sales\/([^/]+)$/);
    if (activeSaleMatch && request.method === 'PATCH') return this.updateActiveSale(activeSaleMatch[1], request);
    if (activeSaleMatch && request.method === 'DELETE') return this.deleteActiveSale(activeSaleMatch[1]);

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
    const terminal = {
      name,
      status: existing?.status || 'available',
      queueId: existing?.queueId || null
    };
    this.terminals.set(deviceId, terminal);

    // A terminal can become available here too (freshly added, or an
    // existing one whose status was already 'available') - someone may
    // already be waiting in the queue for exactly this.
    if (terminal.status === 'available') {
      await this.assignFromQueue(deviceId, terminal);
    }

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
    const queueId = (body.queueId || '').trim();
    // A client can have several of its own sales queued at once - target
    // the specific one by queueId when given, falling back to "first match
    // for this client" only for older callers that don't know their queueId.
    const idx = queueId
      ? this.queue.findIndex(e => e.id === queueId)
      : this.queue.findIndex(e => e.clientId === clientId);
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

    if (status === 'available') {
      await this.assignFromQueue(deviceId, terminal);
    }

    await this.persistTerminals();
    this.broadcastState();
    return json({ ok: true });
  }

  // If anyone's waiting, hands this now-available terminal to whoever's
  // been in line longest and flips it back to busy. Mutates `terminal` in
  // place; callers persist afterward. Shared by setTerminalStatus (a
  // checkout completing/canceling) and registerTerminal (adding a
  // terminal, or fixing a stuck one via remove+re-add) - either can be the
  // moment a terminal becomes available.
  async assignFromQueue(deviceId, terminal) {
    if (!this.queue.length) return;
    const next = this.queue.shift();
    terminal.status = 'busy';
    terminal.queueId = null;
    await this.persistQueue();
    // Recorded BEFORE attempting the push, and independent of whether it
    // succeeds - a reconnecting client can recover this via
    // /assignment-status even if the live push never arrived.
    this.pendingAssignments.set(next.id, { deviceId, name: terminal.name });
    await this.persistPendingAssignments();
    this.sendTo(next.clientId, { type: 'assigned', deviceId, name: terminal.name, queueId: next.id });
  }

  async persistPendingAssignments() {
    await this.state.storage.put('pendingAssignments', Array.from(this.pendingAssignments.entries()));
  }

  // Consumed once - a client that successfully recovers an assignment this
  // way shouldn't be told about it again on a later reconnect.
  async checkAssignment(queueId) {
    if (!queueId) return { assigned: false };
    const assignment = this.pendingAssignments.get(queueId);
    if (!assignment) return { assigned: false };
    this.pendingAssignments.delete(queueId);
    await this.persistPendingAssignments();
    return { assigned: true, ...assignment };
  }

  async clearQueue() {
    const cleared = this.queue.length;
    this.queue = [];
    await this.persistQueue();
    this.broadcastState();
    return json({ ok: true, cleared });
  }

  myStatus(clientId) {
    if (!clientId) return { error: 'clientId required' };
    const idx = this.queue.findIndex(e => e.clientId === clientId);
    if (idx !== -1) return { status: 'queued', position: idx + 1 };
    return { status: 'unknown' };
  }

  activeSaleList() {
    return Array.from(this.activeSales.entries()).map(([saleId, s]) => ({ saleId, ...s }));
  }

  async persistActiveSales() {
    await this.state.storage.put('activeSales', Array.from(this.activeSales.entries()));
  }

  async createActiveSale(request) {
    const body = await request.json().catch(() => ({}));
    const saleId = (body.saleId || '').trim();
    const clientId = (body.clientId || '').trim();
    if (!saleId || !clientId) return json({ error: 'saleId and clientId are required' }, 400);

    this.activeSales.set(saleId, {
      clientId,
      cart: body.cart || null,
      total: typeof body.total === 'number' ? body.total : 0,
      deviceId: body.deviceId || null,
      checkoutId: null,
      status: body.status || 'queued',
      createdAt: Date.now()
    });
    await this.persistActiveSales();
    this.broadcastState();
    return json({ ok: true });
  }

  async updateActiveSale(saleId, request) {
    const sale = this.activeSales.get(saleId);
    if (!sale) return json({ error: 'Not found' }, 404);

    const body = await request.json().catch(() => ({}));
    if (body.status) sale.status = body.status;
    if (body.checkoutId) sale.checkoutId = body.checkoutId;
    if (body.deviceId) sale.deviceId = body.deviceId;

    await this.persistActiveSales();
    this.broadcastState();
    return json({ ok: true });
  }

  async deleteActiveSale(saleId) {
    this.activeSales.delete(saleId);
    await this.persistActiveSales();
    this.broadcastState();
    return json({ ok: true });
  }

  snapshot() {
    return { terminals: this.terminalList(), queueLength: this.queue.length, activeSales: this.activeSaleList() };
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

export default {
  async fetch() {
    return new Response('TerminalQueue Durable Object host - not meant to be called directly.', { status: 200 });
  }
};
