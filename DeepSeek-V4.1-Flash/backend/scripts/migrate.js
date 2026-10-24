import { copyFileSync, existsSync } from 'node:fs';
import { config } from '../src/config.js';
import { db, all, get } from '../src/db.js';
import { ensureSeed } from '../src/seed.js';
import { createLogger } from '../src/logger.js';

const log = createLogger('migrate');

const dbPath = config.core.dbPath;

if (existsSync(dbPath)) {
  const backup = `${dbPath}.backup-${Date.now()}`;
  copyFileSync(dbPath, backup);
  log.info('已备份数据库:', backup);
}

const integrity = get('PRAGMA integrity_check');
if (integrity && integrity.integrity_check && integrity.integrity_check !== 'ok') {
  log.error('数据库完整性校验失败:', integrity.integrity_check);
  process.exit(1);
}
log.info('完整性校验通过。');

// Schema is created idempotently on import; ensureSeed applies additive data.
db.exec('PRAGMA foreign_keys = OFF;');
ensureSeed();
db.exec('PRAGMA foreign_keys = ON;');

const tables = all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
log.info('数据表数量:', tables.length);
for (const table of tables) {
  const count = get(`SELECT COUNT(*) AS n FROM ${table.name}`).n;
  log.info(`  ${table.name}: ${count}`);
}
log.info('迁移完成。');
