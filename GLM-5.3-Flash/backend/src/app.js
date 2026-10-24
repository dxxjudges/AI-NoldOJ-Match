const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { initDb } = require('./db/init');
const { attachUser } = require('./utils/middleware');
const { attachWebSocket } = require('./ws/ws');

function createApp() {
  initDb();

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // CORS policy (configurable)
  app.use((req, res, next) => {
    if (config.cors && config.cors.enabled) {
      const origin = req.headers.origin;
      if (origin && (!config.cors.origins || config.cors.origins.includes(origin))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  app.use(attachUser);

  // API routes (16 modules)
  app.use('/api', require('./routes/auth'));
  app.use('/api', require('./routes/problems'));
  app.use('/api', require('./routes/submissions'));
  app.use('/api', require('./routes/languages'));
  app.use('/api', require('./routes/users'));
  app.use('/api', require('./routes/misc'));
  app.use('/api', require('./routes/admin'));
  app.use('/api', require('./routes/contests'));
  app.use('/api', require('./routes/articles'));
  app.use('/api', require('./routes/exams'));
  app.use('/api', require('./routes/files'));
  app.use('/api', require('./routes/training'));
  app.use('/api', require('./routes/plagiarism'));

  // simple request log
  app.use('/api', (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) {
        try { fs.appendFileSync(path.join(config.ROOT, 'logs', 'error.log'), `${new Date().toISOString()} ${req.method} ${req.originalUrl} -> ${res.statusCode}\n`); } catch { }
      }
    });
    next();
  });

  // 404 for unknown api
  app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'API route does not exist' }));

  // frontend static
  const feDir = path.join(config.ROOT, 'frontend');
  app.use('/static', express.static(path.join(feDir, 'static'), { maxAge: '1h' }));
  app.use(express.static(feDir, { extensions: ['html'] }));

  // SPA-ish fallback: serve 404 page for unknown pages
  app.use((req, res) => {
    if (req.accepts('html')) return res.sendFile(path.join(feDir, '404.html'));
    res.status(404).json({ ok: false, error: 'Not Found' });
  });

  // error middleware (status-aware)
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error('[ERROR]', req.method, req.originalUrl, err);
    res.status(status).json({ ok: false, error: err.message || 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
