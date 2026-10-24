(function () {
  'use strict';
  const N = window.NoldOJ;
  const U = N.ui;
  const esc = N.escapeHtml;

  async function adminPage(page) {
    if (!N.roleAtLeast('admin')) { page.innerHTML = U.errorBox('需要管理员权限'); return; }
    page.innerHTML = `<div class="page-head"><h1 class="page-title">管理后台</h1></div>
      <div class="tabs" id="ad-tabs">
        <button class="tab active" data-tab="users">用户</button>
        <button class="tab" data-tab="languages">语言</button>
        <button class="tab" data-tab="tags">标签</button>
        <button class="tab" data-tab="groups">用户组</button>
        <button class="tab" data-tab="plagiarism">抄袭检测</button>
        <button class="tab" data-tab="ai">AI 工具</button>
      </div>
      <div id="ad-body"></div>`;
    const body = page.querySelector('#ad-body');
    const tabs = page.querySelectorAll('#ad-tabs .tab');
    tabs.forEach((t) => { t.onclick = () => { tabs.forEach((x) => x.classList.remove('active')); t.classList.add('active'); render(t.dataset.tab); }; });
    function render(name) {
      if (name === 'users') renderUsers();
      else if (name === 'languages') renderLanguages();
      else if (name === 'tags') renderTags();
      else if (name === 'groups') renderGroups();
      else if (name === 'plagiarism') renderPlagiarism();
      else renderAi();
    }

    /* -------- users -------- */
    async function renderUsers() {
      body.innerHTML = `<div class="card"><div class="row">
          ${N.roleAtLeast('su') ? '<button class="btn" id="new-user">新建用户</button><button class="btn ghost" id="import-users">批量导入</button>' : ''}
          <span class="spacer"></span>
          <input id="u-search" placeholder="按用户名搜索" style="width:200px" />
          <select id="u-role" style="width:auto"><option value="">全部角色</option>
            ${Object.entries(N.ROLE_TEXT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        </div></div><div id="u-list" style="margin-top:16px">${U.loading()}</div>`;
      if (body.querySelector('#new-user')) body.querySelector('#new-user').onclick = () => {
        N.modal('新建用户', `<label>用户名</label><input id="nu-name" /><label>密码（留空自动生成）</label><input id="nu-pass" />
          <label>角色</label><select id="nu-role">${Object.entries(N.ROLE_TEXT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
          <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="nu-save">创建</button></div>`, {
          onMount(b, close) {
            b.querySelector('#nu-save').onclick = async () => {
              try {
                const r = await N.api('/api/users', { method: 'POST', body: { username: b.querySelector('#nu-name').value.trim(), password: b.querySelector('#nu-pass').value || undefined, role: b.querySelector('#nu-role').value } });
                N.modal('创建成功', `<p>用户名：<b>${esc(r.username)}</b></p><p>初始密码：<b>${esc(r.password)}</b></p><p class="muted">请妥善保存，密码仅显示一次。</p>`);
                close(); renderUsers();
              } catch (err) { N.toast(err.message, 'error'); }
            };
          },
        });
      };
      if (body.querySelector('#import-users')) body.querySelector('#import-users').onclick = () => {
        N.modal('批量导入用户', `<label>用户名（每行一个）</label><textarea id="imp-users" style="min-height:160px"></textarea>
          <label>统一初始密码（留空自动生成）</label><input id="imp-pass" />
          <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="imp-save">导入</button></div>`, {
          onMount(b, close) {
            b.querySelector('#imp-save').onclick = async () => {
              const users = b.querySelector('#imp-users').value.split('\n').map((s) => s.trim()).filter(Boolean);
              try {
                const r = await N.api('/api/users/import', { method: 'POST', body: { users, defaultPassword: b.querySelector('#imp-pass').value || undefined } });
                N.toast(`已创建 ${r.created.length} 个用户，初始密码：${r.defaultPassword}`, 'success'); close(); renderUsers();
              } catch (err) { N.toast(err.message, 'error'); }
            };
          },
        });
      };
      const load = async () => {
        const params = new URLSearchParams();
        const s = body.querySelector('#u-search').value; if (s) params.set('search', s);
        const r = body.querySelector('#u-role').value; if (r) params.set('role', r);
        params.set('pageSize', '50');
        const host = body.querySelector('#u-list');
        host.innerHTML = U.loading();
        try {
          const data = await N.api(`/api/users?${params.toString()}`);
          host.innerHTML = U.table(['ID', '用户名', '角色', 'Rating', '状态', '操作'], data.items.map((u) => [
            u.id, `<a href="#/user/${u.id}">${esc(u.username)}</a>`,
            N.roleAtLeast('su') ? `<select data-role="${u.id}" style="width:auto">${Object.entries(N.ROLE_TEXT).map(([k, v]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${v}</option>`).join('')}</select>` : esc(N.ROLE_TEXT[u.role] || u.role),
            u.rating, esc(u.created_at),
            `<div class="row">
              ${N.roleAtLeast('su') ? `<button class="btn ghost small" data-pass="${u.id}">改密码</button>` : ''}
              ${N.roleAtLeast('su') ? `<button class="btn ghost small" data-login="${u.id}">登录为</button>` : ''}
              <button class="btn ghost small" data-ban="${u.id}" data-banned="${u.banned ? 1 : 0}">${u.banned ? '解封' : '封禁'}</button>
            </div>`,
          ]), { empty: '没有用户' });
          host.onclick = async (e) => {
            const b = e.target.closest('button'); if (!b) return;
            if (b.dataset.pass) {
              const r = await N.api(`/api/users/${b.dataset.pass}/password`, { method: 'POST', body: {} });
              N.modal('密码已重置', `<p>新密码：<b>${esc(r.password)}</b></p>`);
            } else if (b.dataset.login) {
              const r = await N.api(`/api/users/${b.dataset.login}/login-as`, { method: 'POST' });
              N.setToken(r.accessToken); N.state.user = r.user; N.dispatchAuth(); N.toast(`已切换为 ${r.user.username}`, 'success'); N.navigate(`/user/${r.user.id}`);
            } else if (b.dataset.ban) {
              const banned = b.dataset.banned === '1';
              try { await N.api(`/api/users/${b.dataset.ban}/${banned ? 'unban' : 'ban'}`, { method: 'POST' }); N.toast('操作成功', 'success'); load(); } catch (err) { N.toast(err.message, 'error'); }
            }
          };
          host.onchange = async (e) => {
            const sel = e.target.closest('[data-role]'); if (!sel) return;
            try { await N.api(`/api/users/${sel.dataset.role}/role`, { method: 'POST', body: { role: sel.value } }); N.toast('已更新角色', 'success'); } catch (err) { N.toast(err.message, 'error'); }
          };
        } catch (err) { host.innerHTML = U.errorBox(err.message); }
      };
      body.querySelector('#u-search').oninput = U.debounce(load, 350);
      body.querySelector('#u-role').onchange = load;
      load();
    }

    /* -------- languages -------- */
    async function renderLanguages() {
      body.innerHTML = `<div class="card"><div class="row">
          ${N.roleAtLeast('su') ? '<button class="btn" id="new-lang">新增语言</button>' : ''}</div></div>
        <div id="l-list" style="margin-top:16px">${U.loading()}</div>`;
      if (body.querySelector('#new-lang')) body.querySelector('#new-lang').onclick = () => langForm(null, renderLanguages);
      try {
        const langs = await N.api('/api/languages');
        const host = body.querySelector('#l-list');
        host.innerHTML = U.table(['ID', '名称', 'KEY', '扩展名', '编译命令', '运行命令', '状态', '操作'], langs.map((l) => [
          l.id, esc(l.name), `<code>${esc(l.key)}</code>`, esc(l.ext), `<code>${esc(l.compile_cmd || '')}</code>`, `<code>${esc(l.run_cmd)}</code>`,
          l.enabled ? '<span class="status accepted">启用</span>' : '<span class="muted">停用</span>',
          `<button class="btn ghost small" data-ed="${l.id}">编辑</button>${l.is_builtin ? '' : `<button class="btn danger small" data-del="${l.id}">删除</button>`}`,
        ]));
        host.onclick = async (e) => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.del) { if (!(await N.confirmDialog('删除该语言？'))) return; try { await N.api(`/api/languages/${b.dataset.del}`, { method: 'DELETE' }); renderLanguages(); } catch (err) { N.toast(err.message, 'error'); } }
          else if (b.dataset.ed) langForm(langs.find((x) => String(x.id) === b.dataset.ed), renderLanguages);
        };
      } catch (err) { body.querySelector('#l-list').innerHTML = U.errorBox(err.message); }
    }

    function langForm(lang, done) {
      const l = lang || { name: '', key: '', ext: 'txt', compile_cmd: '', run_cmd: '', enabled: true, sort: 0 };
      N.modal(lang ? '编辑语言' : '新增语言', `
        <div class="form-row"><div><label>名称</label><input id="l-name" value="${esc(l.name)}" /></div>
          <div><label>KEY</label><input id="l-key" value="${esc(l.key)}" ${lang ? 'disabled' : ''} /></div>
          <div><label>扩展名</label><input id="l-ext" value="${esc(l.ext)}" /></div></div>
        <label>编译命令（{src} {exe}）</label><input id="l-cc" value="${esc(l.compile_cmd || '')}" />
        <label>运行命令（{exe} {src}）</label><input id="l-rc" value="${esc(l.run_cmd)}" />
        <div class="form-row"><div><label>排序</label><input id="l-sort" type="number" value="${l.sort}" /></div>
          <div><label>启用</label><select id="l-en"><option value="1" ${l.enabled ? 'selected' : ''}>是</option><option value="0" ${!l.enabled ? 'selected' : ''}>否</option></select></div></div>
        <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" id="l-save">保存</button></div>`, {
        onMount(b, close) {
          b.querySelector('#l-save').onclick = async () => {
            const payload = {
              name: b.querySelector('#l-name').value.trim(), key: b.querySelector('#l-key').value.trim(),
              ext: b.querySelector('#l-ext').value.trim(), compile_cmd: b.querySelector('#l-cc').value,
              run_cmd: b.querySelector('#l-rc').value.trim(), sort: Number(b.querySelector('#l-sort').value) || 0,
              enabled: b.querySelector('#l-en').value === '1',
            };
            try {
              if (lang) await N.api(`/api/languages/${lang.id}`, { method: 'PUT', body: payload });
              else await N.api('/api/languages', { method: 'POST', body: payload });
              N.toast('已保存', 'success'); close(); done && done();
            } catch (err) { N.toast(err.message, 'error'); }
          };
        },
      });
    }

    /* -------- tags -------- */
    async function renderTags() {
      body.innerHTML = `<div class="card"><button class="btn" id="new-tag">新增标签</button></div>
        <div id="t-list" style="margin-top:16px">${U.loading()}</div>`;
      body.querySelector('#new-tag').onclick = () => {
        N.modal('新增标签', `<label>名称</label><input id="t-name" /><label>颜色</label><input id="t-color" type="color" value="#6b7280" />
          <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="t-save">保存</button></div>`, {
          onMount(b, close) {
            b.querySelector('#t-save').onclick = async () => {
              try { await N.api('/api/tags', { method: 'POST', body: { name: b.querySelector('#t-name').value.trim(), color: b.querySelector('#t-color').value } }); close(); renderTags(); } catch (err) { N.toast(err.message, 'error'); }
            };
          },
        });
      };
      try {
        const tags = await N.api('/api/tags');
        const host = body.querySelector('#t-list');
        host.innerHTML = U.table(['ID', '名称', '颜色', '题目数', '操作'], tags.map((t) => [
          t.id, esc(t.name), `<span class="tag" style="border-color:${esc(t.color)}">${esc(t.name)}</span>`, t.problem_count,
          `<button class="btn ghost small" data-edit="${t.id}">编辑</button><button class="btn danger small" data-del="${t.id}">删除</button>`,
        ]));
        host.onclick = async (e) => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.del) { if (!(await N.confirmDialog('删除该标签？'))) return; try { await N.api(`/api/tags/${b.dataset.del}`, { method: 'DELETE' }); renderTags(); } catch (err) { N.toast(err.message, 'error'); } }
          else if (b.dataset.edit) {
            const t = tags.find((x) => String(x.id) === b.dataset.edit);
            N.modal('编辑标签', `<label>名称</label><input id="t2-name" value="${esc(t.name)}" /><label>颜色</label><input id="t2-color" type="color" value="${esc(t.color || '#6b7280')}" />
              <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="t2-save">保存</button></div>`, {
              onMount(bb, close) { bb.querySelector('#t2-save').onclick = async () => { try { await N.api(`/api/tags/${t.id}`, { method: 'PUT', body: { name: bb.querySelector('#t2-name').value.trim(), color: bb.querySelector('#t2-color').value } }); close(); renderTags(); } catch (err) { N.toast(err.message, 'error'); } }; },
            });
          }
        };
      } catch (err) { body.querySelector('#t-list').innerHTML = U.errorBox(err.message); }
    }

    /* -------- groups -------- */
    async function renderGroups() {
      body.innerHTML = `<div class="card"><div class="row"><button class="btn" id="new-group">新建用户组</button>
        <span class="muted">用户组用于控制题目/比赛/考试的可见范围</span></div></div>
        <div id="g-list" style="margin-top:16px">${U.loading()}</div>`;
      body.querySelector('#new-group').onclick = () => {
        N.modal('新建用户组', `<label>名称</label><input id="g-name" /><label>描述</label><input id="g-desc" />
          <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="g-save">创建</button></div>`, {
          onMount(b, close) { b.querySelector('#g-save').onclick = async () => { try { await N.api('/api/groups', { method: 'POST', body: { name: b.querySelector('#g-name').value.trim(), description: b.querySelector('#g-desc').value } }); close(); renderGroups(); } catch (err) { N.toast(err.message, 'error'); } }; },
        });
      };
      try {
        const groups = await N.api('/api/groups');
        const host = body.querySelector('#g-list');
        host.innerHTML = U.table(['ID', '名称', '描述', '成员数', '系统组', '操作'], groups.map((g) => [
          g.id, esc(g.name), esc(g.description || ''), g.member_count, g.is_system ? '是' : '否',
          `<button class="btn ghost small" data-members="${g.id}">成员</button>
           <button class="btn ghost small" data-vis="${g.id}">可见范围</button>
           ${g.is_system ? '' : `<button class="btn danger small" data-del="${g.id}">删除</button>`}`,
        ]));
        host.onclick = async (e) => {
          const b = e.target.closest('button'); if (!b) return;
          if (b.dataset.del) { if (!(await N.confirmDialog('删除该用户组？'))) return; try { await N.api(`/api/groups/${b.dataset.del}`, { method: 'DELETE' }); renderGroups(); } catch (err) { N.toast(err.message, 'error'); } }
          else if (b.dataset.members) groupMembers(b.dataset.members);
          else if (b.dataset.vis) groupVisibility(b.dataset.vis);
        };
      } catch (err) { body.querySelector('#g-list').innerHTML = U.errorBox(err.message); }
    }

    async function groupMembers(gid) {
      const rows = await N.api(`/api/groups/${gid}/members`);
      N.modal('组成员', `${U.table(['ID', '用户名', '角色', '操作'], rows.map((m) => [
        m.id, esc(m.username), esc(N.ROLE_TEXT[m.role] || m.role),
        `<button class="btn danger small" data-rm="${m.id}">移除</button>`,
      ]), { empty: '暂无成员' })}
        <label>添加用户（用户名或 ID，逗号分隔）</label><input id="add-members" />
        <button class="btn" id="do-add" style="margin-top:10px">添加</button>`, {
        onMount(b) {
          b.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-rm]'); if (!btn) return;
            try { await N.api(`/api/groups/${gid}/members/${btn.dataset.rm}`, { method: 'DELETE' }); N.toast('已移除', 'success'); } catch (err) { N.toast(err.message, 'error'); }
          });
          b.querySelector('#do-add').onclick = async () => {
            const tokens = b.querySelector('#add-members').value.split(',').map((s) => s.trim()).filter(Boolean);
            const ids = tokens.filter((t) => /^\d+$/.test(t)).map(Number);
            const names = tokens.filter((t) => !/^\d+$/.test(t));
            try {
              for (const name of names) {
                const u = await N.api(`/api/users/${encodeURIComponent(name)}`);
                ids.push(u.id);
              }
              if (!ids.length) { N.toast('请输入用户名或 ID', 'error'); return; }
              await N.api(`/api/groups/${gid}/members`, { method: 'POST', body: { user_ids: ids } });
              N.toast('已添加', 'success');
            } catch (err) { N.toast(err.message, 'error'); }
          };
        },
      });
    }

    async function groupVisibility(gid) {
      const rows = await N.api(`/api/groups/${gid}/visibility`);
      N.modal('可见范围', `${U.table(['类型', '实体 ID'], rows.map((r) => [esc(r.entity_type), r.entity_id]), { empty: '暂无可见资源' })}
        <div class="form-row" style="margin-top:12px">
          <div><label>类型</label><select id="v-type">${['problem', 'contest', 'exam', 'problemset', 'article'].map((t) => `<option value="${t}">${t}</option>`).join('')}</select></div>
          <div><label>实体 ID（逗号分隔）</label><input id="v-ids" /></div>
        </div><button class="btn" id="do-vis" style="margin-top:10px">授权</button>`, {
        onMount(b) {
          b.querySelector('#do-vis').onclick = async () => {
            const entity_ids = b.querySelector('#v-ids').value.split(',').map((s) => Number(s.trim())).filter(Boolean);
            try { await N.api(`/api/groups/${gid}/visibility`, { method: 'POST', body: { entity_type: b.querySelector('#v-type').value, entity_ids } }); N.toast('已授权', 'success'); } catch (err) { N.toast(err.message, 'error'); }
          };
        },
      });
    }

    /* -------- plagiarism -------- */
    async function renderPlagiarism() {
      body.innerHTML = `<div class="card"><div class="row">
          <span class="muted">对某题或某场比赛发起查重</span><span class="spacer"></span>
          <input id="pl-problem" placeholder="题目 ID" style="width:120px" /><button class="btn" id="pl-prob-btn">题目查重</button>
          <input id="pl-contest" placeholder="比赛 ID" style="width:120px" /><button class="btn ghost" id="pl-contest-btn">比赛查重</button>
        </div></div>
        <div id="pl-list" style="margin-top:16px">${U.loading()}</div>`;
      body.querySelector('#pl-prob-btn').onclick = async () => {
        try { await N.api(`/api/problems/${Number(body.querySelector('#pl-problem').value)}/plagiarism`, { method: 'POST' }); N.toast('查重任务已创建', 'success'); renderPlagiarism(); } catch (err) { N.toast(err.message, 'error'); }
      };
      body.querySelector('#pl-contest-btn').onclick = async () => {
        try { await N.api(`/api/contests/${Number(body.querySelector('#pl-contest').value)}/plagiarism`, { method: 'POST' }); N.toast('查重任务已创建', 'success'); renderPlagiarism(); } catch (err) { N.toast(err.message, 'error'); }
      };
      try {
        const reports = await N.api('/api/plagiarism');
        const host = body.querySelector('#pl-list');
        host.innerHTML = U.table(['ID', '题目', '比赛', '状态', '进度', '相似对', '创建时间', '操作'], reports.map((r) => [
          r.id, esc(r.problem_title || '-'), esc(r.contest_title || '-'),
          `<span class="status ${r.status}">${esc(r.status)}</span>`,
          r.total ? `${r.progress}/${r.total}` : (r.progress || 0),
          r.status === 'done' ? `<button class="btn small ghost" data-view="${r.id}">查看</button>` : '<span class="muted">-</span>',
          N.relativeTime(r.created_at), '',
        ]));
        host.onclick = async (e) => {
          const b = e.target.closest('button'); if (!b || !b.dataset.view) return;
          const det = await N.api(`/api/plagiarism/${b.dataset.view}`);
          N.modal(`查重报告 #${b.dataset.view}`, U.table(['A', 'B', '相似度', '等级', '操作'], det.pairs.map((p) => [
            esc(p.user_a_name || p.user_a), esc(p.user_b_name || p.user_b),
            `${(p.similarity * 100).toFixed(1)}%`,
            p.tier === 'high' ? '<span class="status wrong_answer">高度雷同</span>' : p.tier === 'suspect' ? '<span class="status time_limit">疑似</span>' : '<span class="muted">正常</span>',
            `<button class="btn small" data-pair="${p.id}">对比</button>`,
          ]), { empty: '未发现可疑相似' }), {
            onMount(bb) {
              bb.addEventListener('click', async (e2) => {
                const btn = e2.target.closest('[data-pair]'); if (!btn) return;
                const res = await N.api(`/api/plagiarism/pairs/${btn.dataset.pair}`);
                N.modal(`代码对比（相似度 ${(res.similarity * 100).toFixed(1)}%）`,
                  `<div class="split"><div><h4>提交 #${res.left.id}</h4><pre>${esc(res.left.source_code || res.left.code || '')}</pre></div>
                   <div><h4>提交 #${res.right.id}</h4><pre>${esc(res.right.source_code || res.right.code || '')}</pre></div></div>`);
              });
            },
          });
        };
      } catch (err) { body.querySelector('#pl-list').innerHTML = U.errorBox(err.message); }
    }

    /* -------- AI -------- */
    async function renderAi() {
      body.innerHTML = U.loading();
      try {
        const [status, td] = await Promise.all([N.api('/api/ai/status'), N.api('/api/ai/testdata-config').catch(() => ({ enabled: false, model: '-' }))]);
        body.innerHTML = `<div class="card"><h3 style="margin-top:0">AI 功能状态</h3>
          <div class="grid cols-3">
            <div class="stat"><div class="stat-value">${status.hint ? '✅' : '❌'}</div><div class="stat-label">AI 提示</div></div>
            <div class="stat"><div class="stat-value">${status.security ? '✅' : '❌'}</div><div class="stat-label">代码安全审查</div></div>
            <div class="stat"><div class="stat-value">${td.enabled ? '✅' : '❌'}</div><div class="stat-label">AI 生成测试数据</div></div>
          </div>
          <p class="muted">提示冷却：${status.hintCooldownSeconds} 秒 · 模型：${esc(status.securityModel || td.model || '未配置')}</p>
          <p class="muted">AI 配置请修改 <code>config/config.json</code> 的 <code>ai</code> 节后重启服务。</p>
        </div>
        <div class="card"><h3 style="margin-top:0">代码安全审查</h3>
          <textarea id="ai-code" placeholder="粘贴待审查的代码…"></textarea>
          <div class="row" style="margin-top:8px"><span class="spacer"></span><button class="btn" id="ai-review">审查</button></div>
          <div id="ai-result" style="margin-top:12px"></div></div>`;
        body.querySelector('#ai-review').onclick = async () => {
          try {
            const r = await N.api('/api/ai/review', { method: 'POST', body: { code: body.querySelector('#ai-code').value } });
            body.querySelector('#ai-result').innerHTML = r.skipped
              ? `<div class="muted">AI 未启用或跳过。</div>`
              : `<div class="card" style="border-left:4px solid ${r.malicious ? 'var(--danger)' : 'var(--success)'}">
                  <b>${r.malicious ? '⚠️ 检测到可疑代码' : '✅ 未发现明显问题'}</b>
                  <p>${esc(r.reason || '')}</p>
                  ${r.injections && r.injections.length ? `<p class="muted">命中注入模式：${r.injections.map(esc).join(', ')}</p>` : ''}</div>`;
          } catch (err) { N.toast(err.message, 'error'); }
        };
      } catch (err) { body.innerHTML = U.errorBox(err.message); }
    }

    render('users');
  }

  N.pages = N.pages || {};
  N.pages.admin = adminPage;
})();
