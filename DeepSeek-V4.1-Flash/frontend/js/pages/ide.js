(function () {
  'use strict';
  const N = window.NoldOJ;
  const U = N.ui;
  const esc = N.escapeHtml;

  async function ide(page) {
    if (!N.state.user) {
      page.innerHTML = `<div class="card">请先 <a href="#/login?redirect=${encodeURIComponent('/ide')}">登录</a> 后使用在线编程。</div>`;
      return;
    }
    const langs = await N.getLanguages();
    let restored = {};
    try { restored = JSON.parse(sessionStorage.getItem('noldoj-ide-code') || '{}'); } catch { /* noop */ }
    const selected = restored.language_id || (langs[0] && langs[0].id);

    page.innerHTML = `
      <div class="page-head"><h1 class="page-title">在线编程 (IDE)</h1>
        <span class="muted">编写代码、运行调试，不计入评测记录</span></div>
      <div class="grid cols-2" style="align-items:start">
        <div class="card">
          <div class="row">
            <select id="lang-sel" style="width:auto">${langs.map((l) => `<option value="${l.id}" ${String(l.id) === String(selected) ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
            <input id="tl" type="number" value="3000" title="时间限制 ms" style="width:110px" />
            <span class="spacer"></span>
            <button class="btn" id="run-btn">运行</button>
          </div>
          <div id="editor-host" style="margin-top:10px"></div>
        </div>
        <div class="card">
          <label>标准输入 (stdin)</label>
          <textarea id="stdin" style="min-height:120px"></textarea>
          <div class="row" style="margin-top:12px"><h3 style="margin:0">输出</h3><span class="spacer"></span><span id="meta" class="muted"></span></div>
          <pre id="stdout" style="min-height:160px">—</pre>
          <h4>stderr</h4><pre id="stderr">—</pre>
        </div>
      </div>`;

    const editor = U.codeEditor(restored.source_code || '', { language: (langs.find((l) => String(l.id) === String(selected)) || {}).name || 'text', minHeight: 420 });
    page.querySelector('#editor-host').appendChild(editor);

    page.querySelector('#run-btn').onclick = async (e) => {
      const src = editor.getValue();
      if (!src.trim()) { N.toast('代码不能为空', 'error'); return; }
      e.target.disabled = true;
      const out = page.querySelector('#stdout');
      const err = page.querySelector('#stderr');
      const meta = page.querySelector('#meta');
      out.textContent = '运行中…'; err.textContent = '—'; meta.textContent = '';
      try {
        const res = await N.api('/api/ide/run', {
          method: 'POST',
          body: {
            language_id: Number(page.querySelector('#lang-sel').value),
            source_code: src,
            stdin: page.querySelector('#stdin').value,
            time_limit_ms: Number(page.querySelector('#tl').value) || 3000,
          },
        });
        poll(res.id, out, err, meta);
      } catch (err2) { N.toast(err2.message, 'error'); }
      finally { e.target.disabled = false; }
    };

    function poll(id, out, err, meta) {
      let tries = 0;
      const terminal = new Set(['done', 'compile_error', 'runtime_error', 'time_limit', 'memory_limit', 'system_error']);
      const tick = async () => {
        tries += 1;
        try {
          const r = await N.api(`/api/ide/run/${id}`);
          out.textContent = r.stdout || '';
          err.textContent = r.stderr || '';
          meta.textContent = `${r.status} · 退出码 ${r.exit_code} · ${r.time_ms} ms · ${(r.memory_kb / 1024).toFixed(1)} MB`;
          if (!terminal.has(r.status) && tries < 120) setTimeout(tick, 700);
        } catch (e) { out.textContent = e.message; }
      };
      tick();
    }

    window.addEventListener('beforeunload', () => {
      try { sessionStorage.setItem('noldoj-ide-code', JSON.stringify({ language_id: page.querySelector('#lang-sel').value, source_code: editor.getValue() })); } catch { /* noop */ }
    });
  }

  N.pages = N.pages || {};
  N.pages.ide = ide;
})();
