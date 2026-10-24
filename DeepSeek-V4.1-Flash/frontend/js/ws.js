(function () {
  'use strict';

  const listeners = new Map();
  let socket = null;
  let reconnectDelay = 1000;
  let heartbeat = null;
  let manualClose = false;

  function on(type, handler) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(handler);
    return () => listeners.get(type).delete(handler);
  }

  function emit(type, data) {
    const set = listeners.get(type);
    if (set) set.forEach((fn) => { try { fn(data); } catch (err) { console.error('ws handler error', err); } });
    const all = listeners.get('*');
    if (all) all.forEach((fn) => { try { fn(type, data); } catch { /* noop */ } });
  }

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    try {
      socket = new WebSocket(`${proto}://${location.host}/ws`);
    } catch {
      return;
    }
    socket.onopen = () => {
      reconnectDelay = 1000;
      emit('open');
      const token = window.NoldOJ && window.NoldOJ.state.token;
      if (token) socket.send(JSON.stringify({ type: 'auth', token }));
      clearInterval(heartbeat);
      heartbeat = setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };
    socket.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      emit(msg.type, msg.data);
    };
    socket.onclose = () => {
      clearInterval(heartbeat);
      emit('close');
      if (!manualClose) {
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(30000, reconnectDelay * 2);
      }
    };
    socket.onerror = () => { try { socket.close(); } catch { /* noop */ } };
  }

  function close() {
    manualClose = true;
    if (socket) socket.close();
  }

  window.addEventListener('online', connect);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) connect(); });

  window.NoldOJ = window.NoldOJ || {};
  window.NoldOJ.ws = { on, connect, close };
})();
