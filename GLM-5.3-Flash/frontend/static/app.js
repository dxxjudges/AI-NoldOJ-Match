/* NoldOJ shared frontend runtime: api client, auth, navbar, dark mode, markdown, websocket */
(function () {
  'use strict';

  // ---------- theme ----------
  function theme() { return localStorage.getItem('noldoj-theme') || 'light'; }
  function setTheme(t) {
    localStorage.setItem('noldoj-theme', t);
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
  }

  // ---------- api client ----------
  let accessToken = localStorage.getItem('noldoj-token') || '';
  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem('noldoj-user') || 'null'); } catch (e) { currentUser = null; }

  const subUpdaters = [];
  const ideUpdaters = [];
  const wsHandlers = [];
  const leaderboardUpdaters = [];

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers['Authorization'] = 'Bearer ' + accessToken;
    let res;
    try {
      res = await fetch('/api' + path, {
        method: opts.method || 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
      });
    } catch (e) { return { ok: false, error: '网络错误' }; }
    if (res.status === 401 && !path.startsWith('/auth/')) {
      const rf = await fetch('/api/auth/refresh', { method: 'POST' });
      if (rf.ok) {
        const rd = await rf.json();
        if (rd.ok) {
          accessToken = rd.data.accessToken; currentUser = rd.data.user;
          localStorage.setItem('noldoj-token', accessToken);
          localStorage.setItem('noldoj-user', JSON.stringify(currentUser));
          return api(path, opts);
        }
      }
      logoutLocal();
      return { ok: false, error: '登录状态过期' };
    }
    let data;
    try { data = await res.json(); } catch (e) { data = { ok: false, error: 'HTTP ' + res.status }; }
    return data;
  }

  function logoutLocal() {
    accessToken = ''; currentUser = null;
    localStorage.removeItem('noldoj-token');
    localStorage.removeItem('noldoj-user');
  }

  async function refreshNavRating() {
    if (!currentUser) return;
    const r = await api('/auth/me');
    if (r.ok) {
      currentUser = r.data;
      localStorage.setItem('noldoj-user', JSON.stringify(currentUser));
      const el = document.getElementById('nav-rating');
      if (el) el.textContent = r.data.rating;
    }
  }

  // ---------- helpers ----------
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&').replace(/</g, '<')
      .replace(/>/g, '>').replace(/"/g, '"').replace(/'/g, '&#39;');
  }
  function qs(k) { return new URLSearchParams(location.search).get(k); }
  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n > 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
    if (n > 1048576) return (n / 1048576).toFixed(1) + 'MB';
    if (n > 1024) return (n / 1024).toFixed(1) + 'KB';
    return n + 'B';
  }
  function fmtMem(kb) {
    kb = Number(kb) || 0;
    return kb > 1024 ? (kb / 1024).toFixed(1) + 'MB' : kb + 'KB';
  }

  // ---------- markdown (safe, compact) ----------
  // Pipeline: extract math + fences -> escape HTML -> allowlisted formatting -> restore.
  function markdownCompact(md) {
    let text = String(md || '');
    const math = [], codes = [];
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (m, f) => { math.push(f); return '@@MB' + (math.length - 1) + '@@'; });
    text = text.replace(/\$([^$\n]+?)\$/g, (m, f) => { math.push(f); return '@@MB' + (math.length - 1) + '@@'; });
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => { codes.push({ lang, code }); return '@@CB' + (codes.length - 1) + '@@'; });
    text = escapeHtml(text);

    text = text
      .replace(/\[\[bili:([A-Za-z0-9]+):?(\d+)?\]\]/g, (_, bv, pg) =>
        '<iframe src="https://player.bilibili.com/player.html?bvid=' + bv + (pg ? '&p=' + pg : '') + '&autoplay=0" scrolling="no" frameborder="no" allowfullscreen="true" style="width:100%;aspect-ratio:16/9;border:0;border-radius:8px"></iframe>')
      .replace(/\[\[web:(https?:\/\/[^\]]+)\]\]/g, (_, u) =>
        '<iframe src="' + u + '" style="width:100%;height:500px;border:1px solid var(--border);border-radius:8px" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>')
      .replace(/\[\[audio:(https?:\/\/[^\]]+)\]\]/g, (_, u) => '<audio controls src="' + u + '" style="width:100%"></audio>')
      .replace(/\[\[video:(https?:\/\/[^\]]+)\]\]/g, (_, u) => '<video controls src="' + u + '" style="width:100%;max-height:480px;border-radius:8px"></video>')
      .replace(/\[\[(office|echarts|mermaid)\]\]([\s\S]*?)\[\[\/\1\]\]/g, (m, kind, inner) => {
        const raw = inner.replace(/^\n+|\s+$/g, '');
        if (kind === 'mermaid') return '<div class="mermaid-box" data-src="' + escapeHtml(raw) + '"><span data-raw="' + escapeHtml(raw) + '"></span></div>';
        if (kind === 'echarts') return '<div class="echarts-box" data-src="' + escapeHtml(raw) + '"></div>';
        // office: requires public https URL
        if (!/^https:\/\//.test(raw)) return '<pre>' + raw + '</pre>';
        return '<iframe src="https://view.officeapps.live.com/op/view.aspx?src=' + encodeURIComponent(raw) + '" style="width:100%;height:520px;border:1px solid var(--border);border-radius:8px"></iframe>';
      })
      .replace(/^###### (.*)$/gm, '<h6>$1</h6>')
      .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
      .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/^> ?(.*)$/gm, '<blockquote>$1</blockquote>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, '<img alt="$1" src="$2" style="max-width:100%">')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    // tables
    text = text.replace(/(?:^|\n)((?:\|[^\n]*\|\n?)+)/g, (m, tbl) => {
      const rows = tbl.trim().split('\n').map(r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()));
      if (rows.length < 2) return m;
      const isSep = rows[1] && rows[1].every(c => /^:?-+:?$/.test(c));
      const head = rows[0], body = rows.slice(isSep ? 2 : 1);
      return '\n<table><thead><tr>' + head.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
        body.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table>\n';
    });
    // lists
    text = text.replace(/(?:^|\n)((?:[-*] .+(?:\n|$))+)/g, (m, blk) =>
      '\n<ul>' + blk.trim().split('\n').map(l => '<li>' + l.replace(/^[-*] /, '') + '</li>').join('') + '</ul>\n');

    // paragraphs
    text = text.split(/\n{2,}/).map(p => {
      const t = p.trim();
      if (!t) return '';
      if (/^<(h\d|ul|table|blockquote|div|iframe|audio|video)/.test(t) || t.startsWith('@@')) return t;
      return '<p>' + t.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');

    // code blocks last
    text = text.replace(/@@CB(\d+)@@/g, (m, i) => {
      const cb = codes[Number(i)] || { lang: '', code: '' };
      return '<div class="code-box"><button class="btn small secondary copy-btn">复制</button><pre><code>' +
        escapeHtml(cb.code.replace(/\n+$/, '')) + '</code></pre></div>';
    });
    return { html: text, math, codes };
  }

  // lazy CDN loaders
  function loadScript(src, onload) {
    const s = document.createElement('script');
    s.src = src; s.onload = onload; s.onerror = onload;
    document.head.appendChild(s);
  }
  function ensureKatex(cb) {
    if (window.katex) return cb();
    if (!document.getElementById('katex-css')) {
      const l = document.createElement('link');
      l.id = 'katex-css'; l.rel = 'stylesheet';
      l.href = 'https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css';
      document.head.appendChild(l);
    }
    if (window.__katexLoading) { const t = setInterval(() => { if (window.katex) { clearInterval(t); cb(); } }, 100); setTimeout(() => clearInterval(t), 10000); return; }
    window.__katexLoading = true;
    loadScript('https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js', () => { window.__katexLoading = false; cb(); });
  }
  function ensureMermaid(cb) {
    if (window.mermaid) return cb();
    if (window.__mermaidLoading) { const t = setInterval(() => { if (window.mermaid) { clearInterval(t); cb(); } }, 100); setTimeout(() => clearInterval(t), 10000); return; }
    window.__mermaidLoading = true;
    loadScript('https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js', () => {
      window.__mermaidLoading = false;
      if (window.mermaid) {
        window.mermaid = window.mermaid.default || window.mermaid;
        try { window.mermaid.initialize({ startOnLoad: false, theme: theme() === 'dark' ? 'dark' : 'neutral' }); } catch (e) { }
      }
      cb();
    });
  }
  function ensureEcharts(cb) {
    if (window.echarts) return cb();
    if (window.__echartsLoading) { const t = setInterval(() => { if (window.echarts) { clearInterval(t); cb(); } }, 100); setTimeout(() => clearInterval(t), 10000); return; }
    window.__echartsLoading = true;
    loadScript('https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js', () => { window.__echartsLoading = false; cb(); });
  }

  function hydrate(el) {
    // copy buttons
    el.querySelectorAll('.code-box .copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pre = btn.parentElement.querySelector('pre');
        navigator.clipboard.writeText(pre ? pre.textContent : '').then(() => {
          btn.textContent = '已复制';
          setTimeout(() => { btn.textContent = '复制'; }, 1200);
        });
      });
    });
    // KaTeX
    ensureKatex(() => {
      if (!window.katex) return;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('@@MB')) nodes.push(walker.currentNode);
      const mathList = el._math || [];
      for (const t of nodes) {
        const span = document.createElement('span');
        span.innerHTML = t.nodeValue.replace(/@@MB(\d+)@@/g, (m, i) => '<span data-mb="' + Number(i) + '"></span>');
        t.parentNode.replaceChild(span, t);
      }
      el.querySelectorAll('[data-mb]').forEach(slot => {
        const f = mathList[Number(slot.getAttribute('data-mb'))];
        if (f === undefined) return;
        try { katex.render(f, slot, { throwOnError: false }); } catch (e) { slot.textContent = f; }
      });
    });
    // Mermaid
    el.querySelectorAll('.mermaid-box').forEach(box => {
      if (box.dataset.done) return;
      box.dataset.done = '1';
      const src = box.getAttribute('data-src') || '';
      ensureMermaid(() => {
        if (!window.mermaid) { box.innerHTML = '<pre>' + escapeHtml(src) + '</pre>'; return; }
        try {
          window.mermaid.render('nmg' + Math.random().toString(36).slice(2), src).then(r => {
            box.innerHTML = r.svg || r;
          }).catch(() => { box.innerHTML = '<pre>' + escapeHtml(src) + '</pre>'; });
        } catch (e) { box.innerHTML = '<pre>' + escapeHtml(src) + '</pre>'; }
      });
    });
    // ECharts
    el.querySelectorAll('.echarts-box').forEach(box => {
      const src = box.getAttribute('data-src') || '';
      ensureEcharts(() => {
        if (!window.echarts) { box.innerHTML = '<pre>' + escapeHtml(src) + '</pre>'; return; }
        try {
          box.style.width = '100%'; box.style.height = '360px';
          window.echarts.init(box).setOption(JSON.parse(src));
        } catch (e) { box.innerHTML = '<pre>' + escapeHtml(src) + '</pre>'; }
      });
    });
  }

  function renderMd(el, md) {
    el.classList.add('md-body');
    const r = markdownCompact(md);
    el._math = r.math;
    el.innerHTML = r.html;
    hydrate(el);
  }

  // ---------- diff ----------
  function diffLines(a, b) {
    const al = String(a).split('\n'), bl = String(b).split('\n');
    const n = al.length, m = bl.length;
    const dp = [];
    for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const rows = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (al[i] === bl[j]) { rows.push({ type: 'same', a: al[i], b: bl[j] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', a: al[i], b: '' }); i++; }
      else { rows.push({ type: 'add', a: '', b: bl[j] }); j++; }
    }
    while (i < n) rows.push({ type: 'del', a: al[i++], b: '' });
    while (j < m) rows.push({ type: 'add', a: '', b: bl[j++] });
    return rows;
  }

  function diffHtml(a, b) {
    const rows = diffLines(a, b);
    let html = '<table class="diff-table"><tr><th style="width:50%">旧代码</th><th>新代码</th></tr>';
    let i = 0;
    while (i < rows.length) {
      // pair del+add as modification (yellow)
      if (rows[i].type === 'del' && rows[i + 1] && rows[i + 1].type === 'add') {
        html += '<tr><td class="diff-mod">' + escapeHtml(rows[i].a) + '</td><td class="diff-mod">' + escapeHtml(rows[i + 1].b) + '</td></tr>';
        i += 2; continue;
      }
      const r = rows[i];
      const cls = r.type === 'add' ? 'diff-add' : r.type === 'del' ? 'diff-del' : '';
      html += '<tr><td class="' + cls + '">' + escapeHtml(r.a) + '</td><td class="' + cls + '">' + escapeHtml(r.b) + '</td></tr>';
      i++;
    }
    return html + '</table>';
  }

  // ---------- websocket (auto reconnect + heartbeat) ----------
  let ws = null, wsTimer = null, hbTimer = null;
  function connectWs() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    try {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws' +
        (accessToken ? '?token=' + encodeURIComponent(accessToken) : ''));
      ws.onopen = () => {
        setWsStatus(true);
        clearInterval(hbTimer);
        hbTimer = setInterval(() => { try { ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { } }, 20000);
      };
      ws.onclose = () => { setWsStatus(false); clearInterval(hbTimer); clearTimeout(wsTimer); wsTimer = setTimeout(connectWs, 3000); };
      ws.onerror = () => { try { ws.close(); } catch (e) { } };
      ws.onmessage = (ev) => {
        let msg = null;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.type === 'pong') return;
        if (msg.type === 'sub:update') subUpdaters.forEach(fn => { try { fn(msg.payload); } catch (e) { } });
        if (msg.type === 'ide:update') ideUpdaters.forEach(fn => { try { fn(msg.payload); } catch (e) { } });
        if (msg.type === 'leaderboard:update' || msg.type === 'plagiarism:progress') wsHandlers.forEach(fn => { try { fn(msg); } catch (e) { } });
        if (msg.type === 'rating:update') refreshNavRating();
        wsHandlers.forEach(fn => { try { fn(msg); } catch (e) { } });
      };
    } catch (e) { clearTimeout(wsTimer); wsTimer = setTimeout(connectWs, 5000); }
  }
  function setWsStatus(on) {
    const el = document.getElementById('ws-status');
    if (el) {
      el.title = on ? '实时连接正常' : '连接断开，自动重连中';
      el.style.background = on ? 'var(--green)' : 'var(--border)';
      el.style.boxShadow = on ? '0 0 6px var(--green)' : 'none';
    }
  }

  // ---------- navbar ----------
  const NAV_PAGES = [
    ['/', '首页'], ['/problems.html', '题库'], ['/contests.html', '比赛'],
    ['/status.html', '提交记录'], ['/ranking.html', '排名'], ['/ide.html', 'IDE'],
    ['/problem-sets.html', '训练'], ['/exams.html', '测验'], ['/articles.html', '文章'],
    ['/announcements.html', '公告']
  ];
  const ROLE_NAME = { user: '用户', teacher: '教师', admin: '管理员', super: '超级管理员' };

  function renderNav() {
    const links = document.getElementById('nav-links');
    const right = document.getElementById('nav-right');
    if (!links) return;
    links.innerHTML = NAV_PAGES.map(([href, label]) =>
      '<a href="' + href + '" class="' + (location.pathname === href ? 'active' : '') + '">' + label + '</a>').join('');
    let html = '<span class="ws-dot" id="ws-status" title="实时连接"></span>';
    html += '<button class="btn small secondary" id="theme-toggle" title="切换深色模式"></button>';
    if (currentUser) {
      html += '<a href="/profile.html?id=' + currentUser.id + '" class="rating-chip" id="nav-rating">' + (currentUser.rating || 0) + '</a>';
      html += '<a href="/profile.html?id=' + currentUser.id + '">' + escapeHtml(currentUser.username) + '</a>';
      if (currentUser.role !== 'user') html += '<a href="/admin.html">管理</a>';
      html += '<button class="btn small secondary" id="logout-btn">退出</button>';
    } else {
      html += '<a href="/login.html" class="btn small">登录</a>';
      html += '<a href="/register.html" class="btn small secondary">注册</a>';
    }
    right.innerHTML = html;
    const themeBtn = document.getElementById('theme-toggle');
    const paintThemeBtn = () => { themeBtn.textContent = theme() === 'dark' ? '☀️' : '🌙'; };
    paintThemeBtn();
    themeBtn.onclick = () => {
      const nt = theme() === 'dark' ? 'light' : 'dark';
      setTheme(nt); paintThemeBtn();
      if (window.mermaid) { try { mermaid.initialize({ startOnLoad: false, theme: nt === 'dark' ? 'dark' : 'neutral' }); } catch (e) { } }
    };
    const lo = document.getElementById('logout-btn');
    if (lo) lo.onclick = async () => { await api('/auth/logout', { method: 'POST' }); logoutLocal(); location.href = '/'; };
    connectWs();
  }

  // ---------- boot ----------
  function init() {
    setTheme(theme());
    renderNav();
  }
  document.addEventListener('DOMContentLoaded', init);

  const STATUS_TEXT = {
    ac: 'Accepted', wa: 'Wrong Answer', tle: 'Time Limit Exceeded', mle: 'Memory Limit Exceeded',
    re: 'Runtime Error', ce: 'Compile Error', se: 'Judge Error', pc: 'Partially Correct',
    pending: '排队中', judging: '评测中', compiling: '编译中'
  };
  function statusHtml(s) {
    const t = STATUS_TEXT[s] || s || '';
    return '<span class="status st-' + escapeHtml(s) + '">' + escapeHtml(t) + '</span>';
  }
  function diffName(d) {
    return ['入门', '简单', '中等', '较难', '困难', '专家'][Number(d) || 0] || String(d);
  }
  function diffColor(d) {
    return ['#22a05a', '#5b9bff', '#f0a020', '#e05a5a', '#b050d0', '#111111'][Number(d)] || '#888';
  }
  function diffBadge(d) {
    return '<span class="diff-badge" style="background:' + diffColor(d) + '22;color:' + diffColor(d) + '">' + diffName(d) + '</span>';
  }
  function timeAgo(ts) {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 60000) return Math.max(1, Math.floor(d / 1000)) + ' 秒前';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return new Date(ts).toLocaleDateString('zh-CN');
  }

  window.NoldOJ = {
    api, escapeHtml, renderMd, diffHtml, qs, fmtBytes, fmtMem,
    statusHtml, diffName, diffColor, diffBadge, timeAgo, theme, ROLE_NAME,
    logoutLocal, refreshNavRating, renderNav,
    user: () => currentUser,
    setUser: (u) => { currentUser = u; localStorage.setItem('noldoj-user', JSON.stringify(u)); },
    token: () => accessToken,
    setToken: (t) => { accessToken = t; localStorage.setItem('noldoj-token', t); },
    onSubUpdate: (fn) => subUpdaters.push(fn),
    onIdeUpdate: (fn) => ideUpdaters.push(fn),
    onLeaderboardUpdate: (fn) => { wsHandlers.push(fn); },
    onWsMessage: (fn) => wsHandlers.push(fn)
  };
})();
