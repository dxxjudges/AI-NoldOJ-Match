const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');

function deepMerge(base, override) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k of Object.keys(override || {})) {
    if (override[k] && typeof override[k] === 'object' && !Array.isArray(override[k]) && base && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      out[k] = deepMerge(base[k], override[k]);
    } else {
      out[k] = override[k];
    }
  }
  return out;
}

let userConfig = {};
const cfgPath = path.join(ROOT, 'config', 'config.json');
if (fs.existsSync(cfgPath)) {
  try {
    userConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch (e) {
    console.error('[FATAL] config/config.json is not valid JSON:', e.message);
    process.exit(1);
  }
} else {
  console.warn('[WARN] config/config.json not found, copying config.default.json');
  fs.copyFileSync(path.join(ROOT, 'config', 'config.default.json'), cfgPath);
  userConfig = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
}

const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'config.default.json'), 'utf8'));

// Auto generate jwt secret and persist it
if (!userConfig.core || !userConfig.core.jwtSecret) {
  const secret = crypto.randomBytes(48).toString('hex');
  userConfig = deepMerge(userConfig, { core: { jwtSecret: secret } });
  try {
    fs.writeFileSync(cfgPath, JSON.stringify(deepMerge(defaults, userConfig), null, 2), 'utf8');
  } catch (e) {
    console.warn('[WARN] Could not persist jwt secret to config.json:', e.message);
  }
}

const config = deepMerge(defaults, userConfig);

function abs(p, baseDir) {
  if (!p) return '';
  if (path.isAbsolute(p)) return p;
  return path.join(baseDir || ROOT, p);
}

config.abs = {
  databasePath: abs(config.core.databasePath),
  sandboxWorkDir: abs(config.core.sandboxWorkDir),
  testdataDir: abs(config.core.testdataDir),
  uploadsDir: abs(config.core.uploadsDir)
};
config.ROOT = ROOT;

module.exports = config;
