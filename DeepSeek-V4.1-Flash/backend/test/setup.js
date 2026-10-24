import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const base = join(tmpdir(), `noldoj-test-${process.pid}`);
rmSync(base, { recursive: true, force: true });

process.env.NOLDOJ__CORE__DBPATH = join(base, 'test.db');
process.env.NOLDOJ__CORE__SANDBOXWORKDIR = join(base, 'sandbox-work');
process.env.NOLDOJ__CORE__UPLOADSDIR = join(base, 'uploads');
process.env.NOLDOJ__CORE__TESTDATADIR = join(base, 'testdata');
process.env.NOLDOJ__CORE__LOGLEVEL = 'error';
process.env.NOLDOJ__CORE__PORT = '0';
process.env.NOLDOJ__CORE__REGISTRATIONPERIPPERHOUR = '50';
process.env.NOLDOJ__CORE__JWT_SECRET = `test-secret-${randomBytes(12).toString('hex')}`;
process.env.NOLDOJ__CAPTCHA__ENABLED = 'false';
process.env.NOLDOJ_SU_USERNAME = 'su';
process.env.NOLDOJ_SU_PASSWORD = 'TestAdmin123';
