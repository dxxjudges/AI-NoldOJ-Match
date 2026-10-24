(function () {
  'use strict';
  const N = window.NoldOJ;
  const U = N.ui;
  const esc = N.escapeHtml;

  const routes = [
    [/^\/$/, 'home'],
    [/^\/login$/, 'login'],
    [/^\/register$/, 'register'],
    [/^\/problems$/, 'problems'],
    [/^\/problems\/new$/, 'problemEdit', { id: 'new' }],
    [/^\/problem\/([^/]+)\/edit$/, 'problemEdit', ['id']],
    [/^\/problem\/([^/]+)$/, 'problemDetail', ['id']],
    [/^\/submissions$/, 'submissions'],
    [/^\/submission\/([^/]+)$/, 'submissionDetail', ['id']],
    [/^\/ide$/, 'ide'],
    [/^\/contests$/, 'contests'],
    [/^\/contest\/([^/]+)$/, 'contestDetail', ['id']],
    [/^\/articles$/, 'articles'],
    [/^\/article\/([^/]+)$/, 'articleDetail', ['id']],
    [/^\/announcements$/, 'announcements'],
    [/^\/announcement\/([^/]+)$/, 'announcementDetail', ['id']],
    [/^\/problemsets$/, 'problemsets'],
    [/^\/problemset\/([^/]+)$/, 'problemsetDetail', ['id']],
    [/^\/exams$/, 'exams'],
    [/^\/exam\/([^/]+)$/, 'examDetail', ['id']],
    [/^\/rating$/, 'rating'],
    [/^\/user\/([^/]+)$/, 'userProfile', ['id']],
    [/^\/settings$/, 'settings'],
    [/^\/files$/, 'files'],
    [/^\/admin$/, 'admin'],
  ];

  const app = document.getElementById('app');

  function resolve(path) {
    for (const [re, name, keys] of routes) {
      const m = re.exec(path);
      if (!m) continue;
      if (!keys) return { name, params: {} };
      if (Array.isArray(keys)) {
        const params = {};
        keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
        return { name, params };
      }
      return { name, params: keys };
    }
    return null;
  }

  function updateNavActive(path) {
    document.querySelectorAll('.nav-links a').forEach((a) => {
      const target = (a.getAttribute('href') || '').replace('#', '');
      a.style.color = target !== '/' && path.startsWith(target) ? 'var(--primary)' : '';
    });
  }

  async function route() {
    const full = location.hash.slice(1) || '/';
    const [path, queryString] = full.split('?');
    const query = new URLSearchParams(queryString || '');
    window.scrollTo(0, 0);
    updateNavActive(path);

    const match = resolve(path);
    if (!match) {
      app.innerHTML = `<div class="card center"><h2>404</h2><p>页面不存在：${esc(path)}</p><a class="btn" href="#/">返回首页</a></div>`;
      return;
    }
    const fn = N.pages[match.name];
    if (!fn) {
      app.innerHTML = U.errorBox(`页面未实现：${match.name}`);
      return;
    }
    try {
      await fn(app, { params: match.params, query, path });
    } catch (err) {
      app.innerHTML = U.errorBox(err.message || String(err));
      console.error(err);
    }
  }

  /* ---------- auth UI ---------- */
  function refreshAuthUI() {
    const host = document.getElementById('nav-user');
    const ratingHost = document.getElementById('nav-rating');
    const u = N.state.user;
    if (u) {
      host.innerHTML = `<a href="#/user/${u.id}" title="${esc(N.ROLE_TEXT[u.role] || u.role)}">${esc(u.username)}</a>
        ${u.role !== 'user' ? '<a href="#/admin" title="管理后台">⚙</a>' : ''}
        <a href="#" id="logout-link">退出</a>`;
      if (ratingHost) ratingHost.textContent = `Rating ${u.rating}`;
      const link = document.getElementById('logout-link');
      if (link) link.onclick = async (e) => { e.preventDefault(); await N.logout(); N.toast('已退出登录', 'success'); N.navigate('/'); };
    } else {
      host.innerHTML = `<a href="#/login">登录</a> / <a href="#/register">注册</a>`;
      if (ratingHost) ratingHost.textContent = '';
    }
  }

  /* ---------- global search ---------- */
  function setupSearch() {
    const input = document.getElementById('global-search');
    const results = document.getElementById('search-results');
    if (!input) return;
    const run = U.debounce(async () => {
      const q = input.value.trim();
      if (!q) { results.hidden = true; return; }
      try {
        const data = await N.api(`/api/search?q=${encodeURIComponent(q)}`);
        const sections = [];
        if (data.problems && data.problems.length) sections.push(`<h4>题目</h4>${data.problems.map((p) => `<a href="#/problem/${p.id}">${esc(p.title)}</a>`).join('')}`);
        if (data.contests && data.contests.length) sections.push(`<h4>比赛</h4>${data.contests.map((c) => `<a href="#/contest/${c.id}">${esc(c.title)}</a>`).join('')}`);
        if (data.articles && data.articles.length) sections.push(`<h4>文章</h4>${data.articles.map((a) => `<a href="#/article/${a.id}">${esc(a.title)}</a>`).join('')}`);
        results.innerHTML = sections.length ? sections.join('') : '<div class="muted" style="padding:8px">未找到结果</div>';
        results.hidden = false;
      } catch { results.hidden = true; }
    }, 300);
    input.oninput = run;
    input.onfocus = () => { if (input.value.trim()) run(); };
    document.addEventListener('click', (e) => {
      if (!results.contains(e.target) && e.target !== input) results.hidden = true;
    });
    results.addEventListener('click', () => { results.hidden = true; input.value = ''; });
  }

  /* ---------- websocket ---------- */
  function setupWs() {
    N.ws.on('open', () => {});
    N.ws.on('force_logout', () => { N.logout(); N.toast('您已被强制下线', 'error'); });
    N.ws.on('user_banned', () => { N.toast('您的账号已被封禁', 'error'); });
    N.ws.on('user_update', (payload) => { if (N.state.user && payload && payload.id === N.state.user.id) { N.loadMe().then(refreshAuthUI); } });
    N.ws.on('rating_update', (payload) => {
      if (N.state.user && payload && payload.user_id === N.state.user.id) {
        N.state.user.rating = payload.rating;
        refreshAuthUI();
      }
    });
    N.ws.connect();
  }

  /* ---------- boot ---------- */
  N.setTheme(document.documentElement.getAttribute('data-theme') || 'light');
  document.getElementById('theme-toggle').onclick = N.toggleTheme;
  window.addEventListener('noldoj:auth', refreshAuthUI);
  window.addEventListener('hashchange', route);

  (async function boot() {
    await N.loadConfig();
    await N.loadMe();
    refreshAuthUI();
    setupSearch();
    setupWs();
    if (!location.hash) location.hash = '#/';
    route();
  })();
})();
