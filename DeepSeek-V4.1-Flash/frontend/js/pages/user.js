(function () {
  'use strict';
  const N = window.NoldOJ;
  const U = N.ui;
  const esc = N.escapeHtml;

  function rankTitle(rating) {
    if (rating >= 2600) return '大师';
    if (rating >= 2200) return '专家';
    if (rating >= 1800) return '高手';
    if (rating >= 1500) return '熟练';
    if (rating >= 1200) return '入门';
    return '新手';
  }

  async function userProfile(page, ctx) {
    const id = ctx.params.id;
    page.innerHTML = U.loading();
    let user;
    try { user = await N.api(`/api/users/${id}`); } catch (err) { page.innerHTML = U.errorBox(err.message); return; }
    const isSelf = N.state.user && N.state.user.id === user.id;

    page.innerHTML = `
      <div class="card">
        <div class="row" style="align-items:flex-start">
          <span class="avatar" style="width:64px;height:64px;font-size:26px">${esc(user.username.slice(0, 1).toUpperCase())}</span>
          <div style="flex:1">
            <h1 class="page-title" style="margin:0">${esc(user.username)}
              ${isSelf ? `<a class="btn ghost small" href="#/settings">编辑资料</a>` : ''}</h1>
            <div class="row muted" style="font-size:13px">
              <span class="badge" style="background:var(--primary-soft);color:var(--primary)">${esc(N.ROLE_TEXT[user.role] || user.role)}</span>
              <span>Rating <b>${user.rating}</b>（${rankTitle(user.rating)}）</span>
              <span>注册于 ${N.formatDate(user.created_at)}</span>
            </div>
            <p>${esc(user.signature || '这个人很懒，什么都没写。')}</p>
          </div>
          <div class="grid cols-3" style="flex:0 0 auto;gap:8px">
            <div class="stat"><div class="stat-value">${user.stats.solved}</div><div class="stat-label">已解决</div></div>
            <div class="stat"><div class="stat-value">${user.stats.accepted}</div><div class="stat-label">通过</div></div>
            <div class="stat"><div class="stat-value">${user.stats.submissions}</div><div class="stat-label">提交</div></div>
          </div>
        </div>
      </div>
      <div class="tabs" id="u-tabs" style="margin-top:16px">
        <button class="tab active" data-tab="about">简介</button>
        <button class="tab" data-tab="dashboard">数据</button>
        <button class="tab" data-tab="achievements">成就</button>
        <button class="tab" data-tab="favorites">收藏</button>
      </div>
      <div id="u-body"></div>`;

    const body = page.querySelector('#u-body');
    const tabs = page.querySelectorAll('#u-tabs .tab');
    tabs.forEach((t) => { t.onclick = () => { tabs.forEach((x) => x.classList.remove('active')); t.classList.add('active'); render(t.dataset.tab); }; });

    function render(name) {
      if (name === 'about') renderAbout();
      else if (name === 'dashboard') renderDashboard();
      else if (name === 'achievements') renderAchievements();
      else renderFavorites();
    }

    function renderAbout() {
      body.innerHTML = `<div class="card"><div class="markdown-body" id="bio"></div></div>`;
      N.renderMarkdownInto(body.querySelector('#bio'), user.bio || '_暂无简介_');
    }

    async function renderDashboard() {
      body.innerHTML = U.loading();
      try {
        const d = await N.api(`/api/users/${user.id}/dashboard`);
        body.innerHTML = `<div class="card"><h3 style="margin-top:0">刷题日历</h3><div id="cal" style="height:180px"></div></div>
          <div class="split" style="margin-top:16px">
            <div class="card"><h3 style="margin-top:0">语言分布</h3><div id="lang" style="height:280px"></div></div>
            <div class="card"><h3 style="margin-top:0">难度分布</h3><div id="diff" style="height:280px"></div></div>
          </div>`;
        drawCalendar(body.querySelector('#cal'), d.calendar || []);
        drawLang(body.querySelector('#lang'), d.languages || []);
        drawDiff(body.querySelector('#diff'), d.difficulty || []);
      } catch (err) { body.innerHTML = U.errorBox(err.message); }
    }

    async function renderAchievements() {
      body.innerHTML = U.loading();
      try {
        const a = await N.api(`/api/users/${user.id}/achievements`);
        body.innerHTML = `<div class="grid cols-3">${a.catalog.map((x) => `
          <div class="card" style="opacity:${x.unlocked ? 1 : 0.5};border-left:4px solid ${x.unlocked ? 'var(--success)' : 'var(--border)'}">
            <b>${x.unlocked ? '🏆 ' : '🔒 '}${esc(x.title)}</b>
            <p class="muted">${esc(x.description)}</p>
            ${x.unlocked_at ? `<span class="muted" style="font-size:12px">${N.formatDate(x.unlocked_at)}</span>` : ''}
          </div>`).join('')}</div>`;
      } catch (err) { body.innerHTML = U.errorBox(err.message); }
    }

    async function renderFavorites() {
      body.innerHTML = U.loading();
      try {
        const list = await N.api(`/api/users/${user.id}/favorites`);
        body.innerHTML = U.table(['题目', '难度', '收藏时间'], list.map((p) => [
          `<a href="#/problem/${p.id}">${esc(p.title)}</a>`, N.difficultyBadge(p.difficulty), N.relativeTime(p.created_at),
        ]), { empty: '暂无收藏' });
      } catch (err) { body.innerHTML = U.errorBox(err.message); }
    }

    render('about');
  }

  async function settingsPage(page) {
    if (!N.state.user) { N.navigate('/login?redirect=/settings'); return; }
    page.innerHTML = U.loading();
    const langs = await N.getLanguages();
    const u = await N.api('/api/auth/me');
    page.innerHTML = `
      <div class="page-head"><h1 class="page-title">个人设置</h1></div>
      <div class="card">
        <label>个性签名</label><input id="s-sig" value="${esc(u.signature || '')}" maxlength="200" />
        <label>个人简介（支持 Markdown）</label><div id="s-bio"></div>
        <label>首选语言</label><select id="s-lang">
          <option value="">未设置</option>
          ${langs.map((l) => `<option value="${l.key}" ${u.preferred_language === l.key ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select>
        <label>隐私设置</label>
        <div class="row">
          <label class="inline" style="margin:0"><input type="checkbox" id="p-ach" ${u.privacy.achievements ? 'checked' : ''} /> 公开成就</label>
          <label class="inline" style="margin:0"><input type="checkbox" id="p-dash" ${u.privacy.dashboard ? 'checked' : ''} /> 公开数据</label>
          <label class="inline" style="margin:0"><input type="checkbox" id="p-fav" ${u.privacy.favorites ? 'checked' : ''} /> 公开收藏</label>
        </div>
        <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" id="save">保存</button></div>
      </div>`;
    const bioEd = U.markdownEditor(u.bio || '', { rows: 8 });
    page.querySelector('#s-bio').appendChild(bioEd);
    page.querySelector('#save').onclick = async (e) => {
      e.target.disabled = true;
      try {
        await N.api(`/api/users/${N.state.user.id}`, { method: 'PUT', body: {
          signature: page.querySelector('#s-sig').value,
          bio: bioEd.getValue(),
          preferred_language: page.querySelector('#s-lang').value || null,
          privacy: {
            achievements: page.querySelector('#p-ach').checked,
            dashboard: page.querySelector('#p-dash').checked,
            favorites: page.querySelector('#p-fav').checked,
          },
        } });
        await N.loadMe();
        N.toast('已保存', 'success');
      } catch (err) { N.toast(err.message, 'error'); }
      finally { e.target.disabled = false; }
    };
  }

  function drawCalendar(host, data) {
    if (!host || typeof echarts === 'undefined') return;
    const chart = echarts.init(host);
    const max = data.reduce((m, d) => Math.max(m, d.n), 0) || 1;
    const year = new Date().getFullYear();
    chart.setOption({
      tooltip: { formatter: (p) => `${p.data[0]}：${p.data[1]} 次` },
      visualMap: { min: 0, max, orient: 'horizontal', left: 'center', bottom: 0, inRange: { color: ['#ebedf0', '#2563eb'] } },
      calendar: { range: String(year), cellSize: [12, 14], top: 20, left: 40, right: 20, itemStyle: { borderWidth: 2 } },
      series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: data.map((d) => [d.day, d.n]) }],
    });
    window.addEventListener('resize', () => chart.resize());
  }

  function drawLang(host, data) {
    if (!host || typeof echarts === 'undefined') return;
    const chart = echarts.init(host);
    chart.setOption({ tooltip: { trigger: 'item' }, series: [{ type: 'pie', radius: ['40%', '70%'], data: data.map((d) => ({ name: d.name, value: d.n })) }] });
    window.addEventListener('resize', () => chart.resize());
  }

  function drawDiff(host, data) {
    if (!host || typeof echarts === 'undefined') return;
    const chart = echarts.init(host);
    chart.setOption({
      tooltip: {}, xAxis: { type: 'category', data: data.map((d) => N.DIFFICULTY[d.difficulty] || d.difficulty) },
      yAxis: { type: 'value' }, grid: { bottom: 60 }, series: [{ type: 'bar', data: data.map((d) => d.n), itemStyle: { color: '#7c3aed' } }],
    });
    window.addEventListener('resize', () => chart.resize());
  }

  async function ratingPage(page) {
    page.innerHTML = `<div class="page-head"><h1 class="page-title">Rating 排行榜</h1></div><div id="list">${U.loading()}</div>`;
    try {
      const list = await N.api('/api/users/leaderboard?limit=100');
      page.querySelector('#list').innerHTML = U.table(['排名', '用户', '称号', 'Rating', '签名'], list.map((u) => [
        `<b class="${u.medal ? `medal-${u.medal}` : ''}">${u.rank === 1 ? '🥇' : u.rank === 2 ? '🥈' : u.rank === 3 ? '🥉' : u.rank}</b>`,
        `<a href="#/user/${u.username}">${esc(u.username)}</a>`,
        `<span class="badge" style="background:var(--bg-soft)">${esc(u.title)}</span>`,
        `<b>${u.rating}</b>`,
        `<span class="muted">${esc(u.signature || '')}</span>`,
      ]));
    } catch (err) { page.querySelector('#list').innerHTML = U.errorBox(err.message); }
  }

  async function filesPage(page, ctx) {
    if (!N.state.user) { N.navigate('/login?redirect=/files'); return; }
    const q = ctx.query;
    const params = new URLSearchParams(); if (q.get('page')) params.set('page', q.get('page'));
    if (N.roleAtLeast('admin') && q.get('all')) params.set('all', '1');
    page.innerHTML = `<div class="page-head"><h1 class="page-title">我的文件</h1>
        <label class="btn" style="margin:0">上传文件<input id="up" type="file" hidden /></label></div>
      <div id="quota" class="card"></div>
      <div id="list" style="margin-top:16px">${U.loading()}</div>`;
    page.querySelector('#up').onchange = async (e) => {
      const fd = new FormData(); fd.append('file', e.target.files[0]);
      try { const r = await N.api('/api/files', { method: 'POST', body: fd }); N.toast(`上传成功：${r.files[0].filename}`, 'success'); filesPage(page, ctx); } catch (err) { N.toast(err.message, 'error'); }
    };
    try {
      const data = await N.api(`/api/files?${params.toString()}`);
      const pct = data.quota_total ? Math.round((data.quota_used / data.quota_total) * 100) : 0;
      page.querySelector('#quota').innerHTML = `<b>存储配额</b> ${(data.quota_used / 1048576).toFixed(1)} / ${(data.quota_total / 1048576).toFixed(0)} MB (${pct}%)
        <div style="height:8px;background:var(--bg-soft);border-radius:4px;margin-top:8px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:var(--primary)"></div></div>`;
      const host = page.querySelector('#list');
      host.innerHTML = U.table(['文件名', '大小', '类型', '上传时间', '操作'], data.items.map((f) => [
        `<a href="${f.url}" target="_blank">${esc(f.filename)}</a>`,
        `${(f.size / 1024).toFixed(1)} KB`, esc(f.mime || '-'), N.relativeTime(f.created_at),
        `<button class="btn danger small" data-del="${f.id}">删除</button>`,
      ]), { empty: '暂无文件' });
      host.onclick = async (e) => {
        const b = e.target.closest('button'); if (!b || !b.dataset.del) return;
        if (!(await N.confirmDialog('确定删除该文件？'))) return;
        try { await N.api(`/api/files/${b.dataset.del}`, { method: 'DELETE' }); filesPage(page, ctx); } catch (err) { N.toast(err.message, 'error'); }
      };
      host.appendChild(U.pager({ total: data.total, page: data.page, pageSize: data.pageSize, onGo: (p) => { const np = new URLSearchParams(params); np.set('page', p); N.navigate(`/files?${np.toString()}`); } }));
    } catch (err) { page.querySelector('#list').innerHTML = U.errorBox(err.message); }
  }

  N.pages = N.pages || {};
  N.pages.userProfile = userProfile;
  N.pages.settings = settingsPage;
  N.pages.rating = ratingPage;
  N.pages.files = filesPage;
})();
