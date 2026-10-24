import { ensureDirs, config } from '../src/config.js';
import { ensureSeed } from '../src/seed.js';
import { sandboxBackend } from '../src/services/sandbox-runner.js';
import { get } from '../src/db.js';
import { createLogger } from '../src/logger.js';

const log = createLogger('init');

ensureDirs();
const { su } = ensureSeed();

log.info('数据库路径:', config.core.dbPath);
log.info('语言数量:', get('SELECT COUNT(*) AS n FROM languages').n);
log.info('标签数量:', get('SELECT COUNT(*) AS n FROM tags').n);
log.info('沙箱后端:', sandboxBackend());
if (su) log.info(`超级管理员: ${su.username} / ${su.password}`);
log.info('初始化完成。');
