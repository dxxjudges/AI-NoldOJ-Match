(function () {
  'use strict';
  const N = window.NoldOJ;
  const U = N.ui;
  const esc = N.escapeHtml;

  const CSTATUS = { pending: '未开始', running: '进行中', ended: '已结束', unknown: '时间异常' };

  function contestStatusBadge(status) {
    const color = status === 'running' ? 'var(--success)' : status === 'pending' ? 'var(--info)' : 'var(--text-soft)';
    return `<span class="badge" style="background:${color};color:#fff">${esc(CSTATUS[status] || status)}</span>`;
  }

  async function contestsList(page, ctx) {
    const q = ctx.query;
    const params = new URLSearchParams();
    ['page', 'search'].forEach((k) => { if (q.get(k)) params.set(k, q.get(k)); });
    if (!params.get('page')) params.set('page', '1');

    page.innerHTML = `<div class="page-head"><h1 class="page-title">比赛</h1>
        ${N.roleAtLeast('teacher') ? '<button class="btn" id="new-contest">新建比赛</button>' : ''}</div>
      <div class="card"><form class="form-row" id="f">
        <input name="search" placeholder="搜索比赛" value="${esc(q.get('search') || '')}" />
        <button class="btn" type="submit" style="flex:0 0 auto">搜索</button></form></div>
      <div id="list" style="margin-top:16px">${U.loading()}</div>`;
    page.querySelector('#f').onsubmit = (e) => {
      e.preventDefault();
      const np = new URLSearchParams();
      const v = new FormData(e.target).get('search'); if (v) np.set('search', v);
      N.navigate(`/contests?${np.toString()}`);
    };
    if (page.querySelector('#new-contest')) page.querySelector('#new-contest').onclick = () => contestForm(null, () => contestsList(page, ctx));

    try {
      const data = await N.api(`/api/contests?${params.toString()}`);
      const host = page.querySelector('#list');
      host.innerHTML = U.table(['状态', '比赛', '开始时间', '结束时间', '题目数', '人数', '操作'], data.items.map((c) => [
        contestStatusBadge(c.status) + (c.frozen ? ' <span class="badge" style="background:var(--warning);color:#fff">封榜</span>' : ''),
        `<a href="#/contest/${c.id}"><b>${esc(c.title)}</b></a>`,
        `<span class="muted">${N.formatDate(c.start_at)}</span>`,
        `<span class="muted">${N.formatDate(c.end_at)}</span>`,
        c.problem_count, c.participant_count,
        `<a class="btn small ghost" href="#/contest/${c.id}">进入</a>`,
      ]), { empty: '暂无比赛' });
      host.appendChild(U.pager({
        total: data.total, page: data.page, pageSize: data.pageSize,
        onGo: (p) => { const np = new URLSearchParams(params); np.set('page', p); N.navigate(`/contests?${np.toString()}`); },
      }));
    } catch (err) { page.querySelector('#list').innerHTML = U.errorBox(err.message); }
  }

  function contestForm(contest, done) {
    const c = contest || { title: '', description: '', start_at: '', end_at: '', freeze_minutes: 0, is_public: true, allow_virtual: true };
    const toLocal = (v) => (v ? String(v).replace(' ', 'T').slice(0, 16) : '');
    N.modal(contest ? '编辑比赛' : '新建比赛', `
      <label>标题</label><input id="c-title" value="${esc(c.title)}" />
      <label>描述</label><textarea id="c-desc">${esc(c.description || '')}</textarea>
      <div class="form-row">
        <div><label>开始时间</label><input id="c-start" type="datetime-local" value="${toLocal(c.start_at)}" /></div>
        <div><label>结束时间</label><input id="c-end" type="datetime-local" value="${toLocal(c.end_at)}" /></div>
      </div>
      <div class="form-row">
        <div><label>封榜分钟数</label><input id="c-freeze" type="number" value="${c.freeze_minutes}" /></div>
        <div><label>公开</label><select id="c-public"><option value="1" ${c.is_public ? 'selected' : ''}>是</option><option value="0" ${!c.is_public ? 'selected' : ''}>否</option></select></div>
        <div><label>允许虚拟参赛</label><select id="c-virtual"><option value="1" ${c.allow_virtual ? 'selected' : ''}>是</option><option value="0" ${!c.allow_virtual ? 'selected' : ''}>否</option></select></div>
      </div>
      <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" id="save">保存</button></div>`, {
      onMount(b, close) {
        b.querySelector('#save').onclick = async () => {
          const fmt = (v) => v.replace('T', ' ') + ':00';
          const payload = {
            title: b.querySelector('#c-title').value.trim(),
            description: b.querySelector('#c-desc').value,
            start_at: fmt(b.querySelector('#c-start').value),
            end_at: fmt(b.querySelector('#c-end').value),
            freeze_minutes: Number(b.querySelector('#c-freeze').value) || 0,
            is_public: b.querySelector('#c-public').value === '1',
            allow_virtual: b.querySelector('#c-virtual').value === '1',
          };
          if (!payload.title || !payload.start_at || !payload.end_at) { N.toast('请填写标题与时间', 'error'); return; }
          try {
            if (contest) await N.api(`/api/contests/${contest.id}`, { method: 'PUT', body: payload });
            else await N.api('/api/contests', { method: 'POST', body: payload });
            N.toast('已保存', 'success'); close(); done && done();
          } catch (err) { N.toast(err.message, 'error'); }
        };
      },
    });
  }

  async function contestDetail(page, ctx) {
    const id = ctx.params.id;
    page.innerHTML = U.loading();
    let c;
    try { c = await N.api(`/api/contests/${id}`); } catch (err) { page.innerHTML = U.errorBox(err.message); return; }

    page.innerHTML = `
      <div class="page-head">
        <div><h1 class="page-title">${esc(c.title)} ${contestStatusBadge(c.status)}</h1>
          <div class="muted" style="font-size:13px">${N.formatDate(c.start_at)} ~ ${N.formatDate(c.end_at)}
            · 封榜 ${c.freeze_minutes} 分钟 · 参赛 ${c.participant_count} 人 ${c.frozen ? '· <b>已封榜</b>' : ''}</div></div>
        <div class="row">
          ${N.roleAtLeast('teacher') ? `<button class="btn ghost" id="edit-c">编辑</button><button class="btn ghost" id="add-problem">添加题目</button>` : ''}
          ${c.status === 'ended' && c.allow_virtual && N.state.user ? `<button class="btn" id="virtual-btn">${c.virtual ? '继续虚拟参赛' : '开始虚拟参赛'}</button>` : ''}
          ${N.roleAtLeast('admin') && c.frozen ? `<button class="btn ghost" id="unfreeze">解封</button>` : ''}
        </div>
      </div>
      <div class="tabs" id="ct-tabs">
        <button class="tab active" data-tab="overview">概览</button>
        <button class="tab" data-tab="leaderboard">排行榜</button>
        <button class="tab" data-tab="announcements">公告</button>
      </div>
      <div id="ct-body"></div>`;

    const body = page.querySelector('#ct-body');
    const tabs = page.querySelectorAll('#ct-tabs .tab');
    tabs.forEach((t) => { t.onclick = () => { tabs.forEach((x) => x.classList.remove('active')); t.classList.add('active'); renderTab(t.dataset.tab); }; });

    if (page.querySelector('#edit-c')) page.querySelector('#edit-c').onclick = () => contestForm(c, () => contestDetail(page, ctx));
    if (page.querySelector('#unfreeze')) page.querySelector('#unfreeze').onclick = async () => {
      try { await N.api(`/api/contests/${id}/unfreeze`, { method: 'POST' }); N.toast('已解封', 'success'); contestDetail(page, ctx); } catch (err) { N.toast(err.message, 'error'); }
    };
    if (page.querySelector('#virtual-btn')) page.querySelector('#virtual-btn').onclick = async () => {
      try {
        if (!c.virtual) { const v = await N.api(`/api/contests/${id}/virtual`, { method: 'POST' }); N.toast(`虚拟参赛开始：${N.formatDate(v.start_at)} ~ ${N.formatDate(v.end_at)}`, 'success'); }
        else { await N.api(`/api/virtual/${c.virtual.id}/start`, { method: 'POST' }); N.toast('虚拟参赛已开始', 'success'); }
        N.navigate(`/problem/${(c.problems[0] || {}).problem_id || ''}`);
      } catch (err) { N.toast(err.message, 'error'); }
    };
    if (page.querySelector('#add-problem')) page.querySelector('#add-problem').onclick = () => {
      N.modal('添加题目', `<label>题目 ID</label><input id="ap-id" type="number" /><label>别名（可选）</label><input id="ap-alias" />
        <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="ap-save">添加</button></div>`, {
        onMount(b, close) {
          b.querySelector('#ap-save').onclick = async () => {
            try { await N.api(`/api/contests/${id}/problems`, { method: 'POST', body: { problem_id: Number(b.querySelector('#ap-id').value), alias: b.querySelector('#ap-alias').value } }); close(); contestDetail(page, ctx); } catch (err) { N.toast(err.message, 'error'); }
          };
        },
      });
    };

    function renderTab(name) {
      if (name === 'overview') renderOverview();
      else if (name === 'leaderboard') renderLeaderboard();
      else renderAnnouncements();
    }

    function renderOverview() {
      body.innerHTML = `<div class="card"><div class="markdown-body" id="c-desc"></div></div>
        <div class="card" style="margin-top:16px"><h3 style="margin-top:0">赛题</h3><div id="c-problems"></div></div>`;
      N.renderMarkdownInto(body.querySelector('#c-desc'), c.description || '');
      body.querySelector('#c-problems').innerHTML = U.table(['别名', '题目', '难度', '操作'], (c.problems || []).map((p) => [
        `<b>${esc(p.alias || String.fromCharCode(65 + p.sort))}</b>`,
        `<a href="#/problem/${p.problem_id}">${esc(p.title)}</a>`,
        N.difficultyBadge(p.difficulty),
        `<a class="btn small ghost" href="#/problem/${p.problem_id}">去做题</a>`,
      ]), { empty: '暂无赛题' });
    }

    async function renderLeaderboard() {
      body.innerHTML = U.loading();
      try {
        const lb = await N.api(`/api/contests/${id}/leaderboard`);
        if (lb.hidden) { body.innerHTML = `<div class="card">排行榜已封榜，比赛结束后公布。</div>`; return; }
        const head = ['排名', '用户', '总分', '罚时', ...lb.problems.map((pid) => {
          const p = (c.problems || []).find((x) => x.problem_id === pid);
          return p ? esc(p.alias || String.fromCharCode(65 + p.sort)) : `#${pid}`;
        })];
        const rows = lb.entries.map((e) => {
          const medal = e.medal ? ` <span class="medal-${e.medal}">●</span>` : '';
          return [
            `<b>${e.rank}</b>${medal}`,
            `<a href="#/user/${esc(e.username)}">${esc(e.username)}</a> <span class="muted">${e.rating}</span>`,
            `<b>${e.total}</b>`, e.penalty,
            ...e.cells.map((cell) => cell.status === 'accepted'
              ? `<span class="status accepted">${cell.score}</span>`
              : cell.score > 0 ? `<span class="status wrong_answer">${cell.score}</span>` : '<span class="muted">-</span>'),
          ];
        });
        body.innerHTML = U.table(head, rows, { empty: '暂无参赛记录' });
      } catch (err) { body.innerHTML = U.errorBox(err.message); }
    }

    async function renderAnnouncements() {
      body.innerHTML = U.loading();
      try {
        const list = await N.api(`/api/announcements?contest=${id}`);
        body.innerHTML = list.length ? list.map((a) => `<div class="card"><b>${esc(a.title)}</b>
          <span class="muted" style="float:right">${N.formatDate(a.created_at)}</span>
          <div class="markdown-body" data-a="${a.id}"></div></div>`).join('') : U.empty('暂无公告');
        list.forEach((a) => { const host = body.querySelector(`[data-a="${a.id}"]`); if (host) N.renderMarkdownInto(host, a.content || ''); });
      } catch (err) { body.innerHTML = U.errorBox(err.message); }
    }

    renderTab('overview');
  }

  N.pages = N.pages || {};
  N.pages.contests = contestsList;
  N.pages.contestDetail = contestDetail;
})();
