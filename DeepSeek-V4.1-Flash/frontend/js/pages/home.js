(function () {
  'use strict';
  const N = window.NoldOJ;
  const U = N.ui;
  const esc = N.escapeHtml;

  async function home(page) {
    page.innerHTML = U.loading();
    try {
      const [overview, recent, langs, wordcloud, announcements] = await Promise.all([
        N.api('/api/stats/overview'),
        N.api('/api/stats/recent'),
        N.api('/api/stats/languages'),
        N.api('/api/stats/wordcloud'),
        N.api('/api/announcements').catch(() => []),
      ]);

      page.innerHTML = `
        <div class="grid cols-4">
          <div class="stat"><div class="stat-value">${overview.problems}</div><div class="stat-label">题目总数</div></div>
          <div class="stat"><div class="stat-value">${overview.users}</div><div class="stat-label">注册用户</div></div>
          <div class="stat"><div class="stat-value">${overview.submissions}</div><div class="stat-label">评测提交</div></div>
          <div class="stat"><div class="stat-value">${overview.accepted}</div><div class="stat-label">通过提交</div></div>
          <div class="stat"><div class="stat-value">${overview.contests}</div><div class="stat-label">比赛</div></div>
          <div class="stat"><div class="stat-value">${overview.articles}</div><div class="stat-label">文章</div></div>
          <div class="stat"><div class="stat-value">${overview.todaySubmissions}</div><div class="stat-label">今日提交</div></div>
          <div class="stat"><div class="stat-value">${overview.accepted ? Math.round((overview.accepted / Math.max(1, overview.submissions)) * 100) : 0}%</div><div class="stat-label">通过率</div></div>
        </div>

        <div class="split" style="margin-top:16px">
          <div class="card">
            <h3 style="margin-top:0">最近评测</h3>
            <div id="recent-list"></div>
          </div>
          <div class="card">
            <h3 style="margin-top:0">语言分布</h3>
            <div id="lang-chart" style="height:280px"></div>
          </div>
        </div>

        <div class="split" style="margin-top:16px">
          <div class="card">
            <h3 style="margin-top:0">标签统计</h3>
            <div id="tag-chart" style="height:300px"></div>
          </div>
          <div class="card">
            <h3 style="margin-top:0">公告</h3>
            <div id="ann-list"></div>
          </div>
        </div>`;

      page.querySelector('#recent-list').innerHTML = U.table(
        ['状态', '题目', '用户', '时间'],
        recent.map((s) => [
          N.statusBadge(s.status),
          `<a href="#/problem/${s.problem_id}">${esc(s.problem_title)}</a>`,
          `<a href="#/user/${s.username}">${esc(s.username)}</a>`,
          `<span class="muted">${N.relativeTime(s.created_at)}</span>`,
        ]),
      );

      page.querySelector('#ann-list').innerHTML = announcements.length
        ? announcements.slice(0, 8).map((a) => `<div style="padding:6px 0;border-bottom:1px solid var(--border)">
            ${a.pinned ? '📌 ' : ''}<a href="#/announcement/${a.id}">${esc(a.title)}</a>
            <span class="muted" style="float:right">${N.relativeTime(a.created_at)}</span></div>`).join('')
        : U.empty('暂无公告');

      drawLangChart(page.querySelector('#lang-chart'), langs);
      drawTagChart(page.querySelector('#tag-chart'), wordcloud);
    } catch (err) {
      page.innerHTML = U.errorBox(err.message);
    }
  }

  function drawLangChart(host, langs) {
    if (!host || typeof echarts === 'undefined') return;
    const chart = echarts.init(host);
    chart.setOption({
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        data: (langs || []).map((l) => ({ name: l.name, value: l.value })),
        emphasis: { itemStyle: { shadowBlur: 10, shadowColor: 'rgba(0,0,0,0.3)' } },
      }],
    });
    window.addEventListener('resize', () => chart.resize());
  }

  function drawTagChart(host, wordcloud) {
    if (!host || typeof echarts === 'undefined') return;
    const tags = (wordcloud && wordcloud.tags) || [];
    const chart = echarts.init(host);
    chart.setOption({
      tooltip: {},
      xAxis: { type: 'category', data: tags.map((t) => t.name), axisLabel: { rotate: 30 } },
      yAxis: { type: 'value' },
      grid: { bottom: 70, left: 40, right: 16, top: 16 },
      series: [{ type: 'bar', data: tags.map((t) => t.value), itemStyle: { color: '#2563eb' } }],
    });
    window.addEventListener('resize', () => chart.resize());
  }

  N.pages = N.pages || {};
  N.pages.home = home;
})();
