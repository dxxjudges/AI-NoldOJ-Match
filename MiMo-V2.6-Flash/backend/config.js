'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'config', 'config.json');

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    const bv = base ? base[k] : undefined;
    const ov = over[k];
    if (ov && typeof ov === 'object' && !Array.isArray(ov) && bv && typeof bv === 'object' && !Array.isArray(bv)) {
      out[k] = deepMerge(bv, ov);
    } else {
      out[k] = ov;
    }
  }
  return out;
}

function loadFileConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) {
    console.error('[config] Failed to parse config.json:', e.message);
    return {};
  }
}

function envOverrides() {
  const o = {};
  if (process.env.PORT) o.server = { port: Number(process.env.PORT) };
  if (process.env.HOST) o.server = deepMerge(o.server, { host: process.env.HOST });
  if (process.env.JWT_SECRET) o.server = deepMerge(o.server, { jwtSecret: process.env.JWT_SECRET });
  if (process.env.DB_PATH) o.paths = { dbPath: process.env.DB_PATH };
  if (process.env.CAPTCHA === '0' || process.env.CAPTCHA === '1') {
    o.security = { captchaEnabled: process.env.CAPTCHA === '1' };
  }
  if (process.env.REGISTRATION === '0' || process.env.REGISTRATION === '1') {
    o.security = deepMerge(o.security, { registrationEnabled: process.env.REGISTRATION === '1' });
  }
  if (process.env.AI_REVIEW === '1' || process.env.AI_REVIEW === '0') {
    o.ai = { reviewEnabled: process.env.AI_REVIEW === '1' };
  }
  return o;
}

function ensureDirs(cfg) {
  for (const key of Object.keys(cfg.paths)) {
    const p = path.isAbsolute(cfg.paths[key]) ? cfg.paths[key] : path.join(ROOT, cfg.paths[key]);
    cfg.paths[key] = p;
    // dbPath is a file — create its parent only
    const dir = key === 'dbPath' ? path.dirname(p) : p;
    fs.mkdirSync(dir, { recursive: true });
  }
}

function ensureJwtSecret(cfg) {
  if (cfg.server.jwtSecret && cfg.server.jwtSecret.length >= 32) return;
  const secretFile = path.join(cfg.paths.dataDir, '.jwt_secret');
  let secret = '';
  if (fs.existsSync(secretFile)) {
    secret = fs.readFileSync(secretFile, 'utf8').trim();
  }
  if (!secret) {
    secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    console.log('[config] Generated new JWT secret at', secretFile);
  }
  cfg.server.jwtSecret = secret;
}

function buildConfig() {
  let cfg = {
    server: {
      port: 3000,
      host: '127.0.0.1',
      jwtSecret: '',
      accessTtlSec: 900,
      refreshTtlSec: 604800,
      corsOrigins: ['http://127.0.0.1:3000', 'http://localhost:3000'],
    },
    paths: {
      dataDir: 'backend/data',
      dbPath: 'backend/data/NoldOJ.db',
      sandboxDir: 'tmp/sandbox',
      uploadDir: 'backend/data/uploads',
      testdataDir: 'backend/data/testdata',
      workDir: 'tmp/work',
    },
    security: {
      captchaEnabled: true,
      registrationEnabled: true,
      registrationPerIpPerHour: 1,
      sourceMaxBytes: 131072,
      submitRateLimit: { windowSec: 60, max: 10 },
      ideRateLimit: { windowSec: 60, max: 15 },
      loginRateLimit: { windowSec: 60, max: 8 },
    },
    judge: {
      queueConcurrency: 2,
      defaultTimeLimitMs: 2000,
      defaultMemoryLimitMb: 256,
      defaultOutputLimitKb: 65536,
      defaultStackLimitMb: 64,
      compileTimeoutMs: 30000,
    },
    ai: {
      reviewEnabled: false,
      hintEnabled: false,
      testdataEnabled: false,
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:1.7b',
      apiKey: '',
      timeoutMs: 60000,
      hintCooldownSec: 60,
      hintFailThreshold: 2,
    },
    email: { enabled: false, host: '', port: 465, user: '', pass: '', from: '' },
    files: { maxSingleFileMb: 10, defaultUserQuotaMb: 2048 },
    contest: { freezeDefaultMinutes: 0 },
    plagiarism: { enabled: true, highSimilarity: 0.85, suspectSimilarity: 0.70, minCodeLength: 200 },
  };
  cfg = deepMerge(cfg, loadFileConfig());
  cfg = deepMerge(cfg, envOverrides());
  ensureDirs(cfg);
  ensureJwtSecret(cfg);
  return cfg;
}

const config = buildConfig();

module.exports = { config, ROOT, CONFIG_FILE };
