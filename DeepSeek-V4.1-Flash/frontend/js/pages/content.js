(function () {
  'use strict';
  const N = window.NoldOJ;
  const U = N.ui;
  const esc = N.escapeHtml;

  /* ---------------- Articles ---------------- */
  async function articlesList(page, ctx) {
    const q = ctx.query;
    const params = new URLSearchParams();
    ['page', 'search', 'problem'].forEach((k) => { if (q.get(k)) params.set(k, q.get(k)); });
    if (!params.get('page')) params.set('page', '1');
    page.innerHTML = `<div class="page-head"><h1 class="page-title">文章 / 题解</h1>
        ${N.roleAtLeast('teacher') ? '<button class="btn" id="new-article">写文章</button>' : ''}</div>
      <div class="card"><form class="form-row" id="f">
        <input name="search" placeholder="搜索文章" value="${esc(q.get('search') || '')}" />
        <button class="btn" type="submit" style="flex:0 0 auto">搜索</button></form></div>
      <div id="list" style="margin-top:16px">${U.loading()}</div>`;
    page.querySelector('#f').onsubmit = (e) => {
      e.preventDefault();
      const np = new URLSearchParams(); const v = new FormData(e.target).get('search'); if (v) np.set('search', v);
      N.navigate(`/articles?${np.toString()}`);
    };
    if (page.querySelector('#new-article')) page.querySelector('#new-article').onclick = () => articleForm(null, () => articlesList(page, ctx));
    try {
      const data = await N.api(`/api/articles?${params.toString()}`);
      const host = page.querySelector('#list');
      host.innerHTML = U.table(['标题', '作者', '关联题目', '状态', '更新时间'], data.items.map((a) => [
        `<a href="#/article/${a.id}">${esc(a.title)}</a>`,
        `<a href="#/user/${esc(a.author_name)}">${esc(a.author_name)}</a>`,
        a.problem_id ? `<a href="#/problem/${a.problem_id}">#${a.problem_id}</a>` : '<span class="muted">-</span>',
        a.published ? '<span class="badge" style="background:var(--success);color:#fff">已发布</span>' : '<span class="badge" style="background:var(--bg-soft)">草稿</span>',
        `<span class="muted">${N.relativeTime(a.updated_at || a.created_at)}</span>`,
      ]), { empty: '暂无文章' });
      host.appendChild(U.pager({
        total: data.total, page: data.page, pageSize: data.pageSize,
        onGo: (p) => { const np = new URLSearchParams(params); np.set('page', p); N.navigate(`/articles?${np.toString()}`); },
      }));
    } catch (err) { page.querySelector('#list').innerHTML = U.errorBox(err.message); }
  }

  function articleForm(article, done) {
    const a = article || { title: '', content: '', problem_id: null, published: false };
    N.modal(article ? '编辑文章' : '写文章', `
      <label>标题</label><input id="a-title" value="${esc(a.title)}" />
      <label>关联题目 ID（可选）</label><input id="a-problem" type="number" value="${a.problem_id || ''}" />
      <div class="inline" style="margin-top:8px"><input type="checkbox" id="a-pub" ${a.published ? 'checked' : ''} /><label for="a-pub" style="margin:0">立即发布</label></div>
      <label>正文</label><div id="a-content"></div>
      <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" id="a-save">保存</button></div>`, {
      onMount(b, close) {
        const ed = U.markdownEditor(a.content || '', { rows: 14 });
        b.querySelector('#a-content').appendChild(ed);
        b.querySelector('#a-save').onclick = async () => {
          const payload = {
            title: b.querySelector('#a-title').value.trim(),
            content: ed.getValue(),
            problem_id: b.querySelector('#a-problem').value ? Number(b.querySelector('#a-problem').value) : null,
            published: b.querySelector('#a-pub').checked,
          };
          if (!payload.title) { N.toast('标题不能为空', 'error'); return; }
          try {
            if (article) await N.api(`/api/articles/${article.id}`, { method: 'PUT', body: payload });
            else await N.api('/api/articles', { method: 'POST', body: payload });
            N.toast('已保存', 'success'); close(); done && done();
          } catch (err) { N.toast(err.message, 'error'); }
        };
      },
    });
  }

  async function articleDetail(page, ctx) {
    page.innerHTML = U.loading();
    let a;
    try { a = await N.api(`/api/articles/${ctx.params.id}`); } catch (err) { page.innerHTML = U.errorBox(err.message); return; }
    const canEdit = N.roleAtLeast('teacher') && (N.state.user && (N.state.user.id === a.author_id || N.roleAtLeast('admin')));
    page.innerHTML = `
      <div class="page-head">
        <div><h1 class="page-title">${esc(a.title)}</h1>
          <div class="muted" style="font-size:13px">作者 ${esc(a.author_name)}
            ${a.problem_id ? `· 关联题目 <a href="#/problem/${a.problem_id}">#${a.problem_id}</a>` : ''}
            · ${N.formatDate(a.created_at)}</div></div>
        ${canEdit ? `<div class="row"><button class="btn ghost" id="edit">编辑</button><button class="btn danger" id="del">删除</button></div>` : ''}
      </div>
      <div class="card"><div class="markdown-body" id="content"></div></div>`;
    N.renderMarkdownInto(page.querySelector('#content'), a.content || '');
    if (canEdit) {
      page.querySelector('#edit').onclick = () => articleForm(a, () => articleDetail(page, ctx));
      page.querySelector('#del').onclick = async () => {
        if (!(await N.confirmDialog('确定删除这篇文章吗？'))) return;
        try { await N.api(`/api/articles/${a.id}`, { method: 'DELETE' }); N.toast('已删除', 'success'); N.navigate('/articles'); } catch (err) { N.toast(err.message, 'error'); }
      };
    }
  }

  /* ---------------- Announcements ---------------- */
  async function announcementsList(page, ctx) {
    page.innerHTML = `<div class="page-head"><h1 class="page-title">公告</h1>
        ${N.roleAtLeast('teacher') ? '<button class="btn" id="new-ann">发布公告</button>' : ''}</div>
      <div id="list">${U.loading()}</div>`;
    if (page.querySelector('#new-ann')) page.querySelector('#new-ann').onclick = () => announcementForm(null, () => announcementsList(page, ctx));
    try {
      const list = await N.api('/api/announcements');
      page.querySelector('#list').innerHTML = list.length ? list.map((a) => `
        <div class="card">
          <div class="row"><b>${a.pinned ? '📌 ' : ''}<a href="#/announcement/${a.id}">${esc(a.title)}</a></b>
            <span class="spacer"></span><span class="muted">${N.formatDate(a.created_at)}</span></div>
          <div class="markdown-body" data-a="${a.id}" style="max-height:120px;overflow:hidden"></div>
        </div>`).join('') : U.empty('暂无公告');
      list.forEach((a) => { const h = page.querySelector(`[data-a="${a.id}"]`); if (h) N.renderMarkdownInto(h, a.content || ''); });
    } catch (err) { page.querySelector('#list').innerHTML = U.errorBox(err.message); }
  }

  function announcementForm(ann, done) {
    const a = ann || { title: '', content: '', pinned: false, contest_id: null };
    N.modal(ann ? '编辑公告' : '发布公告', `
      <label>标题</label><input id="an-title" value="${esc(a.title)}" />
      <label>关联比赛 ID（可选）</label><input id="an-contest" type="number" value="${a.contest_id || ''}" />
      <div class="inline" style="margin-top:8px"><input type="checkbox" id="an-pin" ${a.pinned ? 'checked' : ''} /><label for="an-pin" style="margin:0">置顶</label></div>
      <label>内容</label><div id="an-content"></div>
      <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" id="an-save">保存</button></div>`, {
      onMount(b, close) {
        const ed = U.markdownEditor(a.content || '', { rows: 10 });
        b.querySelector('#an-content').appendChild(ed);
        b.querySelector('#an-save').onclick = async () => {
          const payload = {
            title: b.querySelector('#an-title').value.trim(),
            content: ed.getValue(),
            pinned: b.querySelector('#an-pin').checked,
            contest_id: b.querySelector('#an-contest').value ? Number(b.querySelector('#an-contest').value) : null,
          };
          if (!payload.title) { N.toast('标题不能为空', 'error'); return; }
          try {
            if (ann) await N.api(`/api/announcements/${ann.id}`, { method: 'PUT', body: payload });
            else await N.api('/api/announcements', { method: 'POST', body: payload });
            N.toast('已保存', 'success'); close(); done && done();
          } catch (err) { N.toast(err.message, 'error'); }
        };
      },
    });
  }

  async function announcementDetail(page, ctx) {
    page.innerHTML = U.loading();
    let a;
    try { a = await N.api(`/api/announcements/${ctx.params.id}`); } catch (err) { page.innerHTML = U.errorBox(err.message); return; }
    const canEdit = N.roleAtLeast('teacher') && (N.state.user && (N.state.user.id === a.author_id || N.roleAtLeast('admin')));
    page.innerHTML = `<div class="page-head"><h1 class="page-title">${a.pinned ? '📌 ' : ''}${esc(a.title)}</h1>
        ${canEdit ? `<button class="btn ghost" id="edit">编辑</button>` : ''}</div>
      <div class="card"><div class="markdown-body" id="c"></div></div>`;
    N.renderMarkdownInto(page.querySelector('#c'), a.content || '');
    if (canEdit) page.querySelector('#edit').onclick = () => announcementForm(a, () => announcementDetail(page, ctx));
  }

  /* ---------------- Problemsets ---------------- */
  async function problemsetsList(page, ctx) {
    const q = ctx.query;
    const params = new URLSearchParams();
    if (q.get('page')) params.set('page', q.get('page'));
    page.innerHTML = `<div class="page-head"><h1 class="page-title">题单</h1>
        ${N.roleAtLeast('teacher') ? '<button class="btn" id="new-ps">新建题单</button>' : ''}</div>
      <div id="list">${U.loading()}</div>`;
    if (page.querySelector('#new-ps')) page.querySelector('#new-ps').onclick = () => {
      N.modal('新建题单', `<label>标题</label><input id="ps-title" /><label>描述</label><textarea id="ps-desc"></textarea>
        <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="ps-save">创建</button></div>`, {
        onMount(b, close) {
          b.querySelector('#ps-save').onclick = async () => {
            try { const r = await N.api('/api/problemsets', { method: 'POST', body: { title: b.querySelector('#ps-title').value.trim(), description: b.querySelector('#ps-desc').value } }); close(); N.navigate(`/problemset/${r.id}`); } catch (err) { N.toast(err.message, 'error'); }
          };
        },
      });
    };
    try {
      const data = await N.api(`/api/problemsets?${params.toString()}`);
      const host = page.querySelector('#list');
      host.innerHTML = data.items.length ? `<div class="grid cols-2">${data.items.map((ps) => `
        <div class="card"><div class="row"><b><a href="#/problemset/${ps.id}">${esc(ps.title)}</a></b>
          <span class="spacer"></span><span class="muted">${ps.problem_count} 题</span></div>
          <p class="muted">${esc(ps.description || '')}</p>
          <div class="row">${(ps.problems || []).slice(0, 6).map((p) => `<a class="tag" href="#/problem/${p.problem_id}">${esc(p.title)}</a>`).join('')}</div>
        </div>`).join('')}</div>` : U.empty('暂无题单');
    } catch (err) { page.querySelector('#list').innerHTML = U.errorBox(err.message); }
  }

  async function problemsetDetail(page, ctx) {
    const id = ctx.params.id;
    page.innerHTML = U.loading();
    let ps;
    try { ps = await N.api(`/api/problemsets/${id}`); } catch (err) { page.innerHTML = U.errorBox(err.message); return; }
    const progress = (ps.progress || []).reduce((acc, p) => { acc[p.problem_id] = p.status; return acc; }, {});
    const canEdit = N.roleAtLeast('teacher');
    page.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">${esc(ps.title)}</h1>
          <p class="muted">${esc(ps.description || '')}</p></div>
        ${canEdit ? `<div class="row"><button class="btn ghost" id="add-prob">添加题目</button><button class="btn danger" id="del-ps">删除</button></div>` : ''}</div>
      <div id="ps-list"></div>`;
    page.querySelector('#ps-list').innerHTML = U.table(['#', '题目', '难度', '状态', '操作'], (ps.problems || []).map((p, i) => [
      i + 1, `<a href="#/problem/${p.problem_id}">${esc(p.title)}</a>`, N.difficultyBadge(p.difficulty),
      progress[p.problem_id] === 'done' ? '<span class="status accepted">已完成</span>' : '<span class="muted">未完成</span>',
      `<a class="btn small ghost" href="#/problem/${p.problem_id}">去做题</a>`,
    ]), { empty: '题单为空' });
    if (canEdit) {
      page.querySelector('#add-prob').onclick = () => {
        N.modal('添加题目', `<label>题目 ID（逗号分隔可批量）</label><input id="add-ids" />`,
          { onMount(b, close) { const btn = document.createElement('button'); btn.className = 'btn'; btn.textContent = '添加'; btn.style.marginTop = '12px';
            btn.onclick = async () => {
              const ids = b.querySelector('#add-ids').value.split(',').map((s) => Number(s.trim())).filter(Boolean);
              try { await N.api(`/api/problemsets/${id}/problems`, { method: 'POST', body: { problem_ids: ids } }); close(); problemsetDetail(page, ctx); } catch (err) { N.toast(err.message, 'error'); }
            }; b.appendChild(btn); } });
      };
      page.querySelector('#del-ps').onclick = async () => {
        if (!(await N.confirmDialog('确定删除该题单吗？'))) return;
        try { await N.api(`/api/problemsets/${id}`, { method: 'DELETE' }); N.toast('已删除', 'success'); N.navigate('/problemsets'); } catch (err) { N.toast(err.message, 'error'); }
      };
    }
  }

  N.pages = N.pages || {};
  N.pages.articles = articlesList;
  N.pages.articleDetail = articleDetail;
  N.pages.announcements = announcementsList;
  N.pages.announcementDetail = announcementDetail;
  N.pages.problemsets = problemsetsList;
  N.pages.problemsetDetail = problemsetDetail;
})();
