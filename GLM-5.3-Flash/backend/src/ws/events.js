// WebSocket event bus: judge statuses, IDE runs, rating updates.
// All push consumers subscribe to typed channels; ws server attaches clients.
const listeners = new Map(); // type -> Set(fn)

function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => off(type, fn);
}

function off(type, fn) {
  const s = listeners.get(type);
  if (s) s.delete(fn);
}

function broadcast(type, payload) {
  const s = listeners.get(type);
  if (s) for (const fn of s) {
    try { fn(payload); } catch { /* listener error ignored */ }
  }
}

module.exports = { on, off, broadcast };
