// WebSocket server: judging status realtime push, heartbeat keep-alive, auto-reconnect handled client-side.
const { WebSocketServer } = require('ws');
const events = require('./events');
const { verifyAccess } = require('../utils/jwt');
const { getDb } = require('../db/db');

function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();

  server.on('upgrade', (req, socket, head) => {
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    if (pathname !== '/ws') return;
    let user = null;
    const token = searchParams.get('token');
    if (token) {
      const payload = verifyAccess(token);
      if (payload) {
        user = getDb().prepare('SELECT id, username, role, rating FROM users WHERE id=? AND banned=0').get(payload.uid);
      }
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.isAlive = true;
      ws.user = user || null;
      clients.add(ws);
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (data) => {
        // Heartbeat keep-alive
        try {
          const msg = JSON.parse(String(data));
          if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
        } catch { /* ignore */ }
      });
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
      ws.send(JSON.stringify({ type: 'hello', userId: ws.user ? ws.user.id : 0 }));
    });
  });

  // heartbeat interval
  const hb = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) { ws.terminate(); clients.delete(ws); continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* ignore */ }
    }
  }, 25000);
  hb.unref();

  function send(ws, payload) {
    if (ws.readyState === 1) {
      try { ws.send(JSON.stringify(payload)); } catch { /* ignore */ }
    }
  }

  // Wire the event bus to clients
  for (const type of ['sub:update', 'sub:case', 'rating:update', 'ide:update', 'leaderboard:update', 'announcement:new', 'judge:queue']) {
    events.on(type, (payload) => {
      for (const ws of clients) {
        // Personal events are pushed only to the owner; global events are pushed to everyone
        if (type === 'rating:update' && ws.user && payload.userId && payload.userId !== ws.user.id) continue;
        if (type === 'ide:update' && ws.user && payload.userId && payload.userId !== ws.user.id) continue;
        send(ws, { type, payload, t: Date.now() });
      }
    });
  }

  function broadcastAll(payload) {
    for (const ws of clients) send(ws, payload);
  }

  return { wss, broadcastAll };
}

module.exports = { attachWebSocket };
