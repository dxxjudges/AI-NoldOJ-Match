(function () {
  'use strict';
  const N = window.NoldOJ;
  const U = N.ui;
  const esc = N.escapeHtml;
  const STATUSES = ['queued', 'compiling', 'running', 'accepted', 'wrong_answer', 'time_limit', 'memory_limit', 'runtime_error', 'compile_error', 'system_error'];

  async function submissionsList(page, ctx) {
    const q = ctx.query;
    const params = new URLSearchParams();
    ['page', 'user', 'problem', 'status', 'contest'].forEach((k) => { if (q.get(k)) params.set(k, q.get(k)); });
    if (!params.get('page')) params.set('page', '1');

    page.innerHTML = `<div class="page-head"><h1 class="page-title">评测记录</h1></div>
      <div class="card">
        <form class="form-row" id="f">
          <input name="user" placeholder="用户 ID" value="${esc(q.get('user') || '')}" />
          <input name="problem" placeholder="题目 ID" value="${esc(q.get('problem') || '')}" />
          <select name="status"><option value="">全部状态</option>
            ${STATUSES.map((s) => `<option value="${s}" ${q.get('status') === s ? 'selected' : ''}>${esc(N.STATUS_TEXT[s] || s)}</option>`).join('')}</select>
          <input name="contest" placeholder="比赛 ID" value="${esc(q.get('contest') || '')}" />
          <button class="btn" type="submit" style="flex:0 0 auto">筛选</button>
        </form>
      </div>
      <div id="list" style="margin-top:16px">${U.loading()}</div>`;

    page.querySelector('#f').onsubmit = (e) => {
      e.preventDefault();
      const fd = new FormData(e.target); const np = new URLSearchParams();
      fd.forEach((v, k) => { if (v) np.set(k, v); });
      N.navigate(`/submissions?${np.toString()}`);
    };

    try {
      const data = await N.api(`/api/submissions?${params.toString()}`);
      const host = page.querySelector('#list');
      host.innerHTML = U.table(['#', '状态', '题目', '用户', '语言', '分数', '时间', '内存', '提交时间'], data.items.map((s) => [
        `<a href="#/submission/${s.id}">${s.id}</a>`,
        N.statusBadge(s.status),
        `<a href="#/problem/${s.problem_id}">${esc(s.problem_title)}</a>`,
        `<a href="#/user/${esc(s.username)}">${esc(s.username)}</a>`,
        esc(s.language_name), s.score,
        `${s.time_ms} ms`, `${(s.memory_kb / 1024).toFixed(1)} MB`,
        `<span class="muted">${N.relativeTime(s.created_at)}</span>`,
      ]), { empty: '暂无评测记录' });
      host.appendChild(U.pager({
        total: data.total, page: data.page, pageSize: data.pageSize,
        onGo: (p) => { const np = new URLSearchParams(params); np.set('page', p); N.navigate(`/submissions?${np.toString()}`); },
      }));

      N.ws.on('submission_status', (payload) => {
        if (!payload || !payload.id) return;
        const cell = host.querySelector(`a[href="#/submission/${payload.id}"]`);
        if (cell && payload.status) cell.closest('tr').querySelector('.status') && (cell.closest('tr').querySelector('.status').outerHTML = N.statusBadge(payload.status));
      });
    } catch (err) { page.querySelector('#list').innerHTML = U.errorBox(err.message); }
  }

  async function submissionDetail(page, ctx) {
    const id = ctx.params.id;
    page.innerHTML = U.loading();
    let s;
    try { s = await N.api(`/api/submissions/${id}`); } catch (err) { page.innerHTML = U.errorBox(err.message); return; }
    const cases = await N.api(`/api/submissions/${id}/cases`).catch(() => []);

    page.innerHTML = `
      <div class="page-head">
        <div>
          <h1 class="page-title">提交 #${s.id}</h1>
          <div class="row muted" style="font-size:13px">
            ${N.statusBadge(s.status)}
            <span>题目 <a href="#/problem/${s.problem_id}">${esc(s.problem_title)}</a></span>
            <span>用户 <a href="#/user/${esc(s.username)}">${esc(s.username)}</a></span>
            <span>语言 ${esc(s.language_name)}</span>
            <span>${s.score} 分</span>
            <span>${s.time_ms} ms / ${(s.memory_kb / 1024).toFixed(1)} MB</span>
            <span>${N.formatDate(s.created_at)}</span>
          </div>
        </div>
        <div class="row">
          ${N.roleAtLeast('teacher') ? `<button class="btn ghost" id="rejudge">重新评测</button>` : ''}
          ${N.roleAtLeast('admin') ? `<button class="btn danger" id="del">删除</button>` : ''}
          <button class="btn ghost" id="compare">对比代码</button>
        </div>
      </div>

      <div class="card"><h3 style="margin-top:0">测试点结果</h3><div id="cases"></div></div>
      <div class="card"><h3 style="margin-top:0">源代码</h3><pre>${esc(s.source_code || '(空)')}</pre>
        ${s.compile_output ? `<h4>编译输出</h4><pre>${esc(s.compile_output)}</pre>` : ''}</div>`;

    page.querySelector('#cases').innerHTML = cases.length ? U.table(['测试点', '状态', '分数', '时间', '内存', '信息'], cases.map((c) => [
      esc(c.label || `#${c.idx}`), N.statusBadge(c.status), c.score, `${c.time_ms} ms`, `${(c.memory_kb / 1024).toFixed(1)} MB`,
      `<span class="muted">${esc(c.message || '')}</span>`,
    ])) : U.empty('等待评测或为无测试点');

    if (page.querySelector('#rejudge')) page.querySelector('#rejudge').onclick = async () => {
      try { await N.api(`/api/submissions/${id}/rejudge`, { method: 'POST' }); N.toast('已重新加入评测队列', 'success'); submissionDetail(page, ctx); } catch (err) { N.toast(err.message, 'error'); }
    };
    if (page.querySelector('#del')) page.querySelector('#del').onclick = async () => {
      if (!(await N.confirmDialog(`确定删除提交 #${id} 吗？`))) return;
      try { await N.api(`/api/submissions/${id}`, { method: 'DELETE' }); N.toast('已删除', 'success'); N.navigate('/submissions'); } catch (err) { N.toast(err.message, 'error'); }
    };
    page.querySelector('#compare').onclick = () => {
      N.modal('对比代码', `<label>另一个提交 ID</label><input id="other-id" type="number" />
        <button class="btn" id="do-compare" style="margin-top:10px">对比</button><div id="diff-result" style="margin-top:12px"></div>`, {
        onMount(b) {
          b.querySelector('#do-compare').onclick = async () => {
            const other = b.querySelector('#other-id').value;
            try {
              const res = await N.api(`/api/submissions/${id}/diff/${other}`);
              b.querySelector('#diff-result').innerHTML = `<table class="diff-table">${res.rows.map((r) => {
                const cls = r.type === 'add' ? 'add' : r.type === 'del' ? 'del' : '';
                return `<tr><td class="no">${r.leftNo || ''}</td><td class="${cls}">${esc(r.left != null ? r.left : '')}</td>
                  <td class="no">${r.rightNo || ''}</td><td class="${cls}">${esc(r.right != null ? r.right : '')}</td></tr>`;
              }).join('')}</table>`;
            } catch (err) { N.toast(err.message, 'error'); }
          };
        },
      });
    };

    if (!['accepted', 'wrong_answer', 'time_limit', 'memory_limit', 'runtime_error', 'compile_error', 'system_error', 'banned'].includes(s.status)) {
      N.ws.on('submission_status', (payload) => {
        if (payload && payload.id === Number(id) && payload.status) submissionDetail(page, ctx);
      });
    }
  }

  N.pages = N.pages || {};
  N.pages.submissions = submissionsList;
  N.pages.submissionDetail = submissionDetail;
})();
