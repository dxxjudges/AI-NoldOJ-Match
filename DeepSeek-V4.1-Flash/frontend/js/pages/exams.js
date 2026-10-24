(function () {
  'use strict';
  const N = window.NoldOJ;
  const U = N.ui;
  const esc = N.escapeHtml;

  const QTYPES = { choice: '单选题', judge: '判断题', fill_objective: '客观填空', fill_subjective: '主观填空', essay: '简答题' };

  async function examsList(page, ctx) {
    const q = ctx.query;
    const params = new URLSearchParams(); if (q.get('page')) params.set('page', q.get('page'));
    page.innerHTML = `<div class="page-head"><h1 class="page-title">在线考试</h1>
        ${N.roleAtLeast('teacher') ? '<button class="btn" id="new-exam">新建考试</button>' : ''}</div>
      <div id="list">${U.loading()}</div>`;
    if (page.querySelector('#new-exam')) page.querySelector('#new-exam').onclick = () => {
      N.modal('新建考试', `
        <label>标题</label><input id="e-title" />
        <label>说明</label><textarea id="e-desc"></textarea>
        <div class="form-row">
          <div><label>开始时间</label><input id="e-start" type="datetime-local" /></div>
          <div><label>结束时间</label><input id="e-end" type="datetime-local" /></div>
        </div>
        <div class="form-row">
          <div><label>限时（分钟，0 不限）</label><input id="e-limit" type="number" value="0" /></div>
          <div><label>及格分</label><input id="e-pass" type="number" value="60" /></div>
          <div><label>最大次数</label><input id="e-max" type="number" value="1" /></div>
        </div>
        <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" id="e-save">创建</button></div>`, {
        onMount(b, close) {
          b.querySelector('#e-save').onclick = async () => {
            const fmt = (v) => (v ? `${v.replace('T', ' ')}:00` : null);
            try {
              const r = await N.api('/api/exams', { method: 'POST', body: {
                title: b.querySelector('#e-title').value.trim(),
                description: b.querySelector('#e-desc').value,
                start_at: fmt(b.querySelector('#e-start').value),
                end_at: fmt(b.querySelector('#e-end').value),
                time_limit_minutes: Number(b.querySelector('#e-limit').value) || 0,
                pass_score: Number(b.querySelector('#e-pass').value) || 60,
                max_attempts: Number(b.querySelector('#e-max').value) || 1,
              } });
              close(); N.navigate(`/exam/${r.id}`);
            } catch (err) { N.toast(err.message, 'error'); }
          };
        },
      });
    };
    try {
      const data = await N.api(`/api/exams?${params.toString()}`);
      const host = page.querySelector('#list');
      host.innerHTML = U.table(['考试', '题目数', '总分', '及格分', '时间', '操作'], data.items.map((e) => [
        `<a href="#/exam/${e.id}"><b>${esc(e.title)}</b></a>`,
        e.question_count, e.total_score, e.pass_score,
        `<span class="muted">${N.formatDate(e.start_at)} ~ ${N.formatDate(e.end_at)}</span>`,
        `<a class="btn small ghost" href="#/exam/${e.id}">进入</a>`,
      ]), { empty: '暂无考试' });
      host.appendChild(U.pager({ total: data.total, page: data.page, pageSize: data.pageSize, onGo: (p) => { const np = new URLSearchParams(params); np.set('page', p); N.navigate(`/exams?${np.toString()}`); } }));
    } catch (err) { page.querySelector('#list').innerHTML = U.errorBox(err.message); }
  }

  async function examDetail(page, ctx) {
    const id = ctx.params.id;
    page.innerHTML = U.loading();
    let exam;
    try { exam = await N.api(`/api/exams/${id}`); } catch (err) { page.innerHTML = U.errorBox(err.message); return; }
    const isTeacher = N.roleAtLeast('teacher');

    page.innerHTML = `
      <div class="page-head"><div><h1 class="page-title">${esc(exam.title)}</h1>
          <div class="muted" style="font-size:13px">${exam.question_count} 题 · 总分 ${exam.total_score} · 及格 ${exam.pass_score} · 最多 ${exam.max_attempts} 次
            ${exam.time_limit_minutes ? `· 限时 ${exam.time_limit_minutes} 分钟` : ''}</div></div>
        <div class="row">
          ${N.state.user && !isTeacher ? '<button class="btn" id="start-exam">开始答题</button>' : ''}
          ${isTeacher ? '<button class="btn ghost" id="add-q">添加题目</button><button class="btn ghost" id="import-q">批量导入</button><button class="btn ghost" id="view-subs">答卷管理</button>' : ''}
        </div>
      </div>
      <div class="card"><div class="markdown-body" id="e-desc"></div></div>
      <div id="e-body" style="margin-top:16px"></div>`;
    N.renderMarkdownInto(page.querySelector('#e-desc'), exam.description || '');

    const body = page.querySelector('#e-body');
    const attempts = exam.attempts || [];

    if (N.state.user && !isTeacher && attempts.length) {
      body.innerHTML = `<div class="card"><h3 style="margin-top:0">我的作答记录</h3>
        ${U.table(['次数', '状态', '得分', '提交时间', '操作'], attempts.map((a) => [
          a.attempt_no, `<span class="status ${a.status}">${esc(N.STATUS_TEXT[a.status] || a.status)}</span>`,
          a.score != null ? a.score : '-', a.submitted_at ? N.formatDate(a.submitted_at) : '-',
          `<button class="btn small ghost" data-view="${a.id}">查看</button>`,
        ]))}</div>`;
      body.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => viewAttempt(b.dataset.view); });
    }

    if (page.querySelector('#start-exam')) page.querySelector('#start-exam').onclick = async () => {
      try { const sub = await N.api(`/api/exams/${id}/start`, { method: 'POST' }); N.toast('已开始答题', 'success'); renderAnswerForm(sub, exam); } catch (err) { N.toast(err.message, 'error'); }
    };
    if (page.querySelector('#add-q')) page.querySelector('#add-q').onclick = () => questionForm(exam, () => examDetail(page, ctx));
    if (page.querySelector('#import-q')) page.querySelector('#import-q').onclick = () => {
      N.modal('批量导入题目', `<p class="muted">JSON 数组，每项：{"type":"choice","content":"…","options":["A…","B…"],"answer":"A…","score":5,"analysis":""}</p>
        <textarea id="json" style="min-height:240px"></textarea>
        <div class="row" style="margin-top:12px"><span class="spacer"></span><button class="btn" id="imp">导入</button></div>`, {
        onMount(b, close) {
          b.querySelector('#imp').onclick = async () => {
            try {
              const questions = JSON.parse(b.querySelector('#json').value);
              const r = await N.api(`/api/exams/${id}/import`, { method: 'POST', body: { questions } });
              N.toast(`已导入 ${r.created.length} 题`, 'success'); close(); examDetail(page, ctx);
            } catch (err) { N.toast(err.message, 'error'); }
          };
        },
      });
    };
    if (page.querySelector('#view-subs')) page.querySelector('#view-subs').onclick = async () => {
      try {
        const subs = await N.api(`/api/exams/${id}/submissions`);
        N.modal('答卷管理', U.table(['用户', '次数', '状态', '得分', '操作'], subs.map((s) => [
          esc(s.username), s.attempt_no, esc(N.STATUS_TEXT[s.status] || s.status), s.score != null ? s.score : '-',
          `<button class="btn small" data-grade="${s.id}">批改</button>`,
        ]), { empty: '暂无答卷' }), {
          onMount(b) {
            b.addEventListener('click', (e) => {
              const btn = e.target.closest('[data-grade]');
              if (!btn) return;
              const sub = subs.find((x) => String(x.id) === btn.dataset.grade);
              gradeForm(sub, exam);
            });
          },
        });
      } catch (err) { N.toast(err.message, 'error'); }
    };

    if (isTeacher && exam.questions) renderQuestionPreview(exam.questions);

    function renderQuestionPreview(questions) {
      body.innerHTML = `<div class="card"><h3 style="margin-top:0">题目列表</h3>${questions.map((q, i) => `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div class="row"><b>${i + 1}. [${esc(QTYPES[q.type] || q.type)}]</b> <span class="muted">${q.score} 分</span>
            <span class="spacer"></span>
            ${isTeacher ? `<button class="btn ghost small" data-ed="${q.id}">编辑</button><button class="btn danger small" data-dq="${q.id}">删除</button>` : ''}</div>
          <div class="md" data-qc="${q.id}"></div>
          ${Array.isArray(q.options) && q.options.length ? `<ol type="A">${q.options.map((o) => `<li>${esc(o)}</li>`).join('')}</ol>` : ''}
          ${isTeacher && q.answer ? `<div class="muted">答案：${esc(q.answer)}</div>` : ''}
        </div>`).join('')}</div>`;
      questions.forEach((q) => { const h = body.querySelector(`[data-qc="${q.id}"]`); if (h) N.renderMarkdownInto(h, q.content || ''); });
      body.querySelectorAll('[data-dq]').forEach((b) => { b.onclick = async () => { if (!(await N.confirmDialog('删除该题目？'))) return; try { await N.api(`/api/exam-questions/${b.dataset.dq}`, { method: 'DELETE' }); examDetail(page, ctx); } catch (err) { N.toast(err.message, 'error'); } }; });
      body.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => questionForm(exam, () => examDetail(page, ctx), questions.find((q) => String(q.id) === b.dataset.ed)); });
    }

    function renderAnswerForm(sub, ex) {
      const qs = ex.questions || [];
      body.innerHTML = `<div class="card"><h3 style="margin-top:0">答题（第 ${sub.attempt_no} 次）</h3>
        <form id="answer-form">${qs.map((q, i) => `
          <div class="card" style="background:var(--bg-soft);margin-bottom:12px">
            <div class="row"><b>${i + 1}. [${esc(QTYPES[q.type] || q.type)}]</b><span class="muted">${q.score} 分</span></div>
            <div class="md" data-q="${q.id}"></div>
            <div data-input="${q.id}"></div>
          </div>`).join('')}
          <div class="row"><span class="spacer"></span><button class="btn" type="submit">交卷</button></div>
        </form></div>`;
      qs.forEach((q) => {
        N.renderMarkdownInto(body.querySelector(`[data-q="${q.id}"]`), q.content || '');
        const host = body.querySelector(`[data-input="${q.id}"]`);
        if (q.type === 'choice' || q.type === 'judge') {
          const opts = q.type === 'judge' ? ['正确', '错误'] : (q.options || []);
          host.innerHTML = opts.map((o, i) => `<label class="inline" style="margin:4px 0"><input type="radio" name="q${q.id}" value="${esc(o)}" /> ${String.fromCharCode(65 + i)}. ${esc(o)}</label>`).join('');
        } else if (q.type === 'fill_objective') {
          host.innerHTML = `<input name="q${q.id}" placeholder="填写答案" />`;
        } else {
          host.innerHTML = `<textarea name="q${q.id}" placeholder="作答…"></textarea>`;
        }
      });
      body.querySelector('#answer-form').onsubmit = async (e) => {
        e.preventDefault();
        const answers = {};
        qs.forEach((q) => {
          const fd = new FormData(e.target);
          if (q.type === 'choice' || q.type === 'judge' || q.type === 'fill_objective') answers[q.id] = fd.get(`q${q.id}`) || '';
          else answers[q.id] = e.target.querySelector(`[name="q${q.id}"]`).value;
        });
        try {
          const r = await N.api(`/api/exam-submissions/${sub.id}/submit`, { method: 'POST', body: { answers } });
          N.toast(`已交卷，得分 ${r.score}${r.needsManual ? '（部分题目待批改）' : ''}`, 'success');
          examDetail(page, ctx);
        } catch (err) { N.toast(err.message, 'error'); }
      };
    }

    async function viewAttempt(subId) {
      try {
        const sub = await N.api(`/api/exam-submissions/${subId}`);
        const answers = sub.answers || {};
        const qs = exam.questions || [];
        N.modal(`作答详情（${sub.score} 分）`, qs.map((q, i) => `
          <div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <b>${i + 1}. [${esc(QTYPES[q.type] || q.type)}]</b> ${q.score} 分
            <div class="md" data-vq="${q.id}"></div>
            <div>我的答案：<b>${esc(Array.isArray(answers[q.id]) ? answers[q.id].join('；') : (answers[q.id] || '（未作答）'))}</b></div>
            ${q.answer ? `<div class="muted">参考答案：${esc(q.answer)}</div>` : ''}
          </div>`).join(''), {
          onMount(b) { qs.forEach((q) => { const h = b.querySelector(`[data-vq="${q.id}"]`); if (h) N.renderMarkdownInto(h, q.content || ''); }); },
        });
      } catch (err) { N.toast(err.message, 'error'); }
    }

    function gradeForm(sub, ex) {
      const qs = ex.questions || [];
      const answers = sub.answers || {};
      N.modal(`批改：${sub.username}`, `
        ${qs.map((q) => `<div style="border-bottom:1px solid var(--border);padding:8px 0">
          <b>[${esc(QTYPES[q.type] || q.type)}]</b> 满分 ${q.score}
          <div class="md" data-gq="${q.id}"></div>
          <div>作答：<b>${esc(answers[q.id] || '（未作答）')}</b></div>
          <div class="inline" style="margin-top:6px"><input type="number" style="width:100px" placeholder="得分" data-score="${q.id}" />
            <span class="muted">/ ${q.score}</span></div>
        </div>`).join('')}
        <div class="row" style="margin-top:12px"><span class="spacer"></span>
          <label class="inline" style="margin:0"><input type="checkbox" id="use-ai" /> 使用 AI 辅助批改</label>
          <button class="btn" id="do-grade">提交批改</button></div>`, {
        onMount(b, close) {
          b.querySelectorAll('[data-gq]').forEach((h) => { const q = qs.find((x) => String(x.id) === h.dataset.gq); N.renderMarkdownInto(h, (q && q.content) || ''); });
          b.querySelector('#do-grade').onclick = async () => {
            const grades = {};
            b.querySelectorAll('[data-score]').forEach((inp) => { if (inp.value !== '') grades[inp.dataset.score] = Number(inp.value); });
            try {
              const r = await N.api(`/api/exam-submissions/${sub.id}/grade`, { method: 'POST', body: { grades, useAi: b.querySelector('#use-ai').checked } });
              N.toast(`批改完成，总分 ${r.score}`, 'success'); close();
            } catch (err) { N.toast(err.message, 'error'); }
          };
        },
      });
    }
  }

  function questionForm(exam, done, question) {
    const q = question || { type: 'choice', content: '', options: [], answer: '', score: 5, analysis: '' };
    N.modal(question ? '编辑题目' : '添加题目', `
      <label>题型</label><select id="q-type">${Object.entries(QTYPES).map(([k, v]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label>题干（Markdown / LaTeX）</label><textarea id="q-content" style="min-height:120px">${esc(q.content || '')}</textarea>
      <div id="q-options-wrap">
        <label>选项（每行一个，仅单选题使用）</label><textarea id="q-options">${esc((q.options || []).join('\n'))}</textarea>
      </div>
      <label>参考答案（单选/判断填选项文本，客观填空填标准答案）</label><input id="q-answer" value="${esc(q.answer || '')}" />
      <label>分值</label><input id="q-score" type="number" value="${q.score}" />
      <label>解析</label><textarea id="q-analysis">${esc(q.analysis || '')}</textarea>
      <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn" id="q-save">保存</button></div>`, {
      onMount(b, close) {
        const sync = () => { b.querySelector('#q-options-wrap').style.display = b.querySelector('#q-type').value === 'choice' ? '' : 'none'; };
        b.querySelector('#q-type').onchange = sync; sync();
        b.querySelector('#q-save').onclick = async () => {
          const payload = {
            type: b.querySelector('#q-type').value,
            content: b.querySelector('#q-content').value,
            options: b.querySelector('#q-options').value.split('\n').map((s) => s.trim()).filter(Boolean),
            answer: b.querySelector('#q-answer').value.trim(),
            score: Number(b.querySelector('#q-score').value) || 0,
            analysis: b.querySelector('#q-analysis').value,
          };
          try {
            if (question) await N.api(`/api/exam-questions/${question.id}`, { method: 'PUT', body: payload });
            else await N.api(`/api/exams/${exam.id}/questions`, { method: 'POST', body: { questions: [payload] } });
            N.toast('已保存', 'success'); close(); done && done();
          } catch (err) { N.toast(err.message, 'error'); }
        };
      },
    });
  }

  N.pages = N.pages || {};
  N.pages.exams = examsList;
  N.pages.examDetail = examDetail;
})();
