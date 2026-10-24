'use strict';

/* NoldOJ SPA — hash router + pages */

const appEl = document.getElementById('app');
let currentUser = null;

const APP = {
  setUser(u) {
    currentUser = u;
    renderNavUser();
  },
  user: () => currentUser,
};
window.APP = APP;

function renderNavUser() {
  const box = document.getElementById('nav-user');
  const ratingEl = document.getElementById('nav-rating');
  const adminEl = document.getElementById('nav-admin');
  if (currentUser) {
    const roleNames = { user: '用户', teacher: '教师', admin: '管理员', super: '超级管理员' };
    box.innerHTML = `<span class="nav-rating" title="Rating">⚡ <span id="rating-num">${currentUser.rating ?? 0}</span></span>
      <a href="#/profile/${esc(currentUser.username)}" class="username">${esc(currentUser.username)}</a>
      <span class="badge badge-info">${roleNames[currentUser.role] || currentUser.role}</span>
      <button class="btn btn-sm btn-ghost" id="logout-btn">退出</button>`;
    document.getElementById('logout-btn').onclick = async () => {
      try { await API.post('/auth/logout'); } catch (_) {}
      API.setToken(null);
      APP.setUser(null);
      location.hash = '#/';
    };
    ratingEl.hidden = true;
    adminEl.hidden = !['teacher', 'admin', 'super'].includes(currentUser.role);
  } else {
    box.innerHTML = `<a href="#/login" class="btn btn-sm">登录</a><a href="#/register" class="btn btn-sm btn-ghost">注册</a>`;
    adminEl.hidden = true;
  }
}

/* ---- theme ---- */
document.getElementById('theme-toggle').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', cur);
  localStorage.setItem('noldoj-theme', cur);
};

/* ---- global search ---- */
document.getElementById('global-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (q) location.hash = '#/problems?keyword=' + encodeURIComponent(q);
  }
});

/* ---- router ---- */
function parseHash() {
  const h = location.hash.slice(1) || '/';
  const [pathPart, queryPart] = h.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = {};
  if (queryPart) {
    for (const kv of queryPart.split('&')) {
      const [k, v] = kv.split('=');
      query[decodeURIComponent(k)] = decodeURIComponent(v || '');
    }
  }
  return { segments, query, path: pathPart };
}

function setActiveNav(path) {
  document.querySelectorAll('#nav-links a').forEach(a => {
    const r = a.dataset.route;
    a.classList.toggle('active', path.startsWith('/' + r) || (r === 'problems' && path.startsWith('/problem/')));
  });
}

const routes = {};
function route(name, fn) { routes[name] = fn; }

async function navigate() {
  const { segments, query, path } = parseHash();
  setActiveNav(path);
  const key = segments[0] || 'home';
  const fn = routes[key] || routes.home;
  appEl.innerHTML = '<div class="loading">加载中…</div>';
  try {
    await fn(appEl, segments, query);
    if (typeof renderMath === 'function') renderMath(appEl);
  } catch (e) {
    appEl.innerHTML = `<div class="error-box">${esc(e.message || e)}</div>`;
  }
}
window.addEventListener('hashchange', navigate);

/* ---- boot ---- */
(async function boot() {
  if (API.token()) {
    try {
      const me = await API.get('/auth/me');
      APP.setUser(me.user);
      // rating auto-refresh via WS
      connectWs();
    } catch (_) { API.setToken(null); }
  }
  navigate();
})();

let ws = null;
function connectWs() {
  if (!API.token() || (ws && ws.readyState <= 1)) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(API.token())}`);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'rating' && msg.userId === (currentUser && currentUser.id)) {
        const n = document.getElementById('rating-num');
        if (n) n.textContent = msg.rating;
        if (currentUser) currentUser.rating = msg.rating;
      }
      if (msg.type === 'kick') {
        alert('您的账号已被封禁：' + (msg.reason || ''));
        API.setToken(null); APP.setUser(null); location.hash = '#/login';
      }
      window.dispatchEvent(new CustomEvent('noldoj-ws', { detail: msg }));
    } catch (_) {}
  };
  ws.onclose = () => { setTimeout(connectWs, 3000); };
  setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"type":"ping"}'); }, 25000);
}

/* ================= pages ================= */

route('home', async (el) => {
  let stats = { users: 0, problems: 0, submissions: 0 };
  try {
    const [ps, ann] = await Promise.all([
      API.get('/problems?pageSize=1'),
      API.get('/announcements'),
    ]);
    stats.problems = ps.total;
    const pinned = ann.items.filter(a => a.pinned).slice(0, 5);
    const latest = ann.items.slice(0, 5);
    el.innerHTML = `
      <div class="card">
        <h2>欢迎使用 NoldOJ</h2>
        <p class="muted">Windows 原生评测系统 · 多语言 · 安全沙箱 · 比赛 / 考试 / 题单</p>
        <div class="grid grid-3" style="margin-top:16px">
          <div class="card"><h3>📦 题目</h3><div style="font-size:28px;font-weight:700">${stats.problems}</div></div>
          <div class="card"><h3>🏆 Rating 排行</h3><a class="btn btn-sm" href="#/ranking">查看排行</a></div>
          <div class="card"><h3>💻 在线编程</h3><a class="btn btn-sm" href="#/ide">打开 IDE</a></div>
        </div>
      </div>
      <div class="card">
        <h3>📌 公告</h3>
        ${(pinned.length ? pinned : latest).map(a =>
          `<div style="padding:6px 0"><a href="#/announcements/${a.id}">${a.pinned ? '📌 ' : ''}${esc(a.title)}</a> <span class="muted">${new Date(a.created_at).toLocaleDateString()}</span></div>`
        ).join('') || '<div class="muted">暂无公告</div>'}
      </div>`;
  } catch (e) {
    el.innerHTML = `<div class="card"><h2>NoldOJ</h2><p class="muted">后端未就绪：${esc(e.message)}</p></div>`;
  }
});

route('login', async (el) => {
  el.innerHTML = `<div class="card" style="max-width:420px;margin:40px auto">
    <h2>登录</h2>
    <div id="msg"></div>
    <div class="form-group"><label>用户名</label><input type="text" id="username" autocomplete="username"></div>
    <div class="form-group"><label>密码</label><input type="password" id="password" autocomplete="current-password"></div>
    <div class="form-group" id="captcha-box"></div>
    <button class="btn" id="submit" style="width:100%">登录</button>
    <p class="muted" style="margin-top:12px">没有账号？<a href="#/register">注册</a></p>
  </div>`;
  await mountCaptcha('captcha-box');
  document.getElementById('submit').onclick = async () => {
    const msg = document.getElementById('msg');
    msg.innerHTML = '';
    try {
      const data = await API.post('/auth/login', {
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value,
        captchaId: window.__captchaId, captcha: window.__captchaInput?.value,
      });
      API.setToken(data.token);
      APP.setUser(data.user);
      connectWs();
      location.hash = '#/problems';
    } catch (e) {
      msg.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
      refreshCaptcha('captcha-box');
    }
  };
});

route('register', async (el) => {
  el.innerHTML = `<div class="card" style="max-width:420px;margin:40px auto">
    <h2>注册</h2>
    <div id="msg"></div>
    <div class="form-group"><label>用户名</label><input type="text" id="username"></div>
    <div class="form-group"><label>密码（至少 6 位）</label><input type="password" id="password"></div>
    <div class="form-group"><label>确认密码</label><input type="password" id="password2"></div>
    <div class="form-group" id="captcha-box"></div>
    <button class="btn" id="submit" style="width:100%">注册</button>
    <p class="muted" style="margin-top:12px">已有账号？<a href="#/login">登录</a></p>
  </div>`;
  await mountCaptcha('captcha-box');
  document.getElementById('submit').onclick = async () => {
    const msg = document.getElementById('msg');
    msg.innerHTML = '';
    const p1 = document.getElementById('password').value;
    const p2 = document.getElementById('password2').value;
    if (p1 !== p2) { msg.innerHTML = '<div class="error-box">两次密码不一致</div>'; return; }
    try {
      const data = await API.post('/auth/register', {
        username: document.getElementById('username').value.trim(),
        password: p1,
        captchaId: window.__captchaId, captcha: window.__captchaInput?.value,
      });
      API.setToken(data.token);
      APP.setUser(data.user);
      connectWs();
      location.hash = '#/problems';
    } catch (e) {
      msg.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
      refreshCaptcha('captcha-box');
    }
  };
});

async function mountCaptcha(boxId) {
  const box = document.getElementById(boxId);
  try {
    const c = await API.get('/captcha');
    if (!c.enabled) { box.innerHTML = ''; return; }
    window.__captchaId = c.id;
    box.innerHTML = `<label>验证码</label>
      <div class="captcha-row">
        <input type="text" id="captcha-input" maxlength="6" autocomplete="off" style="flex:1">
        <div id="captcha-svg" title="点击刷新" style="cursor:pointer">${c.svg}</div>
      </div>`;
    window.__captchaInput = document.getElementById('captcha-input');
    document.getElementById('captcha-svg').onclick = () => refreshCaptcha(boxId);
  } catch (_) { box.innerHTML = ''; }
}

async function refreshCaptcha(boxId) {
  try {
    const c = await API.get('/captcha');
    window.__captchaId = c.id;
    const svg = document.querySelector('#' + boxId + ' #captcha-svg');
    if (svg && c.svg) svg.innerHTML = c.svg;
    if (window.__captchaInput) window.__captchaInput.value = '';
  } catch (_) {}
}

route('problems', async (el, seg, query) => {
  const page = Number(query.page) || 1;
  const keyword = query.keyword || '';
  const difficulty = query.difficulty || '';
  const tag = query.tag || '';
  const [list, tags] = await Promise.all([
    API.get(`/problems?page=${page}&pageSize=20&keyword=${encodeURIComponent(keyword)}&difficulty=${difficulty}&tag=${encodeURIComponent(tag)}`),
    API.get('/problems/tags'),
  ]);
  el.innerHTML = `
    <div class="toolbar">
      <input type="text" id="kw" placeholder="搜索题目（忽略空格）" value="${esc(keyword)}" style="max-width:240px">
      <select id="diff"><option value="">全部难度</option>
        ${Object.entries(DIFF_MAP).map(([k, v]) => `<option value="${k}" ${difficulty === k ? 'selected' : ''}>${v}</option>`).join('')}
      </select>
      <select id="tag"><option value="">全部标签</option>
        ${tags.items.map(t => `<option value="${esc(t.name)}" ${tag === t.name ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select>
      <button class="btn btn-sm" id="go">筛选</button>
      <div class="spacer"></div>
      ${currentUser && currentUser.role !== 'user' ? '<a class="btn btn-sm btn-ghost" href="#/admin">管理面板</a>' : ''}
    </div>
    <div class="card" style="padding:0">
      <table>
        <thead><tr><th style="width:70px">#</th><th>标题</th><th style="width:90px">难度</th><th style="width:100px">标签</th><th style="width:80px">通过</th><th style="width:80px">提交</th></tr></thead>
        <tbody>
          ${list.items.map(p => `
            <tr>
              <td class="muted">${p.id}</td>
              <td><a href="#/problem/${p.id}">${esc(p.title)}</a></td>
              <td>${diffBadge(p.difficulty)}</td>
              <td>${(p.tags || []).slice(0, 2).map(t => `<span class="tag" style="background:${esc(t.color)}">${esc(t.name)}</span>`).join('')}</td>
              <td>${p.accept_count}</td><td class="muted">${p.submit_count}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="muted">暂无题目</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="toolbar">
      ${page > 1 ? `<a class="btn btn-sm btn-ghost" href="#/problems?page=${page - 1}&keyword=${encodeURIComponent(keyword)}">上一页</a>` : ''}
      <span class="muted">第 ${page} 页 / 共 ${list.total} 题</span>
      ${page * 20 < list.total ? `<a class="btn btn-sm btn-ghost" href="#/problems?page=${page + 1}&keyword=${encodeURIComponent(keyword)}">下一页</a>` : ''}
    </div>`;
  document.getElementById('go').onclick = () => {
    const q = new URLSearchParams();
    if (document.getElementById('kw').value) q.set('keyword', document.getElementById('kw').value);
    if (document.getElementById('diff').value) q.set('difficulty', document.getElementById('diff').value);
    if (document.getElementById('tag').value) q.set('tag', document.getElementById('tag').value);
    location.hash = '#/problems?' + q.toString();
  };
  document.getElementById('kw').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('go').click(); });
});

route('problem', async (el, seg) => {
  const id = seg[1];
  const { problem: p } = await API.get('/problems/' + id);
  el.innerHTML = `
    <div class="split">
      <div>
        <div class="card">
          <h2>${esc(p.title)} <span class="muted">#${p.id}</span> ${diffBadge(p.difficulty)}
            ${(p.tags || []).map(t => `<span class="tag" style="background:${esc(t.color)}">${esc(t.name)}</span>`).join('')}
          </h2>
          <div class="muted">时间限制 ${p.time_limit_ms}ms · 内存限制 ${p.memory_limit_mb}MB · 通过 ${p.accept_count} / 提交 ${p.submit_count}${p.author ? ' · 出题人 ' + esc(p.author) : ''}</div>
          <div class="markdown" style="margin-top:16px">
            <h3>题目描述</h3>${mdToHtml(p.description)}
            <h3>输入格式</h3>${mdToHtml(p.input_format)}
            <h3>输出格式</h3>${mdToHtml(p.output_format)}
          </div>
          ${(p.samples || []).map((s, i) => `
            <h3>样例 ${i + 1}</h3>
            <div class="grid grid-2">
              <div class="sample-box"><strong>输入</strong><button class="btn btn-sm btn-ghost copy-btn" data-copy="${esc(s.input)}">复制</button><pre class="code">${esc(s.input)}</pre></div>
              <div class="sample-box"><strong>输出</strong><button class="btn btn-sm btn-ghost copy-btn" data-copy="${esc(s.output)}">复制</button><pre class="code">${esc(s.output)}</pre></div>
            </div>`).join('')}
          ${p.hint ? `<h3>提示</h3><div class="markdown">${mdToHtml(p.hint)}</div>` : ''}
          <div id="ai-hint-box" style="margin-top:12px"></div>
        </div>
        <div class="card">
          <div class="tabs">
            <button class="active" data-tab="submit">提交</button>
            <button data-tab="discussion">讨论</button>
          </div>
          <div id="tab-submit"></div>
          <div id="tab-discussion" hidden></div>
        </div>
      </div>
      <div class="sticky-side">
        <div class="card">
          <h3>操作</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            ${currentUser ? `<button class="btn" id="fav-btn">${p.favorited ? '★ 已收藏' : '☆ 收藏'}</button>` : '<a class="btn" href="#/login">登录后提交</a>'}
            <button class="btn btn-ghost" id="md-copy">复制为 Markdown</button>
            <button class="btn btn-ghost" id="hint-btn" ${currentUser ? '' : 'hidden'}>AI 思路提示</button>
            ${currentUser && currentUser.role !== 'user' ? `<button class="btn btn-ghost" id="ai-data">AI 生成数据</button>` : ''}
            ${currentUser && currentUser.role !== 'user' ? `<button class="btn btn-ghost" onclick="plagiarismProblem(${p.id})">查重检测</button>` : ''}
          </div>
        </div>
        <div class="card">
          <h3>讨论区</h3>
          <div id="side-discussions" class="muted">加载中…</div>
        </div>
      </div>
    </div>`;

  el.querySelectorAll('.copy-btn').forEach(b => {
    b.onclick = () => { navigator.clipboard.writeText(b.dataset.copy); b.textContent = '已复制'; setTimeout(() => b.textContent = '复制', 1200); };
  });
  document.getElementById('md-copy').onclick = () => {
    const md = `# ${p.title}\n\n${p.description}\n\n**输入**\n${p.input_format}\n\n**输出**\n${p.output_format}\n` +
      (p.samples || []).map(s => `\n**样例输入**\n\`\`\`\n${s.input}\n\`\`\`\n**样例输出**\n\`\`\`\n${s.output}\n\`\`\`\n`).join('');
    navigator.clipboard.writeText(md);
  };
  const favBtn = document.getElementById('fav-btn');
  if (favBtn) favBtn.onclick = async () => {
    if (p.favorited) { await API.del('/users/favorites/' + p.id); favBtn.textContent = '☆ 收藏'; p.favorited = false; }
    else { await API.post('/users/favorites/' + p.id); favBtn.textContent = '★ 已收藏'; p.favorited = true; }
  };
  document.getElementById('hint-btn').onclick = async () => {
    const box = document.getElementById('ai-hint-box');
    box.innerHTML = '<div class="muted">AI 正在思考…</div>';
    try {
      const r = await API.post('/ai/hint', { problemId: p.id });
      box.innerHTML = `<div class="card" style="border-color:var(--primary)"><strong>💡 提示</strong><p>${esc(r.hint)}</p></div>`;
    } catch (e) {
      box.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  };
  const aiDataBtn = document.getElementById('ai-data');
  if (aiDataBtn) aiDataBtn.onclick = async () => {
    const n = Number(prompt('普通数据个数 (1-10)', '3')) || 3;
    const e2 = Number(prompt('边缘数据个数 (0-10)', '2'));
    aiDataBtn.disabled = true;
    aiDataBtn.textContent = '生成中…';
    try {
      const r = await API.post('/ai/testdata', { problemId: p.id, normalCount: n, edgeCount: e2 });
      alert(`已生成 ${r.created} 个测试点`);
    } catch (e) { alert(e.message); }
    aiDataBtn.disabled = false;
    aiDataBtn.textContent = 'AI 生成数据';
  };

  // submit tab
  const submitBox = document.getElementById('tab-submit');
  if (!currentUser) {
    submitBox.innerHTML = '<div class="muted">请先登录</div>';
  } else {
    submitBox.innerHTML = `
      <div class="form-group"><label>语言</label><select id="lang"></select></div>
      <div class="form-group"><label>代码</label><textarea id="code" style="min-height:240px" placeholder="// 在此编写代码"></textarea></div>
      <div class="form-group">
        <label>多文件提交（可选，如 C++ 多文件工程）</label>
        <div id="files-box"></div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <input type="text" id="fname" placeholder="文件名 如 helper.cpp" style="max-width:180px">
          <button class="btn btn-sm btn-ghost" id="add-file" type="button">添加文件</button>
        </div>
      </div>
      <button class="btn" id="do-submit">提交</button>
      <div id="submit-msg" style="margin-top:10px"></div>`;
    const extraFiles = [];
    document.getElementById('add-file').onclick = () => {
      const name = document.getElementById('fname').value.trim();
      if (!name) return;
      const content = prompt(`粘贴 ${name} 的内容：`, '');
      if (content === null) return;
      extraFiles.push({ filename: name, content });
      document.getElementById('fname').value = '';
      renderFilesBox();
    };
    window.__renderFilesBox = renderFilesBox;
    function renderFilesBox() {
      document.getElementById('files-box').innerHTML = extraFiles.map((f, i) =>
        `<span class="file-chip">${esc(f.filename)} (${f.content.length}B) <button data-i="${i}">×</button></span>`
      ).join('');
      document.querySelectorAll('#files-box button').forEach(b => {
        b.onclick = () => { extraFiles.splice(Number(b.dataset.i), 1); renderFilesBox(); };
      });
    }
    const langs = await API.get('/admin/languages').catch(() => null);
    const langList = langs ? langs.items.filter(l => l.enabled) : [{ id: 'cpp', name: 'C++' }, { id: 'python3', name: 'Python 3' }];
    const sel = document.getElementById('lang');
    sel.innerHTML = langList.map(l => `<option value="${l.id}" ${currentUser.preferred_language === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    document.getElementById('do-submit').onclick = async () => {
      const msg = document.getElementById('submit-msg');
      msg.innerHTML = '';
      try {
        const r = await API.post('/submissions', {
          problemId: p.id, language: sel.value, code: document.getElementById('code').value,
          files: extraFiles,
        });
        msg.innerHTML = `<div class="success-box">已提交 #${r.id}，<a href="#/submission/${r.id}">查看状态</a></div>`;
      } catch (e) {
        msg.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
      }
    };
  }

  // discussion tab
  const discBox = document.getElementById('tab-discussion');
  discBox.innerHTML = currentUser
    ? `<div class="form-group"><label>发表讨论（Markdown）</label><textarea id="disc-content" style="min-height:100px"></textarea></div>
       <button class="btn btn-sm" id="disc-post">发布</button><div id="disc-msg"></div>
       <div id="disc-list" style="margin-top:16px"></div>`
    : '<div class="muted">登录后参与讨论</div><div id="disc-list" style="margin-top:16px"></div>';
  if (currentUser) {
    document.getElementById('disc-post').onclick = async () => {
      const content = document.getElementById('disc-content').value.trim();
      if (!content) return;
      try {
        await API.post('/discussions', { problem_id: p.id, content });
        document.getElementById('disc-content').value = '';
        loadDiscussionList(p.id);
      } catch (e) {
        document.getElementById('disc-msg').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
      }
    };
  }
  loadDiscussionList(p.id);

  loadDiscussions(p.id);
  document.querySelectorAll('.tabs button').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.tabs button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      document.getElementById('tab-submit').hidden = b.dataset.tab !== 'submit';
      document.getElementById('tab-discussion').hidden = b.dataset.tab !== 'discussion';
    };
  });
});

async function loadDiscussions(problemId) {
  const side = document.getElementById('side-discussions');
  try {
    const { items } = await API.get('/discussions?problem=' + problemId);
    if (!items.length) { if (side) side.innerHTML = '暂无讨论'; return; }
    if (side) side.innerHTML = items.slice(0, 5).map(d =>
      `<div style="padding:4px 0;font-size:13px">${d.is_official ? '🏅' : ''}${d.pinned ? '📌' : ''} ${esc(d.title || d.content.slice(0, 30))} <span class="muted">${esc(d.username)}</span></div>`
    ).join('');
  } catch (_) { if (side) side.innerHTML = '暂无讨论'; }
}

async function loadDiscussionList(problemId) {
  const box = document.getElementById('disc-list');
  if (!box) return;
  try {
    const { items } = await API.get('/discussions?problem=' + problemId);
    box.innerHTML = items.map(d => `
      <div class="disc-item ${d.is_official ? 'official' : ''} ${d.pinned ? 'pinned' : ''}">
        <div><strong>${esc(d.username)}</strong>
          ${d.is_official ? '<span class="badge badge-warning">官方题解</span>' : ''}
          ${d.pinned ? '<span class="badge badge-info">置顶</span>' : ''}
          ${d.blessed ? '<span class="badge badge-success">精华</span>' : ''}
          ${d.locked ? '<span class="badge badge-gray">已锁定</span>' : ''}
          <span class="muted">${new Date(d.created_at).toLocaleString()}</span>
          ${currentUser && (currentUser.id === d.user_id || ['admin', 'super'].includes(currentUser.role)) ? `<button class="btn btn-sm btn-ghost" onclick="delDisc(${d.id})">删除</button>` : ''}
          ${currentUser && ['teacher', 'admin', 'super'].includes(currentUser.role) ? `
            <button class="btn btn-sm btn-ghost" onclick="discAction(${d.id},'pin')">${d.pinned ? '取消置顶' : '置顶'}</button>
            <button class="btn btn-sm btn-ghost" onclick="discAction(${d.id},'official')">${d.is_official ? '取消官方' : '官方'}</button>` : ''}
        </div>
        <div class="markdown" style="margin-top:4px">${mdToHtml(d.content)}</div>
        ${(d.replies || []).map(r => `
          <div class="disc-reply disc-item">
            <div><strong>${esc(r.username)}</strong> <span class="muted">${new Date(r.created_at).toLocaleString()}</span>
            ${currentUser && (currentUser.id === r.user_id || ['admin', 'super'].includes(currentUser.role)) ? `<button class="btn btn-sm btn-ghost" onclick="delDisc(${r.id})">删除</button>` : ''}</div>
            <div class="markdown">${mdToHtml(r.content)}</div>
            ${currentUser && !d.locked ? `<button class="btn btn-sm btn-ghost" onclick="replyTo(${d.id})">回复</button>` : ''}
          </div>`).join('')}
        ${currentUser && !d.locked ? `<button class="btn btn-sm btn-ghost" onclick="replyTo(${d.id})">回复</button>` : ''}
      </div>`).join('') || '<div class="muted">暂无讨论</div>';
    if (typeof renderMath === 'function') renderMath(box);
  } catch (e) {
    box.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
}

window.delDisc = async (id) => {
  if (!confirm('确认删除该讨论？')) return;
  await API.del('/discussions/' + id);
  const { segments } = parseHash();
  loadDiscussionList(segments[1]);
};
window.discAction = async (id, action) => {
  await API.post(`/discussions/${id}/${action}`);
  const { segments } = parseHash();
  loadDiscussionList(segments[1]);
};
window.replyTo = async (parentId) => {
  const content = prompt('回复内容（Markdown）：');
  if (!content || !content.trim()) return;
  const { segments } = parseHash();
  await API.post('/discussions', { problem_id: Number(segments[1]), parent_id: parentId, content: content.trim() });
  loadDiscussionList(segments[1]);
};

route('submission', async (el, seg) => {
  const id = seg[1];
  const { submission: s } = await API.get('/submissions/' + id);
  el.innerHTML = `
    <div class="card">
      <h2>提交 #${s.id} ${statusBadge(s.status)}</h2>
      <div class="muted">
        <a href="#/profile/${esc(s.username)}">${esc(s.username)}</a> ·
        <a href="#/problem/${s.problem_id}">${esc(s.problem_title)}</a> ·
        ${esc(s.language)} · ${new Date(s.created_at).toLocaleString()}
        ${s.time_ms != null ? ` · ${s.time_ms}ms` : ''}${s.memory_kb != null ? ` · ${s.memory_kb}KB` : ''}
        ${s.score != null ? ` · 得分 ${s.score}` : ''}
      </div>
      <div id="live-status" style="margin-top:8px"></div>
      ${s.compile_output ? `<h3>编译输出</h3><pre class="code">${esc(s.compile_output)}</pre>` : ''}
      ${s.code ? `<h3>源代码</h3><pre class="code">${esc(s.code)}</pre>` : ''}
      ${s.detail && s.detail.error ? `<div class="error-box">${esc(s.detail.error)}</div>` : ''}
      ${s.detail && s.detail.cases ? `
        <h3>测试点</h3>
        <table><thead><tr><th>#</th><th>结果</th><th>时间</th><th>内存</th><th>说明</th></tr></thead>
        <tbody>${s.detail.cases.map(c => `
          <tr><td>${c.index + 1}</td><td>${statusBadge(c.verdict)}</td><td>${c.time_ms}ms</td><td>${c.memory_kb}KB</td><td class="muted">${esc(c.message || '')}</td></tr>
        `).join('')}</tbody></table>` : ''}
      ${(currentUser && ['teacher','admin','super'].includes(currentUser.role)) ? `<div style="margin-top:12px"><button class="btn btn-sm" id="rejudge">重新评测</button></div>` : ''}
    </div>`;
  const rj = document.getElementById('rejudge');
  if (rj) rj.onclick = async () => { await API.post(`/submissions/${s.id}/rejudge`); location.reload(); };

  // live update via WS
  const onWs = (ev) => {
    const m = ev.detail;
    if (m.type === 'submission' && Number(m.id) === s.id) {
      const box = document.getElementById('live-status');
      if (box) box.innerHTML = `实时状态：${statusBadge(m.status)}${m.progress ? ` (${m.progress.done}/${m.progress.total})` : ''}`;
      if (['accepted','wrong_answer','time_limit','memory_limit','runtime_error','compile_error','output_limit','internal_error','system_error'].includes(m.status)) {
        setTimeout(() => location.reload(), 600);
        window.removeEventListener('noldoj-ws', onWs);
      }
    }
  };
  window.addEventListener('noldoj-ws', onWs);
});

route('ide', async (el) => {
  if (!currentUser) { location.hash = '#/login'; return; }
  el.innerHTML = `
    <div class="card">
      <h2>在线编程</h2>
      <div class="toolbar">
        <select id="lang"></select>
        <span id="ide-status" class="badge badge-gray">就绪</span>
        <div class="spacer"></div>
        <button class="btn" id="run">运行</button>
      </div>
      <div class="grid grid-2">
        <div>
          <textarea id="code" style="min-height:320px">// 在此编写代码</textarea>
          <div class="form-group" style="margin-top:8px"><label>标准输入 (stdin)</label><textarea id="stdin" style="min-height:80px"></textarea></div>
        </div>
        <div>
          <label class="muted">输出</label>
          <pre class="code" id="out" style="min-height:320px;white-space:pre-wrap">（暂无输出）</pre>
          <div id="ide-meta" class="muted" style="margin-top:8px"></div>
        </div>
      </div>
    </div>`;
  const langs = await API.get('/admin/languages').catch(() => null);
  const langList = langs ? langs.items.filter(l => l.enabled) : [{ id: 'cpp', name: 'C++' }, { id: 'python3', name: 'Python 3' }];
  const sel = document.getElementById('lang');
  sel.innerHTML = langList.map(l => `<option value="${l.id}" ${currentUser.preferred_language === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('');

  let runId = null;
  document.getElementById('run').onclick = async () => {
    const statusEl = document.getElementById('ide-status');
    statusEl.textContent = '提交中…'; statusEl.className = 'badge badge-info';
    try {
      const r = await API.post('/ide/run', {
        language: sel.value,
        code: document.getElementById('code').value,
        stdin: document.getElementById('stdin').value,
      });
      runId = r.id;
      statusEl.textContent = '排队中'; 
    } catch (e) { statusEl.textContent = e.message; statusEl.className = 'badge badge-danger'; }
  };
  window.addEventListener('noldoj-ws', async (ev) => {
    const m = ev.detail;
    if (m.type !== 'ide' || m.id !== runId) return;
    const statusEl = document.getElementById('ide-status');
    if (['compiling','running'].includes(m.status)) { statusEl.textContent = m.status === 'compiling' ? '编译中' : '运行中'; statusEl.className = 'badge badge-info'; }
    if (['done','time_limit','memory_limit','runtime_error','compile_error','internal_error'].includes(m.status)) {
      const { run } = await API.get('/ide/run/' + runId);
      statusEl.textContent = STATUS_MAP[run.status] ? STATUS_MAP[run.status][0] : run.status;
      statusEl.className = 'badge ' + (STATUS_MAP[run.status] ? STATUS_MAP[run.status][1] : 'badge-gray');
      document.getElementById('out').textContent = run.stdout || run.stderr || '（无输出）';
      document.getElementById('ide-meta').textContent =
        `退出码 ${run.exit_code ?? '-'} · 耗时 ${run.time_ms ?? '-'}ms · 峰值内存 ${run.memory_kb ?? 0}KB`;
    }
  });
});

route('submissions', async (el, seg, query) => {
  const page = Number(query.page) || 1;
  const list = await API.get(`/submissions?page=${page}&pageSize=20`);
  el.innerHTML = `
    <div class="card" style="padding:0">
      <table>
        <thead><tr><th>#</th><th>用户</th><th>题目</th><th>状态</th><th>语言</th><th>耗时</th><th>内存</th><th>时间</th></tr></thead>
        <tbody>${list.items.map(s => `
          <tr>
            <td><a href="#/submission/${s.id}">${s.id}</a></td>
            <td><a href="#/profile/${esc(s.username)}">${esc(s.username)}</a></td>
            <td><a href="#/problem/${s.problem_id}">${esc(s.problem_title)}</a></td>
            <td>${statusBadge(s.status)}</td>
            <td class="muted">${esc(s.language)}</td>
            <td class="muted">${s.time_ms ?? '-'}</td>
            <td class="muted">${s.memory_kb != null ? s.memory_kb + 'KB' : '-'}</td>
            <td class="muted">${new Date(s.created_at).toLocaleTimeString()}</td>
          </tr>`).join('') || '<tr><td colspan="8" class="muted">暂无提交</td></tr>'}
        </tbody>
      </table>
    </div>
    <div class="toolbar">
      ${page > 1 ? `<a class="btn btn-sm btn-ghost" href="#/submissions?page=${page - 1}">上一页</a>` : ''}
      <span class="muted">第 ${page} 页</span>
      ${page * 20 < list.total ? `<a class="btn btn-sm btn-ghost" href="#/submissions?page=${page + 1}">下一页</a>` : ''}
    </div>`;
});

route('ranking', async (el) => {
  const { items } = await API.get('/users/ranking');
  el.innerHTML = `
    <div class="card">
      <h2>🏆 Rating 排行榜</h2>
      <table>
        <thead><tr><th>名次</th><th>用户</th><th>Rating</th><th>称号</th></tr></thead>
        <tbody>${items.map(u => `
          <tr>
            <td>${u.rank <= 3 ? `<span class="medal-${u.rank}">${['🥇','🥈','🥉'][u.rank - 1]}</span>` : u.rank}</td>
            <td><a href="#/profile/${esc(u.username)}">${esc(u.username)}</a></td>
            <td><strong>${u.rating}</strong></td>
            <td>${esc(u.title)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
});

route('profile', async (el, seg) => {
  const username = seg[1];
  const data = await API.get('/users/' + encodeURIComponent(username));
  const u = data.user;
  el.innerHTML = `
    <div class="split">
      <div>
        <div class="card">
          <h2>${esc(u.username)} <span class="badge badge-info">${esc(data.title)}</span>
            ${{ user: '用户', teacher: '教师', admin: '管理员', super: '超级管理员' }[u.role] ? `<span class="badge badge-gray">${{ user: '用户', teacher: '教师', admin: '管理员', super: '超级管理员' }[u.role]}</span>` : ''}</h2>
          <div class="muted">Rating <strong>${u.rating}</strong> · 提交 ${data.stats.submit} · AC ${data.stats.accepted} · 解题 ${data.stats.solved} · 注册于 ${new Date(u.created_at).toLocaleDateString()}</div>
          ${u.signature ? `<p><em>${esc(u.signature)}</em></p>` : ''}
          ${u.bio ? `<div class="markdown">${mdToHtml(u.bio)}</div>` : ''}
        </div>
        ${data.achievements ? `
        <div class="card"><h3>🎖 成就</h3>
          <div class="grid grid-3">
            ${(data.achievements.unlocked || []).map(a => `<div class="card" style="margin:0"><strong>${esc(a.name)}</strong><div class="muted">${esc(a.description)}</div></div>`).join('') || '<div class="muted">暂无成就</div>'}
          </div>
          ${(data.achievements.locked || []).length ? `<details style="margin-top:10px"><summary class="muted">未解锁 (${data.achievements.locked.length})</summary><div class="muted">${data.achievements.locked.map(a => esc(a.name)).join(' · ')}</div></details>` : ''}
        </div>` : '<div class="card muted">该用户隐藏了成就</div>'}
        ${data.favorites ? `
        <div class="card"><h3>⭐ 收藏</h3>
          ${data.favorites.map(f => `<a href="#/problem/${f.id}" style="display:inline-block;margin:4px 8px 4px 0">#${f.id} ${esc(f.title)}</a>`).join('') || '<div class="muted">暂无收藏</div>'}
        </div>` : ''}
        ${data.dashboard ? `
        <div class="card"><h3>📊 学习面板</h3>
          <div class="grid grid-2">
            <div><strong>语言分布</strong>${data.dashboard.languages.map(l => `<div>${esc(l.language)}: ${l.count}</div>`).join('') || '<div class="muted">无数据</div>'}</div>
            <div><strong>AC 难度分布</strong>${data.dashboard.difficulty.map(d => `<div>${DIFF_MAP[d.difficulty] || d.difficulty}: ${d.count}</div>`).join('') || '<div class="muted">无数据</div>'}</div>
          </div>
        </div>` : ''}
      </div>
      <div class="sticky-side">
        ${currentUser && currentUser.id === u.id ? `<div class="card"><h3>隐私设置</h3><div id="privacy-box" class="muted">加载中…</div></div>` : ''}
      </div>
    </div>`;
  if (currentUser && currentUser.id === u.id) {
    const box = document.getElementById('privacy-box');
    box.innerHTML = `
      <label><input type="checkbox" id="pv-ach"> 隐藏成就</label><br>
      <label><input type="checkbox" id="pv-dash"> 隐藏学习面板</label><br>
      <label><input type="checkbox" id="pv-fav"> 隐藏收藏</label><br>
      <button class="btn btn-sm" id="pv-save" style="margin-top:8px">保存</button>
      <div id="pv-msg"></div>`;
    document.getElementById('pv-save').onclick = async () => {
      await API.put('/users/me', {
        privacy: {
          hideAchievements: document.getElementById('pv-ach').checked,
          hideDashboard: document.getElementById('pv-dash').checked,
          hideFavorites: document.getElementById('pv-fav').checked,
        },
      });
      document.getElementById('pv-msg').innerHTML = '<div class="success-box">已保存</div>';
    };
  }
});

/* stub routes for scaffolded sections */
async function listStub(el, title, apiPath, renderItem) {
  try {
    const data = await API.get(apiPath);
    const items = data.items || [];
    el.innerHTML = `<div class="card"><h2>${title}</h2>
      ${items.map(renderItem).join('') || '<div class="muted">暂无数据</div>'}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="card"><h2>${title}</h2><div class="error-box">${esc(e.message)}</div></div>`;
  }
}
route('contests', (el) => listStub(el, '🏁 比赛', '/contests', c => {
  const st = { not_started: ['未开始', 'badge-gray'], in_progress: ['进行中', 'badge-success'], ended: ['已结束', 'badge-info'] }[c.status];
  return `<div style="padding:8px 0"><a href="#/contest/${c.id}"><strong>${esc(c.title)}</strong></a> <span class="badge ${st[1]}">${st[0]}</span>
    <div class="muted">${new Date(c.start_at).toLocaleString()} ~ ${new Date(c.end_at).toLocaleString()}</div></div>`;
}));
route('contest', async (el, seg) => {
  const { contest: c } = await API.get('/contests/' + seg[1]);
  let solutions = [];
  try { solutions = (await API.get(`/contests/${c.id}/solutions`)).items; } catch (_) {}
  el.innerHTML = `<div class="card">
    <h2>${esc(c.title)}</h2>
    <div class="muted">${new Date(c.start_at).toLocaleString()} ~ ${new Date(c.end_at).toLocaleString()}</div>
    <div class="markdown">${mdToHtml(c.description)}</div>
    <h3>题目</h3>
    ${c.problems.map(p => `<div><a href="#/problem/${p.id}">${p.alias || ''} ${esc(p.title)}</a> ${diffBadge(p.difficulty)}</div>`).join('') || '<div class="muted">比赛开始后可见</div>'}
    ${solutions.length ? `<h3>题解</h3>${solutions.map(s => `<div><a href="#/article/${s.id}">${esc(s.title)}</a> ${s.published ? '' : '<span class="badge badge-warning">未发布</span>'}</div>`).join('')}` : ''}
    ${c.status === 'ended' && currentUser ? `<button class="btn" id="virt" style="margin-top:12px">虚拟参赛</button><div id="virt-msg"></div>` : ''}
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <a class="btn btn-ghost btn-sm" href="#/contest/${c.id}/board">查看排行榜</a>
      ${currentUser && currentUser.role !== 'user' ? `
        <button class="btn btn-ghost btn-sm" onclick="plagiarismContest(${c.id})">比赛一键查重</button>
        <button class="btn btn-ghost btn-sm" onclick="publishSolutions(${c.id})">发布题解</button>` : ''}
    </div>
  </div>`;
  const v = document.getElementById('virt');
  if (v) v.onclick = async () => {
    try {
      const r = await API.post(`/virtual/${c.id}/start`);
      document.getElementById('virt-msg').innerHTML = `<div class="success-box">虚拟参赛已开始，时长 ${Math.round(r.durationMs / 60000)} 分钟，独立计时。</div>`;
    } catch (e) {
      document.getElementById('virt-msg').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  };
});
window.plagiarismContest = async (cid) => {
  const r = await API.post(`/plagiarism/contest/${cid}`);
  alert('比赛查重任务已创建 #' + r.jobId);
  location.hash = '#/plagiarism/' + r.jobId;
};
window.publishSolutions = async (cid) => {
  try {
    const r = await API.post(`/contests/${cid}/publish-solutions`);
    alert(`已发布 ${r.published} 篇题解`);
    location.reload();
  } catch (e) { alert(e.message); }
};
route('board', async (el, seg) => {
  const cid = seg[1];
  const data = await API.get(`/contests/${cid}/board`);
  el.innerHTML = `<div class="card">
    <h2>排行榜 ${data.frozen ? '<span class="badge badge-warning">🔒 已封榜</span>' : ''}</h2>
    ${data.frozen ? '<div class="error-box">比赛结束前若干分钟已封榜，显示为冻结时点数据。</div>' : ''}
    <table><thead><tr><th>名次</th><th>用户</th><th>总分</th><th>罚时</th></tr></thead>
    <tbody>${data.board.map(r => `
      <tr><td>${r.rank <= 3 ? `<span class="medal-${r.rank}">${['🥇','🥈','🥉'][r.rank - 1]}</span>` : r.rank}</td>
      <td>${esc(r.username)}</td><td>${r.total}</td><td class="muted">${r.penalty}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">暂无参赛者</td></tr>'}
    </tbody></table>
  </div>`;
});
route('exams', (el) => listStub(el, '📝 考试', '/exams', e =>
  `<div style="padding:8px 0"><strong>${esc(e.title)}</strong> <span class="muted">${e.duration_min} 分钟 · 满分 ${e.total_score} · 及格 ${e.pass_score}</span></div>`));
route('articles', (el) => listStub(el, '📄 文章', '/articles', a =>
  `<div style="padding:8px 0"><a href="#/article/${a.id}"><strong>${esc(a.title)}</strong></a>${a.is_solution ? ' <span class="badge badge-success">题解</span>' : ''}${!a.published ? ' <span class="badge badge-warning">草稿</span>' : ''}<div class="muted">${esc(a.author_name || '')} · ${new Date(a.created_at).toLocaleDateString()}</div></div>`));
route('article', async (el, seg) => {
  const { article: a } = await API.get('/articles/' + seg[1]);
  el.innerHTML = `<div class="card"><h2>${esc(a.title)}</h2>
    <div class="muted">${esc(a.author_name || '')} · ${new Date(a.created_at).toLocaleString()} · 阅读 ${a.view_count}</div>
    <div class="markdown">${mdToHtml(a.content)}</div></div>`;
});
route('announcements', (el) => listStub(el, '📢 公告', '/announcements', a =>
  `<div style="padding:8px 0">${a.pinned ? '📌' : ''} <a href="#/announcements/${a.id}"><strong>${esc(a.title)}</strong></a> <span class="muted">${new Date(a.created_at).toLocaleDateString()}</span></div>`));
route('problem-sets', (el) => listStub(el, '📚 题单', '/problem-sets', s =>
  `<div style="padding:8px 0"><strong>${esc(s.title)}</strong><div class="muted">${esc(s.description || '')}</div></div>`));

route('admin', async (el) => {
  if (!currentUser || currentUser.role === 'user') { el.innerHTML = '<div class="error-box">权限不足</div>'; return; }
  const [stats, problems] = await Promise.all([
    API.get('/admin/stats').catch(() => ({ users: '-', problems: '-', submissions: '-', contests: '-', pending: '-' })),
    API.get('/problems?pageSize=100').catch(() => ({ items: [] })),
  ]);
  el.innerHTML = `
    <div class="card">
      <h2>🛠 管理面板</h2>
      <div class="grid grid-3">
        <div class="card" style="margin:0"><div class="muted">用户</div><div style="font-size:24px;font-weight:700">${stats.users}</div></div>
        <div class="card" style="margin:0"><div class="muted">题目</div><div style="font-size:24px;font-weight:700">${stats.problems}</div></div>
        <div class="card" style="margin:0"><div class="muted">待评测</div><div style="font-size:24px;font-weight:700">${stats.pending}</div></div>
      </div>
      <div class="toolbar" style="margin-top:16px">
        <button class="btn btn-sm" id="new-problem">+ 新建题目</button>
        <a class="btn btn-sm btn-ghost" href="#/admin/users">用户管理</a>
        <a class="btn btn-sm btn-ghost" href="#/admin/languages">语言管理</a>
        <a class="btn btn-sm btn-ghost" href="#/admin/groups">用户组</a>
      </div>
    </div>
    <div class="card"><h3>题目管理</h3>
      <table><thead><tr><th>#</th><th>标题</th><th>难度</th><th>操作</th></tr></thead>
      <tbody>${problems.items.slice(0, 30).map(p => `
        <tr><td>${p.id}</td><td><a href="#/problem/${p.id}">${esc(p.title)}</a></td><td>${diffBadge(p.difficulty)}</td>
        <td><button class="btn btn-sm btn-ghost" onclick="delProblem(${p.id})">删除</button></td></tr>`).join('')}
      </tbody></table>
    </div>`;
  document.getElementById('new-problem').onclick = () => { location.hash = '#/admin/problem/new'; };
});

window.delProblem = async (id) => {
  if (!confirm('确认删除题目 #' + id + '？编号将被回收。')) return;
  await API.del('/problems/' + id);
  location.reload();
};

route('admin-users', async (el) => {
  if (!currentUser || !['admin', 'super'].includes(currentUser.role)) { el.innerHTML = '<div class="error-box">权限不足</div>'; return; }
  const { items } = await API.get('/admin/users');
  const isSuper = currentUser.role === 'super';
  el.innerHTML = `
    <div class="card">
      <h2>用户管理</h2>
      ${isSuper ? `
      <div class="toolbar">
        <input type="text" id="nu-name" placeholder="用户名">
        <input type="password" id="nu-pass" placeholder="密码">
        <select id="nu-role"><option value="user">用户</option><option value="teacher">教师</option><option value="admin">管理员</option></select>
        <button class="btn btn-sm" id="nu-create">创建用户</button>
      </div>` : ''}
      <table><thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>Rating</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${items.map(u => `
        <tr>
          <td>${u.id}</td><td>${esc(u.username)}</td>
          <td>${esc(u.role)}</td><td>${u.rating}</td>
          <td>${u.banned ? '<span class="badge badge-danger">封禁</span>' : '<span class="badge badge-success">正常</span>'}</td>
          <td>
            ${isSuper ? `<button class="btn btn-sm btn-ghost" onclick="loginAs(${u.id})">切换身份</button>` : ''}
            <button class="btn btn-sm ${u.banned ? '' : 'btn-danger'}" onclick="toggleBan(${u.id}, ${u.banned ? 0 : 1})">${u.banned ? '解封' : '封禁'}</button>
            <button class="btn btn-sm btn-ghost" onclick="forceLogout(${u.id})">强制下线</button>
          </td>
        </tr>`).join('')}
      </tbody></table>
    </div>`;
  if (isSuper) {
    document.getElementById('nu-create').onclick = async () => {
      try {
        await API.post('/admin/users', {
          username: document.getElementById('nu-name').value.trim(),
          password: document.getElementById('nu-pass').value,
          role: document.getElementById('nu-role').value,
        });
        location.reload();
      } catch (e) { alert(e.message); }
    };
  }
});
window.toggleBan = async (id, banned) => {
  if (banned && !confirm('确认封禁该用户？其登录态将立即失效。')) return;
  await API.put('/admin/users/' + id, { banned: !!banned });
  location.reload();
};
window.forceLogout = async (id) => { await API.post(`/admin/users/${id}/force-logout`); alert('已强制下线'); };
window.loginAs = async (id) => {
  const r = await API.post(`/admin/users/${id}/login-as`);
  API.setToken(r.token);
  APP.setUser(r.user);
  location.hash = '#/';
};

route('admin-languages', async (el) => {
  if (!currentUser || currentUser.role !== 'super') { el.innerHTML = '<div class="error-box">仅超级管理员可管理语言</div>'; return; }
  const { items } = await API.get('/admin/languages');
  el.innerHTML = `<div class="card"><h2>语言管理</h2>
    <table><thead><tr><th>ID</th><th>名称</th><th>编译命令</th><th>运行命令</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${items.map(l => `
      <tr><td>${esc(l.id)}</td><td>${esc(l.name)}</td>
      <td class="muted" style="font-size:12px">${esc(l.compile_cmd || '-')}</td>
      <td class="muted" style="font-size:12px">${esc(l.run_cmd)}</td>
      <td>${l.enabled ? '<span class="badge badge-success">启用</span>' : '<span class="badge badge-gray">禁用</span>'}</td>
      <td><button class="btn btn-sm btn-ghost" onclick="toggleLang('${l.id}', ${l.enabled ? 0 : 1})">${l.enabled ? '禁用' : '启用'}</button></td>
      </tr>`).join('')}
    </tbody></table></div>`;
});
window.toggleLang = async (id, enabled) => {
  await API.put('/admin/languages/' + id, { enabled: !!enabled });
  location.reload();
};

route('admin-groups', async (el) => {
  if (!currentUser || !['admin', 'super'].includes(currentUser.role)) { el.innerHTML = '<div class="error-box">权限不足</div>'; return; }
  const { items } = await API.get('/admin/groups');
  el.innerHTML = `<div class="card"><h2>用户组</h2>
    ${currentUser.role === 'super' ? `<div class="toolbar"><input type="text" id="g-name" placeholder="组名"><input type="text" id="g-desc" placeholder="描述"><button class="btn btn-sm" id="g-create">创建</button></div>` : ''}
    ${items.map(g => `
      <div class="card" style="margin:8px 0">
        <strong>${esc(g.name)}</strong> ${g.is_system ? '<span class="badge badge-info">系统组</span>' : ''}
        <div class="muted">${esc(g.description || '')}</div>
        <div class="muted">成员：${g.members.map(m => esc(m.username)).join('、') || '无'}</div>
        ${!g.is_system && currentUser.role === 'super' ? `<button class="btn btn-sm btn-danger" onclick="delGroup(${g.id})">删除</button>` : ''}
      </div>`).join('')}
  </div>`;
  if (currentUser.role === 'super') {
    document.getElementById('g-create').onclick = async () => {
      try {
        await API.post('/admin/groups', { name: document.getElementById('g-name').value.trim(), description: document.getElementById('g-desc').value });
        location.reload();
      } catch (e) { alert(e.message); }
    };
  }
});
window.delGroup = async (id) => {
  if (!confirm('删除该组？相关可见性绑定将失效。')) return;
  await API.del('/admin/groups/' + id);
  location.reload();
};

route('admin-problem-new', async (el) => {
  if (!currentUser || currentUser.role === 'user') { el.innerHTML = '<div class="error-box">权限不足</div>'; return; }
  el.innerHTML = `<div class="card">
    <h2>新建题目</h2>
    <div id="msg"></div>
    <div class="form-group"><label>标题</label><input type="text" id="p-title"></div>
    <div class="form-group"><label>难度</label><select id="p-diff">${Object.entries(DIFF_MAP).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="form-group"><label>题目描述 (Markdown)</label><textarea id="p-desc"></textarea></div>
    <div class="grid grid-2">
      <div class="form-group"><label>输入格式</label><textarea id="p-in"></textarea></div>
      <div class="form-group"><label>输出格式</label><textarea id="p-out"></textarea></div>
    </div>
    <div class="form-group"><label>标签（逗号分隔）</label><input type="text" id="p-tags" placeholder="模拟,贪心"></div>
    <div class="grid grid-2">
      <div class="form-group"><label>时间限制(ms)</label><input type="number" id="p-tl" value="2000"></div>
      <div class="form-group"><label>内存限制(MB)</label><input type="number" id="p-ml" value="256"></div>
    </div>
    <label><input type="checkbox" id="p-pub" checked> 公开</label>
    <div style="margin-top:16px"><button class="btn" id="p-save">创建</button></div>
  </div>`;
  document.getElementById('p-save').onclick = async () => {
    try {
      const r = await API.post('/problems', {
        title: document.getElementById('p-title').value.trim(),
        difficulty: document.getElementById('p-diff').value,
        description: document.getElementById('p-desc').value,
        input_format: document.getElementById('p-in').value,
        output_format: document.getElementById('p-out').value,
        tags: document.getElementById('p-tags').value.split(/[,，]/).map(s => s.trim()).filter(Boolean),
        time_limit_ms: Number(document.getElementById('p-tl').value),
        memory_limit_mb: Number(document.getElementById('p-ml').value),
        is_public: document.getElementById('p-pub').checked,
      });
      location.hash = '#/problem/' + r.id;
    } catch (e) {
      document.getElementById('msg').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  };
});

/* ================= extended pages ================= */

// ---- code diff ----
route('diff', async (el, seg, query) => {
  if (!currentUser) { location.hash = '#/login'; return; }
  const aId = query.a, bId = query.b;
  if (!aId || !bId) {
    // pick two submissions for a problem
    const pid = query.problem || '';
    el.innerHTML = `<div class="card"><h2>代码对比</h2>
      <div class="toolbar">
        <input type="number" id="d-a" placeholder="提交 A 的 ID" value="${esc(aId || '')}" style="max-width:140px">
        <input type="number" id="d-b" placeholder="提交 B 的 ID" value="${esc(bId || '')}" style="max-width:140px">
        <button class="btn btn-sm" id="d-go">对比</button>
      </div>
      <p class="muted">同一用户同一题目的两次提交可对比。可在提交详情页点击“对比其他提交”。</p>
    </div>`;
    document.getElementById('d-go').onclick = () => {
      location.hash = `#/diff?a=${document.getElementById('d-a').value}&b=${document.getElementById('d-b').value}`;
    };
    return;
  }
  const data = await API.get(`/submissions/compare/${aId}/${bId}`);
  el.innerHTML = `<div class="card">
    <h2>代码对比</h2>
    <div class="muted">#${a.id} (${esc(a.language)}, ${new Date(a.created_at).toLocaleString()}) vs #${b.id} (${esc(b.language)}, ${new Date(b.created_at).toLocaleString()})</div>
    <div style="margin-top:12px">${diffHtml(a.code, b.code)}</div>
  </div>`;
});

// patch submission page: add diff link for owner
const _origSubmissionRoute = routes.submission;
routes.submission = async (el, seg) => {
  await _origSubmissionRoute(el, seg);
  const s = (await API.get('/submissions/' + seg[1])).submission;
  if (currentUser && currentUser.id === s.user_id) {
    const card = el.querySelector('.card');
    const div = document.createElement('div');
    div.style.marginTop = '12px';
    div.innerHTML = `<label class="muted">对比其他提交（输入同一题另一提交 ID）</label>
      <div class="toolbar"><input type="number" id="diff-other" placeholder="其他提交 ID" style="max-width:140px">
      <button class="btn btn-sm btn-ghost" id="diff-go">对比</button></div>`;
    card.appendChild(div);
    document.getElementById('diff-go').onclick = () => {
      const o = document.getElementById('diff-other').value;
      if (o) location.hash = `#/diff?a=${s.id}&b=${o}`;
    };
  }
};

// ---- problem sets ----
route('problem-sets', async (el) => {
  const { items } = await API.get('/problem-sets');
  el.innerHTML = `<div class="card"><h2>📚 题单训练</h2>
    ${items.map(s => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <a href="#/problem-set/${s.id}"><strong>${esc(s.title)}</strong></a>
      ${s.is_public ? '' : '<span class="badge badge-gray">私有</span>'}
      <div class="muted">${esc(s.description || '')}</div>
    </div>`).join('') || '<div class="muted">暂无题单</div>'}
    ${currentUser && currentUser.role !== 'user' ? '<button class="btn btn-sm" id="new-set" style="margin-top:12px">+ 新建题单</button><div id="new-set-box"></div>' : ''}
  </div>`;
  const nb = document.getElementById('new-set');
  if (nb) nb.onclick = () => {
    document.getElementById('new-set-box').innerHTML = `
      <div class="form-group" style="margin-top:10px"><label>标题</label><input type="text" id="ns-title"></div>
      <div class="form-group"><label>描述</label><textarea id="ns-desc" style="min-height:60px"></textarea></div>
      <button class="btn btn-sm" id="ns-save">创建</button>`;
    document.getElementById('ns-save').onclick = async () => {
      const r = await API.post('/problem-sets', {
        title: document.getElementById('ns-title').value.trim(),
        description: document.getElementById('ns-desc').value,
      });
      location.hash = '#/problem-set/' + r.id;
    };
  };
});

route('problem-set', async (el, seg) => {
  const id = seg[1];
  const { set: s } = await API.get('/problem-sets/' + id);
  const pct = s.progress ? Math.round(100 * s.progress.solved / Math.max(1, s.progress.total)) : 0;
  el.innerHTML = `<div class="card">
    <h2>${esc(s.title)} ${s.is_public ? '' : '<span class="badge badge-gray">私有</span>'}</h2>
    <div class="markdown">${mdToHtml(s.description)}</div>
    ${s.progress ? `<div style="margin:12px 0"><div class="muted">进度 ${s.progress.solved}/${s.progress.total} (${pct}%)</div>
      <div class="progress-bar"><div style="width:${pct}%"></div></div></div>` : ''}
    <table><thead><tr><th>#</th><th>标题</th><th>难度</th><th>状态</th></tr></thead>
    <tbody>${(s.problems || []).map((p, i) => `
      <tr><td>${i + 1}</td><td><a href="#/problem/${p.id}">${esc(p.title)}</a></td>
      <td>${diffBadge(p.difficulty)}</td><td>${s.progress && s.progress.solved > i ? '<span class="badge badge-success">已解决</span>' : ''}</td></tr>
    ` ).join('') || '<tr><td colspan="4" class="muted">暂无题目</td></tr>'}</tbody></table>
    ${currentUser && currentUser.role !== 'user' ? `
      <div class="toolbar" style="margin-top:12px">
        <input type="number" id="ps-pid" placeholder="题目 ID" style="max-width:120px">
        <button class="btn btn-sm" id="ps-add">添加题目</button>
      </div>` : ''}
  </div>`;
  const add = document.getElementById('ps-add');
  if (add) add.onclick = async () => {
    await API.post(`/problem-sets/${id}/problems`, { problemId: Number(document.getElementById('ps-pid').value) });
    location.reload();
  };
});

// ---- exams ----
route('exams', async (el) => {
  const { items } = await API.get('/exams');
  el.innerHTML = `<div class="card"><h2>📝 考试</h2>
    ${items.map(e => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <strong>${esc(e.title)}</strong>
      <span class="muted">${e.duration_min} 分钟 · 满分 ${e.total_score} · 及格 ${e.pass_score} · 最多 ${e.max_attempts || '?'} 次</span>
      <div style="margin-top:6px">
        <a class="btn btn-sm" href="#/exam/${e.id}">进入</a>
        ${currentUser && currentUser.role !== 'user' ? `<button class="btn btn-sm btn-ghost" onclick="delExam(${e.id})">删除</button>` : ''}
      </div>
    </div>`).join('') || '<div class="muted">暂无考试</div>'}
    ${currentUser && currentUser.role !== 'user' ? `
      <div class="card" style="margin-top:16px">
        <h3>新建考试</h3>
        <div class="form-group"><label>标题</label><input type="text" id="ex-title"></div>
        <div class="grid grid-2">
          <div class="form-group"><label>时长(分钟)</label><input type="number" id="ex-dur" value="60"></div>
          <div class="form-group"><label>及格分</label><input type="number" id="ex-pass" value="60"></div>
        </div>
        <button class="btn btn-sm" id="ex-create">创建</button>
      </div>` : ''}
  </div>`;
  const c = document.getElementById('ex-create');
  if (c) c.onclick = async () => {
    const r = await API.post('/exams', {
      title: document.getElementById('ex-title').value.trim(),
      duration_min: Number(document.getElementById('ex-dur').value),
      pass_score: Number(document.getElementById('ex-pass').value),
      total_score: 100,
    });
    location.hash = '#/exam/' + r.id;
  };
});
window.delExam = async (id) => {
  if (!confirm('删除考试？')) return;
  await API.del('/exams/' + id);
  location.reload();
};

route('exam', async (el, seg) => {
  const id = seg[1];
  const { exam: e } = await API.get('/exams/' + id);
  const privileged = currentUser && ['teacher', 'admin', 'super'].includes(currentUser.role);
  const attempt = (e.attempts || []).find(a => a.status === 'in_progress');
  const graded = (e.attempts || []).filter(a => a.status !== 'in_progress');
  el.innerHTML = `<div class="card">
    <h2>${esc(e.title)}</h2>
    <div class="muted">时长 ${e.duration_min} 分钟 · 满分 ${e.total_score} · 及格 ${e.pass_score} · 最大尝试 ${e.max_attempts}</div>
    <div class="markdown">${mdToHtml(e.description)}</div>
    <div class="toolbar" style="margin-top:12px">
      ${!attempt && currentUser ? `<button class="btn" id="ex-start">开始答题</button>` : ''}
      ${attempt ? `<a class="btn" href="#/exam/take/${attempt.id}">继续答题（#${attempt.id}）</a>` : ''}
    </div>
    ${graded.length ? `<h3>历史成绩</h3>${graded.map(a => `<div>${a.status === 'graded' ? '得分' : '已提交待评分'}: <strong>${a.score ?? '-'}</strong> · ${new Date(a.started_at).toLocaleString()}</div>`).join('')}` : ''}
    ${privileged ? `
      <h3>题目管理</h3>
      <div id="ex-questions">${(e.questions || []).map((q, i) => `
        <div class="card" style="margin:8px 0">
          <strong>#${i + 1} [${{ choice: '选择', truefalse: '判断', fill: '填空', essay: '简答' }[q.type] || q.type}]</strong>
          <span class="muted">${q.score} 分</span>
          <div class="markdown">${mdToHtml(q.content)}</div>
          ${(q.options || []).length ? `<div>${q.options.map(o => `<div>${esc(o.key)}. ${esc(o.text)}</div>`).join('')}</div>` : ''}
          <div class="muted">答案: ${esc(q.answer || '（主观题）')}</div>
          <button class="btn btn-sm btn-ghost" onclick="delQuestion(${q.id})">删除</button>
        </div>`).join('') || '<div class="muted">暂无题目</div>'}</div>
      <div class="card" style="margin-top:12px">
        <h4>添加试题</h4>
        <div class="form-group"><label>题型</label>
          <select id="q-type"><option value="choice">选择</option><option value="truefalse">判断</option><option value="fill">填空</option><option value="essay">简答</option></select></div>
        <div class="form-group"><label>题干 (Markdown)</label><textarea id="q-content"></textarea></div>
        <div class="form-group"><label>选项 JSON（选择题，如 [{"key":"A","text":"..."}]）</label><textarea id="q-opts" style="min-height:50px"></textarea></div>
        <div class="grid grid-2">
          <div class="form-group"><label>答案</label><input type="text" id="q-answer"></div>
          <div class="form-group"><label>分值</label><input type="number" id="q-score" value="5"></div>
        </div>
        <button class="btn btn-sm" id="q-add">添加</button>
        <details style="margin-top:8px"><summary class="muted">Excel/JSON 批量导入</summary>
          <textarea id="q-batch" style="min-height:80px" placeholder='[{"type":"choice","content":"1+1=?","options":[{"key":"A","text":"1"},{"key":"B","text":"2"}],"answer":"B","score":5}]'></textarea>
          <button class="btn btn-sm btn-ghost" id="q-import">导入</button>
        </details>
      </div>` : ''}
  </div>`;
  const start = document.getElementById('ex-start');
  if (start) start.onclick = async () => {
    const r = await API.post(`/exams/${id}/start`);
    location.hash = `#/exam/take/${r.attemptId}`;
  };
  const qa = document.getElementById('q-add');
  if (qa) qa.onclick = async () => {
    let opts = [];
    try { opts = JSON.parse(document.getElementById('q-opts').value || '[]'); } catch (_) {}
    await API.post(`/exams/${id}/questions`, {
      type: document.getElementById('q-type').value,
      content: document.getElementById('q-content').value,
      options: opts,
      answer: document.getElementById('q-answer').value,
      score: Number(document.getElementById('q-score').value),
    });
    location.reload();
  };
  const qi = document.getElementById('q-import');
  if (qi) qi.onclick = async () => {
    try {
      const questions = JSON.parse(document.getElementById('q-batch').value);
      const r = await API.post(`/exams/${id}/import`, { questions });
      alert(`已导入 ${r.imported} 题`);
      location.reload();
    } catch (e) { alert('导入失败: ' + e.message); }
  };
  if (typeof renderMath === 'function') renderMath(el);
});
window.delQuestion = async (qid) => {
  if (!confirm('删除该题？')) return;
  await API.del('/exams/questions/' + qid);
  location.reload();
};

route('exam-take', async (el, seg) => {
  if (!currentUser) { location.hash = '#/login'; return; }
  const aid = seg[2];
  // load exam via attempt: fetch exams list then find — simpler: use exam from take flow
  // We fetch attempt's exam through a lightweight approach: ask exam take endpoint doesn't exist;
  // use /exams + attempts. Instead store exam id in hash: #/exam/take/:aid (need exam id too)
  // Convention: pass examId in query: #/exam/take/:aid?exam=ID
  const { query } = parseHash();
  if (!query.exam) {
    // try to discover from graded attempts across exams is heavy; require exam param
    el.innerHTML = '<div class="error-box">缺少考试参数，请从考试页进入</div>';
    return;
  }
  const { exam: e } = await API.get('/exams/' + query.exam);
  const qs = e.questions || [];
  el.innerHTML = `<div id="exam-timer"></div><div class="card">
    <h2>${esc(e.title)} · 答题</h2>
    <div id="exam-form">
      ${qs.map((q, i) => `
        <div class="card" style="margin:10px 0">
          <strong>#${i + 1}</strong> <span class="badge badge-info">${q.score} 分</span>
          <span class="muted">${{ choice: '选择', truefalse: '判断', fill: '填空', essay: '简答' }[q.type]}</span>
          <div class="markdown">${mdToHtml(q.content)}</div>
          ${q.type === 'choice' ? (q.options || []).map(o => `
            <label style="display:block"><input type="radio" name="q${q.id}" value="${esc(o.key)}"> ${esc(o.key)}. ${esc(o.text)}</label>`).join('') : ''}
          ${q.type === 'truefalse' ? `
            <label><input type="radio" name="q${q.id}" value="T"> 正确</label>
            <label><input type="radio" name="q${q.id}" value="F"> 错误</label>` : ''}
          ${q.type === 'fill' ? `<input type="text" data-q="${q.id}" placeholder="填写答案">` : ''}
          ${q.type === 'essay' ? `<textarea data-q="${q.id}" style="min-height:100px"></textarea>` : ''}
        </div>`).join('')}
      <button class="btn" id="ex-submit">交卷</button>
      <div id="ex-msg"></div>
    </div>
  </div>`;
  const deadline = Date.now() + e.duration_min * 60000;
  const timer = setInterval(() => {
    const left = Math.max(0, deadline - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    const bar = document.getElementById('exam-timer');
    if (bar) bar.innerHTML = `<div class="timer-bar">剩余 ${m}:${String(s).padStart(2, '0')}</div>`;
    if (left <= 0) { clearInterval(timer); document.getElementById('ex-submit')?.click(); }
  }, 500);
  document.getElementById('ex-submit').onclick = async () => {
    clearInterval(timer);
    const answers = {};
    for (const q of qs) {
      if (q.type === 'choice' || q.type === 'truefalse') {
        const checked = document.querySelector(`input[name="q${q.id}"]:checked`);
        if (checked) answers[q.id] = checked.value;
      } else {
        const node = document.querySelector(`[data-q="${q.id}"]`);
        if (node) answers[q.id] = node.value;
      }
    }
    try {
      const r = await API.post(`/exams/attempts/${aid}/submit`, { answers });
      document.getElementById('ex-msg').innerHTML = `<div class="success-box">已交卷！${r.needManualGrading ? '含主观题，待评分。' : '总分: ' + r.score}</div>`;
      document.getElementById('exam-form').querySelectorAll('input,textarea,button').forEach(x => x.disabled = true);
    } catch (err) {
      document.getElementById('ex-msg').innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  };
  if (typeof renderMath === 'function') renderMath(el);
});

// fix exam start link to include exam id
const _origExamRoute = routes.exam;
routes.exam = async (el, seg, query) => {
  await _origExamRoute(el, seg, query);
  // patch continue/start links with exam id
  el.querySelectorAll('a[href^="#/exam/take/"]').forEach(a => {
    a.href = a.href.split('?')[0] + `?exam=${seg[1]}`;
  });
  const startBtn = document.getElementById('ex-start');
  if (startBtn) {
    const old = startBtn.onclick;
    startBtn.onclick = async () => {
      const r = await API.post(`/exams/${seg[1]}/start`);
      location.hash = `#/exam/take/${r.attemptId}?exam=${seg[1]}`;
    };
  }
};

// ---- articles editor ----
route('article-new', async (el) => {
  if (!currentUser || currentUser.role === 'user') { el.innerHTML = '<div class="error-box">权限不足</div>'; return; }
  el.innerHTML = `<div class="card">
    <h2>写文章 / 题解</h2>
    <div class="form-group"><label>标题</label><input type="text" id="a-title"></div>
    <div class="grid grid-2">
      <div class="form-group"><label>关联题目 ID（可选）</label><input type="number" id="a-pid"></div>
      <div class="form-group"><label>&nbsp;</label><label><input type="checkbox" id="a-sol"> 标记为题解</label>
        <label style="margin-left:12px"><input type="checkbox" id="a-pub" checked> 立即发布</label></div>
    </div>
    <div class="form-group"><label>内容 (Markdown + $公式$)</label><textarea id="a-content" style="min-height:320px"></textarea></div>
    <div id="a-preview" class="markdown card" style="min-height:80px"></div>
    <button class="btn" id="a-save">保存</button>
    <div id="a-msg"></div>
  </div>`;
  document.getElementById('a-content').addEventListener('input', (ev) => {
    document.getElementById('a-preview').innerHTML = mdToHtml(ev.target.value);
    renderMath(document.getElementById('a-preview'));
  });
  document.getElementById('a-save').onclick = async () => {
    try {
      const r = await API.post('/articles', {
        title: document.getElementById('a-title').value.trim(),
        content: document.getElementById('a-content').value,
        problem_id: Number(document.getElementById('a-pid').value) || null,
        is_solution: document.getElementById('a-sol').checked,
        published: document.getElementById('a-pub').checked,
      });
      location.hash = '#/article/' + r.id;
    } catch (e) {
      document.getElementById('a-msg').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  };
});
const _origArticles = routes.articles;
routes.articles = async (el, seg, query) => {
  await _origArticles(el, seg, query);
  if (currentUser && currentUser.role !== 'user') {
    const card = el.querySelector('.card');
    const b = document.createElement('div');
    b.style.marginTop = '12px';
    b.innerHTML = '<a class="btn btn-sm" href="#/article/new">+ 写文章</a>';
    card.appendChild(b);
  }
};
// route 'article-new' key from hash #/article/new → segments[0]='article', segments[1]='new'
const _origArticle = routes.article;
routes.article = async (el, seg, query) => {
  if (seg[1] === 'new') return routes['article-new'](el, seg, query);
  return _origArticle(el, seg, query);
};

// ---- announcements detail ----
// list + detail both under #/announcements[/:id]
const _origAnnList = routes.announcements;
routes.announcements = async (el, seg, query) => {
  if (seg[1]) {
    const { announcement: a } = await API.get('/announcements/' + seg[1]);
    el.innerHTML = `<div class="card">
      <h2>${a.pinned ? '📌 ' : ''}${esc(a.title)}</h2>
      <div class="muted">${new Date(a.created_at).toLocaleString()}</div>
      <div class="markdown">${mdToHtml(a.content)}</div>
      <p><a href="#/announcements">← 返回公告列表</a></p>
    </div>`;
    renderMath(el);
    return;
  }
  await _origAnnList(el, [], query);
};

// ---- files ----
route('files', async (el) => {
  if (!currentUser) { location.hash = '#/login'; return; }
  const data = await API.get('/files/mine');
  const usedMb = (data.used_bytes / 1048576).toFixed(2);
  el.innerHTML = `<div class="card">
    <h2>📁 文件托管 / 图床</h2>
    <p class="muted">已使用 ${usedMb}MB / ${data.quota_mb}MB · 单文件限制见管理设置。上传后获得直链，可嵌入 Markdown。</p>
    <div class="form-group"><input type="file" id="fu"></div>
    <button class="btn" id="fu-go">上传</button>
    <div id="fu-msg" style="margin-top:10px"></div>
    <h3 style="margin-top:20px">我的文件</h3>
    <table><thead><tr><th>文件名</th><th>大小</th><th>时间</th><th>操作</th></tr></thead>
    <tbody>${data.items.map(f => `<tr>
      <td><a href="/uploads/${esc(f.stored_name)}" target="_blank">${esc(f.filename)}</a></td>
      <td class="muted">${(f.size / 1024).toFixed(1)}KB</td>
      <td class="muted">${new Date(f.created_at).toLocaleString()}</td>
      <td><button class="btn btn-sm btn-ghost" onclick="copyText('/uploads/${esc(f.stored_name)}')">复制链接</button>
          <button class="btn btn-sm btn-danger" onclick="delFile(${f.id})">删除</button></td>
    </tr>`).join('') || '<tr><td colspan="4" class="muted">暂无文件</td></tr>'}</tbody></table>
  </div>`;
  document.getElementById('fu-go').onclick = async () => {
    const file = document.getElementById('fu').files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    const msg = document.getElementById('fu-msg');
    msg.innerHTML = '<div class="muted">上传中…</div>';
    try {
      const token = API.token();
      const res = await fetch('/api/files/upload', { method: 'POST', body: fd, headers: { Authorization: 'Bearer ' + token } });
      const r = await res.json();
      if (!res.ok) throw new Error(r.error || '上传失败');
      msg.innerHTML = `<div class="success-box">已上传：<code>${esc(location.origin + r.url)}</code>
        <button class="btn btn-sm btn-ghost" onclick="copyText('${esc(location.origin + r.url)}')">复制</button></div>`;
    } catch (e) {
      msg.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  };
});
window.copyText = (t) => { navigator.clipboard.writeText(t); };
window.delFile = async (id) => {
  if (!confirm('删除该文件？')) return;
  await API.del('/files/' + id);
  location.reload();
};

// ---- plagiarism ----
window.plagiarismProblem = async (pid) => {
  const r = await API.post(`/plagiarism/problem/${pid}`);
  alert('查重任务已创建 #' + r.jobId + '，稍后在查重页查看结果');
  location.hash = '#/plagiarism/' + r.jobId;
};
route('plagiarism', async (el, seg) => {
  if (!currentUser || currentUser.role === 'user') { el.innerHTML = '<div class="error-box">权限不足（teacher+）</div>'; return; }
  if (seg[1]) {
    const { job } = await API.get('/plagiarism/job/' + seg[1]);
    el.innerHTML = `<div class="card">
      <h2>查重报告 #${job.id}</h2>
      <div>状态: ${statusBadge(job.status === 'done' ? 'accepted' : job.status === 'failed' ? 'internal_error' : 'judging')}
        <span class="muted">${esc(job.progress)}</span></div>
      <table style="margin-top:12px"><thead><tr><th>相似度</th><th>级别</th><th>用户 A</th><th>用户 B</th><th></th></tr></thead>
      <tbody>${job.pairs.map(p => `
        <tr><td><strong>${(p.similarity * 100).toFixed(1)}%</strong></td>
        <td>${p.level === 'high' ? '<span class="badge badge-danger">高度相似</span>' : '<span class="badge badge-warning">疑似</span>'}</td>
        <td>${esc(p.name_a || '?')} (#${p.submission_a})</td>
        <td>${esc(p.name_b || '?')} (#${p.submission_b})</td>
        <td><a class="btn btn-sm btn-ghost" href="#/diff?a=${p.submission_a}&b=${p.submission_b}">并排对比</a></td></tr>
      `).join('') || '<tr><td colspan="5" class="muted">未发现疑似抄袭（阈值 70%）</td></tr>'}</tbody></table>
      ${job.status === 'pending' || job.status === 'running' ? '<button class="btn btn-sm" onclick="location.reload()">刷新进度</button>' : ''}
    </div>`;
    return;
  }
  el.innerHTML = `<div class="card"><h2>🔍 代码查重</h2>
    <p class="muted">在题目页或比赛管理中发起查重。≥85% 高度相似（红），≥70% 疑似（橙）。</p>
    <a class="btn btn-sm" href="#/problems">去题库发起</a>
  </div>`;
});

// ---- admin settings ----
route('admin-settings', async (el) => {
  if (!currentUser || currentUser.role !== 'super') { el.innerHTML = '<div class="error-box">仅超级管理员</div>'; return; }
  const s = await API.get('/admin/settings');
  el.innerHTML = `<div class="card">
    <h2>⚙️ 运行设置</h2>
    <p class="muted">修改后立即生效并持久化到 config/config.json</p>
    <div class="form-group"><label><input type="checkbox" id="s-reg" ${s.registrationEnabled ? 'checked' : ''}> 允许自助注册</label></div>
    <div class="form-group"><label><input type="checkbox" id="s-cap" ${s.captchaEnabled ? 'checked' : ''}> 启用验证码</label></div>
    <hr style="border-color:var(--border)">
    <div class="form-group"><label><input type="checkbox" id="s-air" ${s.aiReviewEnabled ? 'checked' : ''}> AI 代码安全审查</label></div>
    <div class="form-group"><label><input type="checkbox" id="s-aih" ${s.aiHintEnabled ? 'checked' : ''}> AI 提示</label></div>
    <div class="form-group"><label><input type="checkbox" id="s-aid" ${s.aiTestdataEnabled ? 'checked' : ''}> AI 数据生成</label></div>
    <div class="form-group"><label>AI 服务地址</label><input type="text" id="s-aiurl" value="${esc(s.aiBaseUrl)}"></div>
    <div class="form-group"><label>AI 模型</label><input type="text" id="s-aimodel" value="${esc(s.aiModel)}"></div>
    <div class="form-group"><label>API Key（留空不修改）</label><input type="password" id="s-aikey" placeholder="${s.aiApiKeySet ? '已设置（输入以覆盖）' : '未设置'}"></div>
    <hr style="border-color:var(--border)">
    <div class="grid grid-2">
      <div class="form-group"><label>默认用户存储配额 (MB)</label><input type="number" id="s-quota" value="${s.defaultUserQuotaMb}"></div>
      <div class="form-group"><label>单文件上限 (MB)</label><input type="number" id="s-file" value="${s.maxSingleFileMb}"></div>
      <div class="form-group"><label>评测队列并发</label><input type="number" id="s-conc" value="${s.queueConcurrency}"></div>
    </div>
    <button class="btn" id="s-save">保存设置</button>
    <div id="s-msg" style="margin-top:10px"></div>
  </div>`;
  document.getElementById('s-save').onclick = async () => {
    const body = {
      registrationEnabled: document.getElementById('s-reg').checked,
      captchaEnabled: document.getElementById('s-cap').checked,
      aiReviewEnabled: document.getElementById('s-air').checked,
      aiHintEnabled: document.getElementById('s-aih').checked,
      aiTestdataEnabled: document.getElementById('s-aid').checked,
      aiBaseUrl: document.getElementById('s-aiurl').value,
      aiModel: document.getElementById('s-aimodel').value,
      defaultUserQuotaMb: Number(document.getElementById('s-quota').value),
      maxSingleFileMb: Number(document.getElementById('s-file').value),
      queueConcurrency: Number(document.getElementById('s-conc').value),
    };
    const key = document.getElementById('s-aikey').value;
    if (key) body.aiApiKey = key;
    try {
      await API.put('/admin/settings', body);
      document.getElementById('s-msg').innerHTML = '<div class="success-box">已保存并持久化</div>';
    } catch (e) {
      document.getElementById('s-msg').innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  };
});
// link from admin dashboard
const _origAdmin = routes.admin;
routes.admin = async (el, seg, query) => {
  if (seg[1] === 'settings') return routes['admin-settings'](el, seg, query);
  if (seg[1] === 'users') return routes['admin-users'](el, seg, query);
  if (seg[1] === 'languages') return routes['admin-languages'](el, seg, query);
  if (seg[1] === 'groups') return routes['admin-groups'](el, seg, query);
  if (seg[1] === 'problem' && seg[2] === 'new') return routes['admin-problem-new'](el, seg, query);
  await _origAdmin(el, seg, query);
  const toolbar = el.querySelector('.toolbar');
  if (toolbar && currentUser.role === 'super') {
    toolbar.insertAdjacentHTML('beforeend', '<a class="btn btn-sm btn-ghost" href="#/admin/settings">系统设置</a>');
  }
  if (toolbar) {
    toolbar.insertAdjacentHTML('beforeend', '<a class="btn btn-sm btn-ghost" href="#/files">文件托管</a><a class="btn btn-sm btn-ghost" href="#/plagiarism">查重</a>');
  }
};

// group import UI
const _origGroups = routes['admin-groups'];
routes['admin-groups'] = async (el, seg, query) => {
  await _origGroups(el, seg, query);
  if (currentUser.role !== 'super') return;
  el.querySelectorAll('.card').forEach(card => {
    const delBtn = card.querySelector('button.btn-danger');
    if (!delBtn) return;
    const m = delBtn.getAttribute('onclick').match(/delGroup\((\d+)\)/);
    if (!m) return;
    const gid = m[1];
    if (card.querySelector('.is-system')) return;
    const wrap = document.createElement('div');
    wrap.style.marginTop = '8px';
    wrap.innerHTML = `
      <button class="btn btn-sm btn-ghost" onclick="toggleImportBox(this, ${gid})">Excel/表格导入成员</button>
      <div id="imp-box-${gid}" hidden style="margin-top:8px">
        <textarea id="imp-rows-${gid}" style="min-height:80px" placeholder="每行: 用户名,密码(可选)&#10;张三&#10;li si,secret123"></textarea>
        <div class="form-group"><label>未注册用户的默认密码（≥6位）</label><input type="text" id="imp-pw-${gid}" value=""></div>
        <button class="btn btn-sm" onclick="doGroupImport(${gid})">导入</button>
        <div id="imp-msg-${gid}"></div>
      </div>`;
    card.appendChild(wrap);
  });
};
window.toggleImportBox = (btn, gid) => {
  const box = document.getElementById('imp-box-' + gid);
  box.hidden = !box.hidden;
};
window.doGroupImport = async (gid) => {
  const text = document.getElementById('imp-rows-' + gid).value.trim();
  const pw = document.getElementById('imp-pw-' + gid).value;
  const rows = text.split('\n').map(line => {
    const [username, password] = line.split(',').map(s => (s || '').trim());
    return { username, password: password || undefined };
  }).filter(r => r.username);
  try {
    const r = await API.post(`/admin/groups/${gid}/import`, { defaultPassword: pw, rows });
    document.getElementById('imp-msg-' + gid).innerHTML =
      `<div class="success-box">新增注册 ${r.registered} 人，加入已有用户 ${r.added} 人，跳过 ${r.skipped}${r.errors.length ? '；' + r.errors.slice(0, 3).join('；') : ''}</div>`;
  } catch (e) {
    document.getElementById('imp-msg-' + gid).innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
  }
};

// nav links for new pages
(function patchNav() {
  const links = document.getElementById('nav-links');
  // ensure files/articles write accessible via existing entries
})();
