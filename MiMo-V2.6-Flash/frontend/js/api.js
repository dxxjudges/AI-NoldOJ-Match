'use strict';

/** API client with dual-token refresh. */
const API = (() => {
  let accessToken = localStorage.getItem('noldoj-access') || null;

  function setToken(t) {
    accessToken = t;
    if (t) localStorage.setItem('noldoj-access', t);
    else localStorage.removeItem('noldoj-access');
  }

  async function request(method, path, body, retry = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
    const res = await fetch('/api' + path, {
      method,
      headers,
      credentials: 'include',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && retry && path !== '/auth/refresh' && path !== '/auth/login') {
      const ok = await tryRefresh();
      if (ok) return request(method, path, body, false);
    }
    let data = null;
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error((data && data.error) || ('HTTP ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  async function tryRefresh() {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) return false;
      const data = await res.json();
      setToken(data.token);
      window.APP && window.APP.setUser && window.APP.setUser(data.user);
      return true;
    } catch (_) {
      return false;
    }
  }

  return {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b ?? {}),
    put: (p, b) => request('PUT', p, b ?? {}),
    del: (p) => request('DELETE', p),
    setToken,
    token: () => accessToken,
  };
})();

/** Minimal Markdown renderer (safe: escapes HTML first). Supports code, bold, italic, links, KaTeX delimiters left as text for client lib. */
function mdToHtml(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let s = esc(String(src || ''));
  s = s.replace(/```([\s\S]*?)```/g, (m, c) => '<pre class="code">' + c.trim() + '</pre>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>');
  s = s.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>').replace(/<\/ul>\s*<ul>/g, '');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => {
    if (!/^https?:\/\//i.test(u) && !u.startsWith('/')) return m;
    return `<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
  });
  // bilibili embed: https://www.bilibili.com/video/BVxxx
  s = s.replace(/https?:\/\/www\.bilibili\.com\/video\/(BV[A-Za-z0-9]+)/g,
    (m, bv) => `<iframe src="//player.bilibili.com/player.html?bvid=${bv}&autoplay=0" style="width:100%;aspect-ratio:16/9;border:0" allowfullscreen></iframe>`);
  // iframe embed: @[iframe](url)
  s = s.replace(/@\[iframe\]\(([^)]+)\)/g,
    (m, u) => /^https?:\/\//i.test(u) ? `<iframe src="${u}" style="width:100%;min-height:400px;border:1px solid var(--border);border-radius:8px"></iframe>` : m);
  s = s.replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>');
  return '<p>' + s + '</p>';
}

function el(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Render KaTeX math inside a DOM node ($...$, $$...$$, \\[...\\]). */
function renderMath(root) {
  if (typeof renderMathInElement !== 'function') {
    // KaTeX still loading — retry shortly
    setTimeout(() => renderMath(root), 400);
    return;
  }
  try {
    renderMathInElement(root || document.body, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
      ignoredClasses: ['code'],
    });
  } catch (_) {}
}

/** Simple line-based diff (LCS) for two code strings. Returns ops array. */
function diffLines(a, b) {
  const A = String(a || '').replace(/\r\n/g, '\n').split('\n');
  const B = String(b || '').replace(/\r\n/g, '\n').split('\n');
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ t: 'same', a: A[i], b: B[j] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: 'del', a: A[i] }); i++; }
    else { ops.push({ t: 'add', b: B[j] }); j++; }
  }
  while (i < n) { ops.push({ t: 'del', a: A[i++] }); }
  while (j < m) { ops.push({ t: 'add', b: B[j++] }); }
  return ops;
}

/** Side-by-side HTML for a line diff. */
function diffHtml(codeA, codeB) {
  const ops = diffLines(codeA, codeB);
  // pair del/add into modified rows where adjacent
  const rows = [];
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    if (o.t === 'del' && ops[k + 1] && ops[k + 1].t === 'add') {
      rows.push({ l: o.a, r: ops[k + 1].b, cls: 'diff-mod' });
      k++;
    } else if (o.t === 'del') {
      rows.push({ l: o.a, r: '', cls: 'diff-del' });
    } else if (o.t === 'add') {
      rows.push({ l: '', r: o.b, cls: 'diff-add' });
    } else {
      rows.push({ l: o.a, r: o.b, cls: '' });
    }
  }
  return `<table class="diff-table"><thead><tr><th style="width:50%">提交 A</th><th style="width:50%">提交 B</th></tr></thead><tbody>` +
    rows.map(r => `<tr class="${r.cls}"><td class="code-cell">${esc(r.l)}</td><td class="code-cell">${esc(r.r)}</td></tr>`).join('') +
    `</tbody></table>`;
}

const STATUS_MAP = {
  pending: ['等待中', 'badge-gray'], ai_reviewing: ['AI 审查中', 'badge-info'], queued: ['排队中', 'badge-info'],
  compiling: ['编译中', 'badge-info'], judging: ['评测中', 'badge-info'],
  accepted: ['AC', 'badge-success'], wrong_answer: ['WA', 'badge-danger'],
  time_limit: ['TLE', 'badge-warning'], memory_limit: ['MLE', 'badge-warning'],
  runtime_error: ['RE', 'badge-danger'], compile_error: ['CE', 'badge-danger'],
  output_limit: ['OLE', 'badge-warning'], internal_error: ['IE', 'badge-danger'], system_error: ['SE', 'badge-danger'],
  done: ['完成', 'badge-success'],
};
function statusBadge(s) {
  const [t, c] = STATUS_MAP[s] || [s, 'badge-gray'];
  return `<span class="badge ${c}">${t}</span>`;
}

const DIFF_MAP = { entry: '入门', basic: '基础', medium: '中等', hard: '困难', advanced: '进阶', expert: '专家' };
function diffBadge(d) {
  const colors = { entry: 'badge-success', basic: 'badge-info', medium: 'badge-warning', hard: 'badge-danger', advanced: 'badge-danger', expert: 'badge-danger' };
  return `<span class="badge ${colors[d] || 'badge-gray'}">${DIFF_MAP[d] || d}</span>`;
}
