/**
 * Lightweight SSE event bus.
 * Callers emit named events; connected clients receive them and react.
 */

const clients = new Map(); // clientId → { res, channel }
let nextId = 1;

function subscribe(res, channel = 'leaderboard') {
  const id = nextId++;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if behind proxy
  res.flushHeaders();

  // Initial heartbeat so the browser knows the connection is alive
  res.write(': connected\n\n');

  clients.set(id, { res, channel });

  // Heartbeat every 25 s to keep the connection alive through proxies/firewalls
  const heartbeat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (_) {}
  }, 25000);

  res.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(id);
  });
}

function emit(channel, eventName, data = {}) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const { res, channel: ch } of clients.values()) {
    if (ch === channel) {
      try { res.write(payload); } catch (_) {}
    }
  }
}

module.exports = { subscribe, emit };
