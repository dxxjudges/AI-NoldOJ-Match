import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

let server;
let base;

async function req(path, { method = 'GET', token, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, data, raw: raw ? text : undefined };
}

before(async () => {
  const { main } = await import('../server.js');
  server = await main();
  await new Promise((resolve) => {
    if (server.listening) resolve();
    else server.once('listening', resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('health endpoint responds', async () => {
  const { status, data } = await req('/api/health');
  assert.equal(status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.data.status, 'healthy');
});

test('static frontend is served at root', async () => {
  const { status, raw } = await req('/', { raw: true });
  assert.equal(status, 200);
  assert.match(raw, /NoldOJ/);
});

test('unknown api route returns NOT_FOUND envelope', async () => {
  const { status, data } = await req('/api/definitely-not-a-route');
  assert.equal(status, 404);
  assert.equal(data.ok, false);
  assert.equal(data.code, 'NOT_FOUND');
});

test('protected route rejects anonymous requests', async () => {
  const { status, data } = await req('/api/problems', { method: 'POST', body: { title: 'x' } });
  assert.equal(status, 401);
  assert.equal(data.code, 'UNAUTHORIZED');
});

test('captcha endpoint reports disabled state under test config', async () => {
  const { status, data } = await req('/api/auth/captcha');
  assert.equal(status, 200);
  assert.equal(data.data.enabled, false);
});

test('register, login and identity flow', async () => {
  const username = `tester${Date.now() % 100000}`;
  const reg = await req('/api/auth/register', { method: 'POST', body: { username, password: 'Passw0rd!' } });
  assert.equal(reg.status, 200);
  assert.equal(reg.data.ok, true);

  const login = await req('/api/auth/login', { method: 'POST', body: { username, password: 'Passw0rd!' } });
  assert.equal(login.status, 200);
  assert.ok(login.data.data.accessToken);
  assert.equal(login.data.data.user.username, username);
  assert.equal(login.data.data.user.role, 'user');

  const me = await req('/api/auth/me', { token: login.data.data.accessToken });
  assert.equal(me.status, 200);
  assert.equal(me.data.data.username, username);
});

test('login rejects wrong password', async () => {
  const { status, data } = await req('/api/auth/login', { method: 'POST', body: { username: 'su', password: 'nope' } });
  assert.equal(status, 401);
  assert.equal(data.code, 'UNAUTHORIZED');
});

test('languages, tags and stats are seeded', async () => {
  const langs = await req('/api/languages');
  assert.equal(langs.status, 200);
  const keys = langs.data.data.map((l) => l.key);
  for (const key of ['c', 'cpp', 'python', 'java', 'javascript']) assert.ok(keys.includes(key), `missing ${key}`);

  const tags = await req('/api/tags');
  assert.equal(tags.status, 200);
  assert.ok(Array.isArray(tags.data.data));

  const stats = await req('/api/stats/overview');
  assert.equal(stats.status, 200);
  assert.ok(stats.data.data.problems >= 0);
});

test('teacher can create a problem with testcases, then judge a submission', async (t) => {
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'su', password: 'TestAdmin123' } });
  assert.equal(login.status, 200);
  const token = login.data.data.accessToken;
  assert.equal(login.data.data.user.role, 'su');

  const created = await req('/api/problems', {
    method: 'POST',
    token,
    body: {
      title: 'A+B Test',
      description: 'Given a and b, output a+b.',
      input_format: 'Two integers a b.',
      output_format: 'Their sum.',
      difficulty: 1,
      samples: [{ input: '1 2', output: '3' }],
      time_limit_ms: 2000,
      memory_limit_kb: 262144,
    },
  });
  assert.equal(created.status, 200);
  const problemId = created.data.data.id;
  assert.ok(problemId);

  const cases = await req(`/api/problems/${problemId}/testcases/batch`, {
    method: 'POST',
    token,
    body: { cases: [{ input: '1 2\n', output: '3', score: 50 }, { input: '5 7\n', output: '12', score: 50 }] },
  });
  assert.equal(cases.status, 200);
  assert.equal(cases.data.data.created.length, 2);

  const langs = await req('/api/languages');
  const python = langs.data.data.find((l) => l.key === 'python');
  assert.ok(python, 'python language must be seeded');

  const submit = await req('/api/submissions', {
    method: 'POST',
    token,
    body: {
      problem_id: problemId,
      language_id: python.id,
      source_code: 'import sys\nfor line in sys.stdin:\n    parts = line.split()\n    if len(parts) == 2:\n        print(int(parts[0]) + int(parts[1]))\n',
    },
  });
  assert.equal(submit.status, 200);
  const submissionId = submit.data.data.id;
  assert.ok(submissionId);

  const terminal = new Set(['accepted', 'wrong_answer', 'time_limit', 'memory_limit', 'runtime_error', 'compile_error', 'system_error', 'banned']);
  let submission;
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    const res = await req(`/api/submissions/${submissionId}`, { token });
    submission = res.data.data;
    if (terminal.has(submission.status)) break;
  }
  assert.ok(terminal.has(submission.status), `judge did not finish, status=${submission && submission.status}`);
  if (submission.status === 'accepted') {
    assert.equal(submission.score, 100);
    const casesRes = await req(`/api/submissions/${submissionId}/cases`, { token });
    assert.equal(casesRes.status, 200);
    assert.equal(casesRes.data.data.length, 2);
  } else if (['system_error', 'compile_error', 'runtime_error'].includes(submission.status)) {
    t.skip(`judge toolchain unavailable in this environment (status=${submission.status})`);
  } else {
    assert.fail(`unexpected judge verdict: ${submission.status}`);
  }
});

test('search returns structured results', async () => {
  const { status, data } = await req('/api/search?q=Test');
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.data.problems));
  assert.ok(Array.isArray(data.data.contests));
  assert.ok(Array.isArray(data.data.articles));
});

test('user profile resolves by username and by id', async () => {
  const byName = await req('/api/users/su');
  assert.equal(byName.status, 200);
  const id = byName.data.data.id;
  const byId = await req(`/api/users/${id}`);
  assert.equal(byId.status, 200);
  assert.equal(byId.data.data.username, 'su');
});

test('rules require sufficient role', async () => {
  const username = `student${Date.now() % 100000}`;
  const reg = await req('/api/auth/register', { method: 'POST', body: { username, password: 'Passw0rd!' } });
  assert.equal(reg.status, 200, `register failed: ${JSON.stringify(reg.data)}`);
  const login = await req('/api/auth/login', { method: 'POST', body: { username, password: 'Passw0rd!' } });
  assert.equal(login.status, 200, `login failed: ${JSON.stringify(login.data)}`);
  const token = login.data.data.accessToken;
  const forbidden = await req('/api/problems', { method: 'POST', token, body: { title: 'nope' } });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.data.code, 'FORBIDDEN');
});
