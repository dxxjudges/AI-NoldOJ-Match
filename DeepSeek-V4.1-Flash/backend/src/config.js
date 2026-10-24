import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = resolve(__dirname, '..', '..');

function readJson(path) {
  return JSON.parse(stripBom(readFileSync(path, 'utf8')));
}

export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return override ?? base;
  if (typeof base !== 'object' || base === null) return override ?? base;
  if (typeof override !== 'object' || override === null) return base;
  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = deepMerge(base[key], override[key]);
  }
  return out;
}

function coerce(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d*\.\d+$/.test(trimmed)) return Number(trimmed);
  return value;
}

function resolveKey(obj, segment) {
  if (Object.prototype.hasOwnProperty.call(obj, segment)) return segment;
  const lower = segment.toLowerCase();
  const found = Object.keys(obj).find((k) => k.toLowerCase() === lower);
  return found || segment;
}

function applyEnvOverrides(config) {
  for (const [key, raw] of Object.entries(process.env)) {
    if (!key.startsWith('NOLDOJ__')) continue;
    const path = key.slice('NOLDOJ__'.length).split('__');
    let cursor = config;
    for (let i = 0; i < path.length - 1; i += 1) {
      const seg = resolveKey(cursor, path[i]);
      if (typeof cursor[seg] !== 'object' || cursor[seg] === null) cursor[seg] = {};
      cursor = cursor[seg];
    }
    cursor[resolveKey(cursor, path[path.length - 1])] = coerce(raw);
  }
  return config;
}

function resolvePath(value) {
  if (!value) return value;
  return isAbsolute(value) ? value : resolve(ROOT_DIR, value);
}

function loadConfig() {
  const examplePath = resolve(ROOT_DIR, 'config/config.example.json');
  const userPath = resolve(ROOT_DIR, 'config/config.json');

  let config = existsSync(examplePath) ? readJson(examplePath) : {};
  if (existsSync(userPath)) {
    config = deepMerge(config, readJson(userPath));
  }
  config = applyEnvOverrides(config);

  if (!config.core.jwtSecret) {
    config.core.jwtSecret = randomBytes(48).toString('base64url');
    try {
      if (existsSync(userPath)) {
        const persisted = readJson(userPath);
        persisted.core = persisted.core || {};
        persisted.core.jwtSecret = config.core.jwtSecret;
        writeFileSync(userPath, JSON.stringify(persisted, null, 2));
      }
    } catch (err) {
      console.warn('[config] failed to persist generated jwtSecret:', err.message);
    }
    console.warn('[config] generated a transient JWT secret (existing tokens will not survive a restart until persisted).');
  }

  config.core.dbPath = resolvePath(config.core.dbPath);
  config.core.sandboxWorkDir = resolvePath(config.core.sandboxWorkDir);
  config.core.uploadsDir = resolvePath(config.core.uploadsDir);
  config.core.testdataDir = resolvePath(config.core.testdataDir);
  config.core.frontendDir = resolvePath(config.core.frontendDir);

  return config;
}

export const config = loadConfig();

export function ensureDirs() {
  const dirs = [
    resolve(ROOT_DIR, 'data'),
    resolve(ROOT_DIR, 'logs'),
    resolve(ROOT_DIR, 'tmp'),
    config.core.sandboxWorkDir,
    config.core.uploadsDir,
    config.core.testdataDir,
  ];
  for (const dir of dirs) mkdirSync(dir, { recursive: true });
}

export default config;
