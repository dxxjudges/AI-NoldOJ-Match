(function () {
  'use strict';

  const esc = (t) => window.NoldOJ.escapeHtml(t);

  function loading(text = '加载中…') {
    return `<div class="loading"><span class="spinner"></span> ${esc(text)}</div>`;
  }

  function empty(text = '暂无数据') {
    return `<div class="empty">${esc(text)}</div>`;
  }

  function errorBox(message) {
    return `<div class="card" style="border-left:4px solid var(--danger)"><b>出错了：</b> ${esc(message)}</div>`;
  }

  function table(headers, rows, { empty: emptyText = '暂无数据' } = {}) {
    if (!rows || !rows.length) return empty(emptyText);
    const head = headers.map((h) => `<th>${h}</th>`).join('');
    const body = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
    return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function pager({ total, page, pageSize, onGo }) {
    const pages = Math.max(1, Math.ceil((total || 0) / (pageSize || 20)));
    const wrap = document.createElement('div');
    wrap.className = 'pager';
    const mk = (label, target, disabled) => {
      const b = document.createElement('button');
      b.className = 'btn ghost small';
      b.textContent = label;
      b.disabled = !!disabled;
      b.onclick = () => onGo(target);
      return b;
    };
    wrap.appendChild(mk('上一页', page - 1, page <= 1));
    const info = document.createElement('span');
    info.className = 'muted';
    info.textContent = `第 ${page} / ${pages} 页 · 共 ${total || 0} 条`;
    wrap.appendChild(info);
    wrap.appendChild(mk('下一页', page + 1, page >= pages));
    return wrap;
  }

  function codeEditor(value, { language = 'text', minHeight = 330 } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<textarea class="editor" spellcheck="false"></textarea>
      <div class="row" style="margin-top:6px"><span class="muted" data-lang>${esc(language)}</span>
      <span class="spacer"></span><span class="muted" data-lines>0 行</span></div>`;
    const ta = wrap.querySelector('textarea');
    ta.style.minHeight = `${minHeight}px`;
    ta.value = value || '';
    const lines = wrap.querySelector('[data-lines]');
    const updateLines = () => { lines.textContent = `${ta.value.split('\n').length} 行`; };
    updateLines();
    ta.addEventListener('input', updateLines);
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = ta.selectionStart, end = ta.selectionEnd;
        ta.value = `${ta.value.slice(0, start)}    ${ta.value.slice(end)}`;
        ta.selectionStart = ta.selectionEnd = start + 4;
      }
    });
    wrap.getValue = () => ta.value;
    wrap.setValue = (v) => { ta.value = v; updateLines(); };
    wrap.setLanguage = (l) => { wrap.querySelector('[data-lang]').textContent = l; };
    wrap.textarea = ta;
    return wrap;
  }

  function markdownEditor(value, { rows = 12 } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<div class="tabs"><button class="tab active" data-tab="write">编辑</button>
      <button class="tab" data-tab="preview">预览</button></div>
      <textarea spellcheck="false"></textarea><div class="markdown-body" hidden></div>`;
    const ta = wrap.querySelector('textarea');
    ta.style.minHeight = `${rows * 22}px`;
    ta.value = value || '';
    const preview = wrap.querySelector('.markdown-body');
    wrap.querySelectorAll('.tab').forEach((tab) => {
      tab.onclick = () => {
        wrap.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        const isPreview = tab.dataset.tab === 'preview';
        ta.hidden = isPreview;
        preview.hidden = !isPreview;
        if (isPreview) window.NoldOJ.renderMarkdownInto(preview, ta.value);
      };
    });
    wrap.getValue = () => ta.value;
    return wrap;
  }

  function dataTablePersist(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* noop */ }
  }

  function debounce(fn, wait = 300) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  window.NoldOJ = window.NoldOJ || {};
  window.NoldOJ.ui = { loading, empty, errorBox, table, pager, codeEditor, markdownEditor, dataTablePersist, debounce };
})();
