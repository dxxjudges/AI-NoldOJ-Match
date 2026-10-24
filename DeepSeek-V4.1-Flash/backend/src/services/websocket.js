import { createHash, randomBytes } from 'node:crypto';
import { createLogger } from '../logger.js';

const log = createLogger('ws');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WsConnection {
  constructor(socket, req) {
    this.socket = socket;
    this.req = req;
    this.userId = null;
    this.alive = true;
    this.buffer = Buffer.alloc(0);
    this.handlers = { message: [], close: [] };

    socket.on('data', (chunk) => this.onData(chunk));
    socket.on('close', () => this.cleanup());
    socket.on('error', () => this.cleanup());
  }

  on(event, fn) { this.handlers[event].push(fn); }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const frame = this.decode();
      if (!frame) break;
      if (frame.opcode === 0x8) { this.close(); break; }
      if (frame.opcode === 0x9) { this.sendFrame(0xA, frame.payload); continue; }
      if (frame.opcode === 0xA) { this.alive = true; continue; }
      if (frame.opcode === 0x1) {
        const text = frame.payload.toString('utf8');
        for (const fn of this.handlers.message) fn(text);
      }
    }
  }

  decode() {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const first = buf[0];
    const second = buf[1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buf.length < 4) return null;
      length = buf.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buf.length < 10) return null;
      length = Number(buf.readBigUInt64BE(2));
      offset = 10;
    }
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + length) return null;
    const mask = masked ? buf.subarray(offset, offset + 4) : null;
    offset += maskLen;
    const payload = Buffer.from(buf.subarray(offset, offset + length));
    if (mask) {
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    this.buffer = buf.subarray(offset + length);
    return { opcode, payload };
  }

  sendFrame(opcode, payload) {
    if (this.socket.destroyed) return;
    const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const length = data.length;
    let header;
    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    try {
      this.socket.write(Buffer.concat([header, data]));
    } catch (err) {
      log.debug('write failed', err.message);
    }
  }

  send(type, data) {
    this.sendFrame(0x1, JSON.stringify({ type, data }));
  }

  ping() { this.sendFrame(0x9, Buffer.alloc(0)); }

  close() {
    try { this.sendFrame(0x8, Buffer.alloc(0)); } catch { /* ignored */ }
    this.socket.end();
    this.cleanup();
  }

  cleanup() {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.handlers.close) fn();
  }
}

const connections = new Set();

export function attachWebSocket(server) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const conn = new WsConnection(socket, req);
    conn.on('message', (text) => {
      try {
        const msg = JSON.parse(text);
        if (msg.type === 'auth' && msg.token) conn.token = msg.token;
        if (msg.type === 'ping') conn.send('pong', { t: Date.now() });
      } catch { /* ignore malformed frames */ }
    });
    conn.on('close', () => connections.delete(conn));
    connections.add(conn);
  });

  const heartbeat = setInterval(() => {
    for (const conn of connections) {
      if (!conn.alive) { conn.close(); continue; }
      conn.alive = false;
      conn.ping();
    }
  }, 30_000);
  heartbeat.unref();

  log.info('websocket endpoint ready at /ws');
}

export function broadcast(type, data) {
  const payload = JSON.stringify({ type, data });
  for (const conn of connections) conn.sendFrame(0x1, payload);
}

export function sendToUser(userId, type, data) {
  for (const conn of connections) {
    if (conn.userId === userId) conn.send(type, data);
  }
}

export function connectionCount() { return connections.size; }

export function randomConnectionId() { return randomBytes(8).toString('hex'); }

export default { attachWebSocket, broadcast, sendToUser, connectionCount };
