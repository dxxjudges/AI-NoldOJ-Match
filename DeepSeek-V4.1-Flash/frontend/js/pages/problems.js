(function () {
  'use strict';
  const N = window.NoldOJ;
  const U = N.ui;
  const esc = N.escapeHtml;
  const DIFF = N.DIFFICULTY;

  let langCache = null;
  async function getLanguages() {
    if (!langCache) langCache = await N.api('/api/languages');
    return langCache;
  }
  N.getLanguages = getLanguages;

  function langOptions(selected) {
    return (langCache || []).map((l) => `<option value="${l.id}" ${String(l.id) === String(selected) ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
  }

  /* ---------------- List ---------------- */
  async function problemsList(page, ctx) {
    const q = ctx.query;
    const params = new URLSearchParams();
    ['page', 'search', 'tag', 'difficulty', 'category'].forEach((k) => { if (q.get(k)) params.set(k, q.get(k)); });
    if (!params.get('page')) params.set('page', '1');

    page.innerHTML = `<div class="page-head"><h1 class="page-title">题目列表</h1>
        <div class="row">${N.roleAtLeast('teacher') ? '<a class="btn" href="#/problems/new">新建题目</a>' : ''}</div></div>
      <div class="card" id="filters"></div>
      <div id="list" style="margin-top:16px">${U.loading()}</div>`;

    const filterHost = page.querySelector('#filters');
    const tags = await N.api('/api/tags').catch(() => []);
    filterHost.innerHTML = `
      <form class="form-row" id="filter-form">
        <input name="search" placeholder="搜索标题或描述" value="${esc(q.get('search') || '')}" />
        <select name="tag"><option value="">全部标签</option>
          ${tags.map((t) => `<option value="${t.id}" ${String(q.get('tag')) === String(t.id) ? 'selected' : ''}>${esc(t.name)} (${t.problem_count})</option>`).join('')}
        </select>
        <select name="difficulty"><option value="">全部难度</option>
          ${DIFF.slice(1).map((d, i) => `<option value="${i + 1}" ${String(q.get('difficulty')) === String(i + 1) ? 'selected' : ''}>${esc(d)}</option>`).join('')}
        </select>
        <input name="category" placeholder="分类" value="${esc(q.get('category') || '')}" />
        <button class="btn" type="submit" style="flex:0 0 auto">筛选</button>
      </form>`;
    filterHost.querySelector('#filter-form').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const np = new URLSearchParams();
      fd.forEach((v, k) => { if (v) np.set(k, v); });
      N.navigate(`/problems?${np.toString()}`);
    };

    try {
      const data = await N.api(`/api/problems?${params.toString()}`);
      const host = page.querySelector('#list');
      host.innerHTML = U.table(['#', '题目', '难度', '标签', '操作'], data.items.map((p) => [
        `<span class="muted">${p.id}</span>`,
        `<a href="#/problem/${p.id}"><b>${esc(p.title)}</b></a>${p.visibility !== 'public' ? ' <span class="badge" style="background:var(--bg-soft)">私有</span>' : ''}`,
        N.difficultyBadge(p.difficulty),
        (p.tags || []).map((t) => `<span class="tag" style="border-color:${esc(t.color || '#888')}">${esc(t.name)}</span>`).join(''),
        `<a class="btn small ghost" href="#/problem/${p.id}">进入</a>`,
      ]), { empty: '没有符合条件的题目' });
      host.appendChild(U.pager({
        total: data.total, page: data.page, pageSize: data.pageSize,
        onGo: (p) => { const np = new URLSearchParams(params); np.set('page', p); N.navigate(`/problems?${np.toString()}`); },
      }));
    } catch (err) {
      page.querySelector('#list').innerHTML = U.errorBox(err.message);
    }
  }

  /* ---------------- Detail ---------------- */
  async function problemDetail(page, ctx) {
    const id = ctx.params.id;
    page.innerHTML = U.loading();
    await getLanguages();
    let problem;
    try {
      problem = await N.api(`/api/problems/${id}`);
    } catch (err) {
      page.innerHTML = U.errorBox(err.message);
      return;
    }

    const samples = (problem.samples || []).map((s) => ({
      input: s.input != null ? s.input : (s.in || ''),
      output: s.output != null ? s.output : (s.out || ''),
    }));

    page.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">#${problem.id} ${esc(problem.title)}</h1>
          <div class="row muted" style="font-size:13px">
            ${N.difficultyBadge(problem.difficulty)}
            ${(problem.tags || []).map((t) => `<span class="tag" style="border-color:${esc(t.color || '#888')}">${esc(t.name)}</span>`).join('')}
            <span>时间限制 ${problem.time_limit_ms} ms</span>
            <span>内存限制 ${(problem.memory_limit_kb / 1024).toFixed(0)} MB</span>
            ${problem.source ? `<span>来源：${esc(problem.source)}</span>` : ''}
          </div>
        </div>
        <div class="row">
          ${N.state.user ? `<button class="btn ghost" id="fav-btn">${problem.favorited ? '★ 已收藏' : '☆ 收藏'}</button>` : ''}
          ${N.roleAtLeast('teacher') || (N.state.user && N.state.user.id === problem.author_id) ? `<a class="btn ghost" href="#/problem/${problem.id}/edit">编辑</a>` : ''}
        </div>
      </div>

      <div class="tabs" id="pd-tabs">
        <button class="tab active" data-tab="statement">题目描述</button>
        <button class="tab" data-tab="submit">提交代码</button>
        <button class="tab" data-tab="submissions">提交记录</button>
        <button class="tab" data-tab="discussions">讨论</button>
        <button class="tab" data-tab="solutions">题解</button>
      </div>
      <div id="pd-body"></div>`;

    if (page.querySelector('#fav-btn')) {
      page.querySelector('#fav-btn').onclick = async (e) => {
        try {
          const res = await N.api(`/api/users/${N.state.user.id}/favorites/${problem.id}`, { method: 'POST' });
          N.toast(res.favorited ? '已收藏' : '已取消收藏', 'success');
          e.target.textContent = res.favorited ? '★ 已收藏' : '☆ 收藏';
        } catch (err) { N.toast(err.message, 'error'); }
      };
    }

    const body = page.querySelector('#pd-body');
    const tabs = page.querySelectorAll('#pd-tabs .tab');
    tabs.forEach((t) => { t.onclick = () => { tabs.forEach((x) => x.classList.remove('active')); t.classList.add('active'); renderTab(t.dataset.tab); }; });

    function renderTab(name) {
      if (name === 'statement') renderStatement();
      else if (name === 'submit') renderSubmit();
      else if (name === 'submissions') renderSubmissions();
      else if (name === 'discussions') renderDiscussions();
      else if (name === 'solutions') renderSolutions();
    }

    function renderStatement() {
      body.innerHTML = `<div class="markdown-body" id="stmt"></div>`;
      const host = body.querySelector('#stmt');
      host.innerHTML = `<h3>题目描述</h3><div id="desc"></div>
        <h3>输入格式</h3><div id="in-fmt"></div>
        <h3>输出格式</h3><div id="out-fmt"></div>
        <h3>样例</h3><div id="samples"></div>
        ${problem.hint ? '<h3>提示</h3><div id="hint"></div>' : ''}`;
      N.renderMarkdownInto(host.querySelector('#desc'), problem.description || '');
      N.renderMarkdownInto(host.querySelector('#in-fmt'), problem.input_format || '');
      N.renderMarkdownInto(host.querySelector('#out-fmt'), problem.output_format || '');
      if (problem.hint) N.renderMarkdownInto(host.querySelector('#hint'), problem.hint);
      host.querySelector('#samples').innerHTML = samples.length
        ? samples.map((s, i) => `<div class="sample"><div class="sample-head"><span>输入 #${i + 1}</span><span>输出 #${i + 1}</span></div>
            <div class="sample-body"><div><pre>${esc(s.input)}</pre></div><div><pre>${esc(s.output)}</pre></div></div></div>`).join('')
        : U.empty('无样例');
    }

    function renderSubmit() {
      if (!N.state.user) {
        body.innerHTML = `<div class="card">请先 <a href="#/login?redirect=${encodeURIComponent(`/problem/${id}`)}">登录</a> 后提交。</div>`;
        return;
      }
      const preferred = N.state.user.preferred_language;
      let selectedId = (langCache.find((l) => l.key === preferred) || langCache[0] || {}).id;
      body.innerHTML = `
        <div class="grid cols-2" style="align-items:start">
          <div class="card">
            <div class="row"><label style="margin:0">语言</label>
              <select id="lang-sel" style="width:auto">${langOptions(selectedId)}</select>
              <span class="spacer"></span>
              <label class="btn ghost small" style="margin:0">上传代码文件<input id="file-up" type="file" hidden /></label>
            </div>
            <div id="editor-host" style="margin-top:10px"></div>
            <div class="row" style="margin-top:12px">
              <button class="btn" id="submit-btn">提交评测</button>
              <button class="btn ghost" id="hint-btn">AI 提示</button>
              <span class="spacer"></span>
              <button class="btn ghost" id="ide-btn">在 IDE 中打开</button>
            </div>
          </div>
          <div class="card"><h3 style="margin-top:0">评测结果</h3><div id="result">${U.empty('尚未提交')}</div></div>
        </div>`;
      const editor = U.codeEditor('', { language: (langCache.find((l) => l.id === selectedId) || {}).name || 'text' });
      body.querySelector('#editor-host').appendChild(editor);
      body.querySelector('#lang-sel').onchange = (e) => {
        const l = langCache.find((x) => String(x.id) === e.target.value);
        editor.setLanguage(l ? l.name : 'text');
      };
      body.querySelector('#file-up').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => editor.setValue(String(reader.result));
        reader.readAsText(file);
      };
      body.querySelector('#ide-btn').onclick = () => {
        try { sessionStorage.setItem('noldoj-ide-code', JSON.stringify({ language_id: body.querySelector('#lang-sel').value, source_code: editor.getValue() })); } catch { /* noop */ }
        N.navigate('/ide');
      };
      body.querySelector('#hint-btn').onclick = async () => {
        try {
          const res = await N.api('/api/ai/hint', { method: 'POST', body: { problem_id: Number(id) } });
          if (res.skipped) { N.toast(res.hint || '提示暂不可用', 'info'); return; }
          N.modal('AI 提示', `<div id="hint-body"></div>`, { onMount(b) { N.renderMarkdownInto(b.querySelector('#hint-body'), res.hint || '(空)'); } });
        } catch (err) { N.toast(err.message, 'error'); }
      };
      body.querySelector('#submit-btn').onclick = async (e) => {
        const src = editor.getValue();
        if (!src.trim()) { N.toast('代码不能为空', 'error'); return; }
        e.target.disabled = true;
        try {
          const res = await N.api('/api/submissions', { method: 'POST', body: { problem_id: Number(id), language_id: Number(body.querySelector('#lang-sel').value), source_code: src } });
          N.toast('已提交，正在评测…', 'success');
          pollSubmission(res.id, body.querySelector('#result'));
        } catch (err) { N.toast(err.message, 'error'); }
        finally { e.target.disabled = false; }
      };
    }

    async function pollSubmission(sid, host) {
      let tries = 0;
      const terminal = new Set(['accepted', 'wrong_answer', 'time_limit', 'memory_limit', 'runtime_error', 'compile_error', 'system_error', 'banned']);
      const tick = async () => {
        tries += 1;
        try {
          const s = await N.api(`/api/submissions/${sid}`);
          const cases = terminal.has(s.status) ? await N.api(`/api/submissions/${sid}/cases`).catch(() => []) : [];
          host.innerHTML = `
            <div class="row"><b>#${s.id}</b> ${N.statusBadge(s.status)} <span class="spacer"></span>
              <span class="muted">${s.score} 分 · ${s.time_ms} ms · ${(s.memory_kb / 1024).toFixed(1)} MB</span></div>
            ${s.compile_output ? `<h4>编译输出</h4><pre>${esc(s.compile_output)}</pre>` : ''}
            ${cases.length ? U.table(['测试点', '状态', '分数', '时间', '内存'], cases.map((c) => [
              esc(c.label || `#${c.idx}`), N.statusBadge(c.status), c.score,
              `${c.time_ms} ms`, `${(c.memory_kb / 1024).toFixed(1)} MB`,
            ])) : ''}
            <div style="margin-top:10px"><a href="#/submission/${s.id}">查看详情 →</a></div>`;
          if (!terminal.has(s.status) && tries < 120) setTimeout(tick, 900);
        } catch (err) {
          host.innerHTML = U.errorBox(err.message);
        }
      };
      tick();
    }
    N.pollSubmission = pollSubmission;

    async function renderSubmissions() {
      body.innerHTML = U.loading();
      try {
        const data = await N.api(`/api/submissions?problem=${id}&pageSize=30`);
        body.innerHTML = U.table(['状态', '用户', '语言', '分数', '时间', '提交时间'], data.items.map((s) => [
          N.statusBadge(s.status),
          `<a href="#/user/${esc(s.username)}">${esc(s.username)}</a>`,
          esc(s.language_name), s.score, `${s.time_ms} ms`,
          `<a href="#/submission/${s.id}">${N.formatDate(s.created_at)}</a>`,
        ]), { empty: '暂无提交' });
      } catch (err) { body.innerHTML = U.errorBox(err.message); }
    }

    async function renderDiscussions() {
      body.innerHTML = U.loading();
      const canPost = !!N.state.user;
      try {
        const nodes = await N.api(`/api/problems/${id}/discussions`);
        body.innerHTML = `
          ${canPost ? `<div class="card"><textarea id="d-content" placeholder="发表讨论…"></textarea>
            <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn" id="d-post">发布</button></div></div>` : '<div class="card muted">登录后可参与讨论</div>'}
          <div id="d-list" style="margin-top:12px"></div>`;
        const list = body.querySelector('#d-list');
        const renderNode = (n, depth) => `
          <div class="card" style="margin-left:${depth * 20}px;padding:12px">
            <div class="row" style="font-size:13px">
              <b>${esc(n.author_name)}</b>
              <span class="muted">${esc(n.author_role || '')}</span>
              ${n.is_official ? '<span class="badge" style="background:var(--primary-soft)">官方</span>' : ''}
              ${n.pinned ? '📌' : ''}${n.locked ? '🔒' : ''}
              <span class="spacer"></span><span class="muted">${N.relativeTime(n.created_at)}</span>
            </div>
            <div class="md"></div>
            <div class="row" style="margin-top:6px">
              ${canPost && depth < 2 ? `<button class="btn ghost small" data-reply="${n.id}">回复</button>` : ''}
              ${N.roleAtLeast('teacher') ? `<button class="btn ghost small" data-pin="${n.id}">置顶</button><button class="btn ghost small" data-lock="${n.id}">锁定</button><button class="btn ghost small" data-official="${n.id}">官方</button>` : ''}
            </div>
            <div data-reply-box="${n.id}"></div>
            ${(n.replies || []).map((r) => renderNode(r, depth + 1)).join('')}
          </div>`;
        list.innerHTML = nodes.length ? nodes.map((n) => renderNode(n, 0)).join('') : U.empty('还没有讨论');
        const all = [];
        (function walk(arr) { arr.forEach((n) => { all.push(n); walk(n.replies || []); }); })(nodes);
        list.querySelectorAll('.card').forEach((card, i) => {
          if (all[i]) N.renderMarkdownInto(card.querySelector('.md'), all[i].content || '');
        });
        list.addEventListener('click', async (e) => {
          const btn = e.target.closest('button');
          if (!btn) return;
          if (btn.dataset.reply) {
            const box = list.querySelector(`[data-reply-box="${btn.dataset.reply}"]`);
            box.innerHTML = `<textarea placeholder="回复…"></textarea><div class="row" style="margin-top:6px"><span class="spacer"></span><button class="btn small">发送</button></div>`;
            box.querySelector('button').onclick = async () => {
              const content = box.querySelector('textarea').value.trim();
              if (!content) return;
              try { await N.api('/api/discussions', { method: 'POST', body: { problem_id: Number(id), parent_id: Number(btn.dataset.reply), content } }); N.toast('已回复', 'success'); renderDiscussions(); } catch (err) { N.toast(err.message, 'error'); }
            };
          } else if (btn.dataset.pin) {
            try { await N.api(`/api/discussions/${btn.dataset.pin}/pin`, { method: 'POST' }); renderDiscussions(); } catch (err) { N.toast(err.message, 'error'); }
          } else if (btn.dataset.lock) {
            try { await N.api(`/api/discussions/${btn.dataset.lock}/lock`, { method: 'POST' }); renderDiscussions(); } catch (err) { N.toast(err.message, 'error'); }
          } else if (btn.dataset.official) {
            try { await N.api(`/api/discussions/${btn.dataset.official}/official`, { method: 'POST' }); renderDiscussions(); } catch (err) { N.toast(err.message, 'error'); }
          }
        });
        if (canPost) {
          body.querySelector('#d-post').onclick = async () => {
            const content = body.querySelector('#d-content').value.trim();
            if (!content) { N.toast('内容不能为空', 'error'); return; }
            try { await N.api('/api/discussions', { method: 'POST', body: { problem_id: Number(id), content } }); N.toast('已发布', 'success'); renderDiscussions(); } catch (err) { N.toast(err.message, 'error'); }
          };
        }
      } catch (err) { body.innerHTML = U.errorBox(err.message); }
    }

    async function renderSolutions() {
      body.innerHTML = U.loading();
      try {
        const data = await N.api(`/api/articles?problem=${id}&pageSize=50`);
        body.innerHTML = U.table(['标题', '作者', '更新时间'], data.items.map((a) => [
          `<a href="#/article/${a.id}">${esc(a.title)}</a>`, esc(a.author_name), N.relativeTime(a.updated_at || a.created_at),
        ]), { empty: '暂无题解' });
      } catch (err) { body.innerHTML = U.errorBox(err.message); }
    }

    renderTab('statement');
  }

  /* ---------------- Editor ---------------- */
  async function problemEdit(page, ctx) {
    const id = ctx.params.id;
    page.innerHTML = U.loading();
    await getLanguages();
    const isNew = !id || id === 'new';
    let problem = {
      title: '', description: '', input_format: '', output_format: '', hint: '',
      samples: [], difficulty: 1, category: '', tags: [], visibility: 'public',
      time_limit_ms: 1000, memory_limit_kb: 262144, comparison_mode: 'strict', float_epsilon: 1e-6, scoring_script: '', source: '',
    };
    let testcases = [];
    if (!isNew) {
      try {
        problem = await N.api(`/api/problems/${id}`);
        testcases = await N.api(`/api/problems/${id}/testcases`).catch(() => []);
      } catch (err) { page.innerHTML = U.errorBox(err.message); return; }
    }
    const allTags = await N.api('/api/tags').catch(() => []);

    page.innerHTML = `
      <div class="page-head"><h1 class="page-title">${isNew ? '新建题目' : `编辑 #${id}`}</h1>
        <a class="btn ghost" href="${isNew ? '#/problems' : `#/problem/${id}`}">返回</a></div>
      <div class="tabs" id="pe-tabs">
        <button class="tab active" data-tab="basic">基本信息</button>
        ${isNew ? '' : '<button class="tab" data-tab="cases">测试数据</button><button class="tab" data-tab="groups">子任务</button>'}
      </div>
      <div id="pe-body"></div>`;

    const body = page.querySelector('#pe-body');
    const tabs = page.querySelectorAll('#pe-tabs .tab');
    tabs.forEach((t) => { t.onclick = () => { tabs.forEach((x) => x.classList.remove('active')); t.classList.add('active'); renderTab(t.dataset.tab); }; });

    function renderTab(name) {
      if (name === 'basic') renderBasic();
      else if (name === 'cases') renderCases();
      else renderGroups();
    }

    function renderBasic() {
      body.innerHTML = `
        <div class="card">
          <label>标题</label><input id="f-title" value="${esc(problem.title)}" />
          <label>题目描述（Markdown，支持 $公式$、mermaid、echarts、@[bilibili](BV号)、@[website](url) 等）</label>
          <div id="f-desc"></div>
          <div class="form-row"><div><label>输入格式</label><div id="f-in"></div></div><div><label>输出格式</label><div id="f-out"></div></div></div>
          <label>提示</label><div id="f-hint"></div>
          <div class="form-row">
            <div><label>难度</label><select id="f-diff">${DIFF.slice(1).map((d, i) => `<option value="${i + 1}" ${problem.difficulty == i + 1 ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></div>
            <div><label>分类</label><input id="f-cat" value="${esc(problem.category || '')}" /></div>
            <div><label>可见性</label><select id="f-vis">
              <option value="public" ${problem.visibility === 'public' ? 'selected' : ''}>公开</option>
              <option value="private" ${problem.visibility === 'private' ? 'selected' : ''}>私有</option></select></div>
          </div>
          <div class="form-row">
            <div><label>时间限制 (ms)</label><input id="f-tl" type="number" value="${problem.time_limit_ms}" /></div>
            <div><label>内存限制 (KB)</label><input id="f-ml" type="number" value="${problem.memory_limit_kb}" /></div>
            <div><label>比较模式</label><select id="f-cmp">
              ${['strict', 'loose', 'float', 'special'].map((m) => `<option value="${m}" ${problem.comparison_mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select></div>
            <div><label>浮点误差</label><input id="f-eps" type="number" step="any" value="${problem.float_epsilon}" /></div>
          </div>
          <label>来源</label><input id="f-src" value="${esc(problem.source || '')}" />
          <label>标签（逗号分隔，可填名称或 ID）</label>
          <input id="f-tags" value="${esc((problem.tags || []).map((t) => t.name).join(', '))}" list="tag-list" />
          <datalist id="tag-list">${allTags.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>
          <label>样例（每行一个 JSON，如 {"input":"1 2","output":"3"}）</label>
          <textarea id="f-samples">${esc(JSON.stringify(problem.samples || [], null, 0).replace(/^\[]$/, ''))}</textarea>
          <label>评分脚本（special / 自定义计分，可选）</label><textarea id="f-script">${esc(problem.scoring_script || '')}</textarea>
          <div class="row" style="margin-top:16px"><span class="spacer"></span>
            <button class="btn" id="save-btn">保存</button></div>
        </div>`;

      const descEd = U.markdownEditor(problem.description || ''); body.querySelector('#f-desc').appendChild(descEd);
      const inEd = U.markdownEditor(problem.input_format || '', { rows: 4 }); body.querySelector('#f-in').appendChild(inEd);
      const outEd = U.markdownEditor(problem.output_format || '', { rows: 4 }); body.querySelector('#f-out').appendChild(outEd);
      const hintEd = U.markdownEditor(problem.hint || '', { rows: 4 }); body.querySelector('#f-hint').appendChild(hintEd);

      body.querySelector('#save-btn').onclick = async (e) => {
        let samples = [];
        const rawSamples = body.querySelector('#f-samples').value.trim();
        if (rawSamples) {
          try {
            const parsed = JSON.parse(rawSamples.startsWith('[') ? rawSamples : `[${rawSamples}]`);
            samples = parsed;
          } catch { N.toast('样例 JSON 格式错误', 'error'); return; }
        }
        const payload = {
          title: body.querySelector('#f-title').value.trim(),
          description: descEd.getValue(),
          input_format: inEd.getValue(),
          output_format: outEd.getValue(),
          hint: hintEd.getValue(),
          difficulty: Number(body.querySelector('#f-diff').value),
          category: body.querySelector('#f-cat').value.trim(),
          visibility: body.querySelector('#f-vis').value,
          time_limit_ms: Number(body.querySelector('#f-tl').value),
          memory_limit_kb: Number(body.querySelector('#f-ml').value),
          comparison_mode: body.querySelector('#f-cmp').value,
          float_epsilon: Number(body.querySelector('#f-eps').value),
          source: body.querySelector('#f-src').value.trim(),
          scoring_script: body.querySelector('#f-script').value,
          samples,
          tags: body.querySelector('#f-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
        };
        if (!payload.title) { N.toast('标题不能为空', 'error'); return; }
        e.target.disabled = true;
        try {
          const saved = isNew
            ? await N.api('/api/problems', { method: 'POST', body: payload })
            : await N.api(`/api/problems/${id}`, { method: 'PUT', body: payload });
          N.toast('已保存', 'success');
          N.navigate(`/problem/${saved.id}`);
        } catch (err) { N.toast(err.message, 'error'); }
        finally { e.target.disabled = false; }
      };
    }

    async function renderCases() {
      body.innerHTML = U.loading();
      testcases = await N.api(`/api/problems/${id}/testcases`).catch(() => []);
      body.innerHTML = `
        <div class="card">
          <div class="row"><button class="btn" id="add-case">新增测试点</button>
            <button class="btn ghost" id="ai-gen">AI 生成数据</button></div>
          <label>批量导入（每行 JSON：{"input":"…","output":"…","score":10}）</label>
          <textarea id="batch"></textarea><button class="btn ghost" id="batch-btn" style="margin-top:6px">批量导入</button>
        </div>
        <div id="cases-list" style="margin-top:12px"></div>`;
      const list = body.querySelector('#cases-list');
      const renderList = () => {
        list.innerHTML = U.table(['#', '输入', '输出', '分值', '样例', '操作'], testcases.map((c) => [
          c.id,
          `<code>${esc(String(c.input || '').slice(0, 40))}</code>`,
          `<code>${esc(String(c.output || '').slice(0, 40))}</code>`,
          `<input type="number" value="${c.score}" data-score="${c.id}" style="width:70px" />`,
          `<input type="checkbox" ${c.is_sample ? 'checked' : ''} data-sample="${c.id}" />`,
          `<button class="btn ghost small" data-save="${c.id}">保存</button><button class="btn danger small" data-del="${c.id}">删除</button>`,
        ]), { empty: '暂无测试点' });
        list.onclick = async (e) => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.del) { await N.api(`/api/testcases/${b.dataset.del}`, { method: 'DELETE' }); renderCases(); }
          else if (b.dataset.save) {
            const sid = b.dataset.save;
            await N.api(`/api/testcases/${sid}`, { method: 'PUT', body: { score: Number(list.querySelector(`[data-score="${sid}"]`).value), is_sample: list.querySelector(`[data-sample="${sid}"]`).checked ? 1 : 0 } });
            N.toast('已更新', 'success');
          }
        };
      };
      renderList();
      body.querySelector('#add-case').onclick = async () => {
        const input = prompt('输入数据'); if (input === null) return;
        const output = prompt('输出数据'); if (output === null) return;
        const score = Number(prompt('分值', '10') || '0');
        await N.api(`/api/problems/${id}/testcases`, { method: 'POST', body: { input, output, score } });
        renderCases();
      };
      body.querySelector('#batch-btn').onclick = async () => {
        const raw = body.querySelector('#batch').value.trim();
        if (!raw) return;
        let cases;
        try { cases = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { N.toast('JSON 格式错误', 'error'); return; }
        await N.api(`/api/problems/${id}/testcases/batch`, { method: 'POST', body: { cases } });
        N.toast('已导入', 'success'); renderCases();
      };
      body.querySelector('#ai-gen').onclick = async () => {
        const normalCount = Number(prompt('普通测试点数量 (1-10)', '3') || '3');
        const edgeCount = Number(prompt('边界测试点数量 (0-10)', '1') || '1');
        try {
          const res = await N.api(`/api/problems/${id}/generate-testdata`, { method: 'POST', body: { normalCount, edgeCount } });
          N.toast(`已生成 ${res.generated} 个测试点`, 'success'); renderCases();
        } catch (err) { N.toast(err.message, 'error'); }
      };
    }

    async function renderGroups() {
      body.innerHTML = U.loading();
      const groups = await N.api(`/api/problems/${id}`).then((p) => p.groups || []).catch(() => []);
      body.innerHTML = `<div class="card"><button class="btn" id="add-group">新增子任务</button></div>
        <div id="g-list" style="margin-top:12px"></div>`;
      const list = body.querySelector('#g-list');
      list.innerHTML = U.table(['ID', '名称', '满分', '聚合', '依赖', '操作'], groups.map((g) => [
        g.id, esc(g.name || ''), g.full_score, esc(g.aggregation), esc(g.dependencies || '[]'),
        `<button class="btn danger small" data-del="${g.id}">删除</button>`,
      ]), { empty: '暂无子任务' });
      list.onclick = async (e) => {
        const b = e.target.closest('button'); if (!b || !b.dataset.del) return;
        await N.api(`/api/problem-groups/${b.dataset.del}`, { method: 'DELETE' });
        renderGroups();
      };
      body.querySelector('#add-group').onclick = async () => {
        const name = prompt('子任务名称', ''); if (name === null) return;
        const full_score = Number(prompt('满分', '100') || '100');
        await N.api(`/api/problems/${id}/groups`, { method: 'POST', body: { name, full_score } });
        renderGroups();
      };
    }

    renderTab('basic');
  }

  N.pages = N.pages || {};
  N.pages.problems = problemsList;
  N.pages.problemDetail = problemDetail;
  N.pages.problemEdit = problemEdit;
})();
