const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { createApp } = require('./app');
const { attachWebSocket } = require('./ws/ws');

console.log('==========================================================');
console.log('  NoldOJ Online Judge  -  Windows native sandbox edition');
console.log('==========================================================');

// High-risk state startup alerts
console.log('[ALERT] This project runs user code in a Windows sandbox.');
console.log('        Desktop Windows is NOT an absolute isolation boundary.');
console.log('        Do NOT expose this service to the public internet on a machine holding sensitive data.');
console.log(`        Sandbox mode: ${config.judge.useSandbox ? 'ENABLED (Job Object + restricted token)' : 'DISABLED (dangerous)'}`);
if (!config.ai.securityReview.enabled) {
  console.log('[ALERT] AI code security review is DISABLED - malicious submissions will execute.');
}

const app = createApp();
const server = http.createServer(app);
const ws = attachWebSocket(server);

server.listen(config.server.port, config.server.host, () => {
  console.log(`[OK] NoldOJ listening on http://localhost:${config.server.port}`);
  console.log(`[OK] Database: ${config.abs.databasePath}`);
  console.log(`[OK] WebSocket ready at ws://localhost:${config.server.port}/ws`);
});

// graceful shutdown: flush wal, close server
process.on('SIGINT', () => {
  console.log('\n[EXIT] Shutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
});

process.on('uncaughtException', (e) => {
  try { fs.appendFileSync(path.join(config.ROOT, 'logs', 'crash.log'), new Date().toISOString() + ' ' + (e.stack || e) + '\n'); } catch { }
  console.error('[UNCAUGHT]', e);
});
process.on('unhandledRejection', (e) => {
  console.error('[UNHANDLED-REJECTION]', e);
});
