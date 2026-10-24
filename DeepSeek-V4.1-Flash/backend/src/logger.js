import config from './config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function currentLevel() {
  return LEVELS[config.core.logLevel] ?? LEVELS.info;
}

function stamp() {
  return new Date().toISOString();
}

function emit(level, scope, args) {
  if (currentLevel() < LEVELS[level]) return;
  const prefix = `${stamp()} [${level.toUpperCase()}]${scope ? ` [${scope}]` : ''}`;
  const stream = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  stream(prefix, ...args);
}

export function createLogger(scope = '') {
  return {
    error: (...args) => emit('error', scope, args),
    warn: (...args) => emit('warn', scope, args),
    info: (...args) => emit('info', scope, args),
    debug: (...args) => emit('debug', scope, args),
  };
}

export const logger = createLogger();
export default logger;
