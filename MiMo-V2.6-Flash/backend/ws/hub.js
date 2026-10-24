'use strict';

/**
 * WebSocket real-time push: judging status, IDE runs, rating updates, kicks.
 * Connection: /ws?token=<access token>
 * Heartbeat: ping/pong every 30s; auto-reconnect is client-side.
 */

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { config } = require('../config');

let wss = null;
const clients = new Map(); // ws -> { userId, alive }

function authenticate(req) {
  try {
    const url = new URL(req.url, 'http://x');
    const token = url.searchParams.get('token') || '';
    const payload = jwt.verify(token, config.server.jwtSecret);
    if (payload.typ === 'refresh') return null;
    const db = require('../db/database');
    const u = db.get('SELECT id, banned FROM users WHERE id = ?', Number(payload.sub));
    if (!u || u.banned) return null;
    if (payload.fl != null && Number(payload.fl) > Number(payload.iat) * 1000) return null;
    return Number(payload.sub);
  } catch (_) {
    return null;
  }
}

function init(server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const userId = authenticate(req);
    if (!userId) {
      ws.close(4001, 'unauthorized');
      return;
    }
    clients.set(ws, { userId, alive: true });
    ws.on('pong', () => { const c = clients.get(ws); if (c) c.alive = true; });
    ws.on('message', (raw) => {
      // client may send {"type":"ping"}
      try {
        const m = JSON.parse(raw);
        if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      } catch (_) {}
    });
    ws.on('close', () => clients.delete(ws));
    ws.send(JSON.stringify({ type: 'hello', t: Date.now() }));
  });

  const heartbeat = setInterval(() => {
    for (const [ws, c] of clients) {
      if (!c.alive) { ws.terminate(); clients.delete(ws); continue; }
      c.alive = false;
      try { ws.ping(); } catch (_) {}
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  // wire event bus
  const { bus } = require('../services/judge/queue');
  bus.on('submission', (msg) => broadcast({ type: 'submission', ...msg }, msg.userId));
  bus.on('ide', (msg) => {
    // route ide events to the owner
    const db = require('../db/database');
    const r = db.get('SELECT user_id FROM ide_runs WHERE id = ?', msg.id);
    if (r) broadcastOne(r.user_id, { type: 'ide', ...msg });
  });
  bus.on('rating', (msg) => broadcastOne(msg.userId, { type: 'rating', ...msg }));
  bus.on('kick', (msg) => broadcastOne(msg.userId, { type: 'kick', reason: msg.reason }));
  bus.on('contest', (msg) => broadcast({ type: 'contest', ...msg }));

  console.log('[ws] WebSocket hub ready at /ws');
}

function broadcast(msg, onlyUserId) {
  const data = JSON.stringify(msg);
  for (const [ws, c] of clients) {
    if (onlyUserId && c.userId !== onlyUserId) continue;
    if (ws.readyState === 1) ws.send(data);
  }
}

function broadcastOne(userId, msg) {
  const data = JSON.stringify(msg);
  for (const [ws, c] of clients) {
    if (c.userId === userId && ws.readyState === 1) ws.send(data);
  }
}

module.exports = { init, broadcast, broadcastOne };
