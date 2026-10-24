(function () {
  'use strict';

  const TOKEN_KEY = 'noldoj-token';
  const THEME_KEY = 'noldoj-theme';

  const state = {
    token: localStorage.getItem(TOKEN_KEY) || '',
    user: null,
    config: { captchaEnabled: true, allowRegistration: true, ai: {} },
  };

  function setToken(token) {
    state.token = token || '';
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  }

  async function rawFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (state.token) headers.authorization = `Bearer ${state.token}`;
    if (options.body && !(options.body instanceof FormData)) headers['content-type'] = 'application/json';
    const res = await fetch(path, {
      method: options.method || 'GET',
      headers,
      body: options.body instanceof FormData ? options.body : (options.body ? JSON.stringify(options.body) : undefined),
      credentials: 'same-origin',
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: res.status, json };
  }

  async function api(path, options = {}) {
    let { status, json } = await rawFetch(path, options);
    if (status === 401 && !options.noRetry && !path.startsWith('/api/auth/')) {
      const refreshed = await rawFetch('/api/auth/refresh', { method: 'POST' });
      if (refreshed.status === 200 && refreshed.json && refreshed.json.ok) {
        setToken(refreshed.json.data.accessToken);
        state.user = refreshed.json.data.user;
        ({ status, json } = await rawFetch(path, options));
      } else {
        setToken('');
        state.user = null;
      }
    }
    if (!json || json.ok === false) {
      const message = (json && (json.message || json.code)) || `请求失败 (${status})`;
      const err = new Error(message);
      err.status = status;
      err.payload = json;
      if (status === 401) { setToken(''); state.user = null; dispatchAuth(); }
      throw err;
    }
    return json.data;
  }

  function dispatchAuth() {
    window.dispatchEvent(new CustomEvent('noldoj:auth'));
  }

  async function loadConfig() {
    try {
      state.config = await api('/api/auth/config');
    } catch { /* keep defaults */ }
  }

  async function loadMe() {
    if (!state.token) { state.user = null; return null; }
    try {
      state.user = await api('/api/auth/me');
    } catch { state.user = null; setToken(''); }
    return state.user;
  }

  async function login(username, password, captchaId, captcha) {
    const data = await api('/api/auth/login', { method: 'POST', body: { username, password, captchaId, captcha } });
    setToken(data.accessToken);
    state.user = data.user;
    dispatchAuth();
    return data.user;
  }

  async function register(payload) {
    return api('/api/auth/register', { method: 'POST', body: payload });
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    setToken('');
    state.user = null;
    dispatchAuth();
  }

  function toast(message, type = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = `toast ${type}`;
    el.hidden = false;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => { el.hidden = true; }, 3600);
  }

  function modal(title, bodyHtml, { onMount } = {}) {
    const root = document.getElementById('modal-root');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `<div class="modal"><h3>${escapeHtml(title)}</h3><div class="modal-body"></div>
      <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn ghost" data-close>关闭</button></div></div>`;
    backdrop.querySelector('.modal-body').innerHTML = bodyHtml;
    function close() { backdrop.remove(); }
    backdrop.querySelector('[data-close]').onclick = close;
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
    root.appendChild(backdrop);
    if (onMount) onMount(backdrop, close);
    return close;
  }

  function confirmDialog(message) {
    return new Promise((resolve) => {
      modal('确认操作', `<p>${escapeHtml(message)}</p>`, {
        onMount(backdrop, close) {
          const btn = backdrop.querySelector('[data-close]');
          const okBtn = document.createElement('button');
          okBtn.className = 'btn danger';
          okBtn.textContent = '确定';
          okBtn.onclick = () => { close(); resolve(true); };
          btn.before(okBtn);
          backdrop._resolve = resolve;
        },
      });
    });
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    return tpl.content.firstElementChild;
  }

  function formatDate(value) {
    if (!value) return '-';
    const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('zh-CN', { hour12: false });
  }

  function relativeTime(value) {
    if (!value) return '-';
    const date = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
    const diff = Date.now() - date.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return '刚刚';
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    return formatDate(value);
  }

  const STATUS_TEXT = {
    pending: '等待中', queued: '排队中', reviewing: '审查中', compiling: '编译中', running: '运行中',
    accepted: '通过', wrong_answer: '答案错误', time_limit: '时间超限', memory_limit: '内存超限',
    runtime_error: '运行时错误', compile_error: '编译错误', system_error: '系统错误', banned: '已封禁',
    in_progress: '进行中', submitted: '待批改', graded: '已批改', done: '完成',
  };
  const DIFFICULTY = ['未定级', '入门', '普及-', '普及/提高-', '提高+/省选-', '省选/NOI-', 'NOI/省队'];
  const ROLE_TEXT = { user: '用户', teacher: '教师', admin: '管理员', su: '超级管理员' };

  function statusBadge(status) {
    return `<span class="status ${escapeHtml(status)}">${escapeHtml(STATUS_TEXT[status] || status)}</span>`;
  }
  function difficultyBadge(level) {
    const n = Math.max(1, Math.min(6, Number(level) || 1));
    return `<span class="badge diff-${n}">${escapeHtml(DIFFICULTY[n] || n)}</span>`;
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  }

  function toggleTheme() {
    setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  }

  function qs(name) {
    const hash = location.hash || '';
    const q = hash.split('?')[1] || '';
    return new URLSearchParams(q).get(name);
  }

  function pageQuery() {
    const hash = location.hash || '';
    return new URLSearchParams(hash.split('?')[1] || '');
  }

  function navigate(path) {
    location.hash = path.startsWith('#') ? path : `#${path}`;
  }

  function roleAtLeast(role) {
    const level = { user: 0, teacher: 1, admin: 2, su: 3 };
    return level[(state.user && state.user.role) || 'user'] >= level[role];
  }

  window.NoldOJ = {
    state, api, rawFetch, setToken, loadConfig, loadMe, login, register, logout, dispatchAuth,
    toast, modal, confirmDialog, escapeHtml, el, formatDate, relativeTime,
    STATUS_TEXT, DIFFICULTY, ROLE_TEXT, statusBadge, difficultyBadge,
    setTheme, toggleTheme, qs, pageQuery, navigate, roleAtLeast,
  };
})();
