(function () {
  'use strict';

  const has = (name) => typeof window[name] !== 'undefined';

  const BILIBILI_RE = /@\[bilibili\]\(([A-Za-z0-9]+)(?:[,\s]+(\d+))?\)/g;
  const IFRAME_RE = /@\[(website|web)\]\(([^)]+)\)/g;
  const AUDIO_RE = /@\[audio\]\(([^)]+)\)/g;
  const VIDEO_RE = /@\[video\]\(([^)]+)\)/g;
  const OFFICE_RE = /@\[office\]\(([^)]+)\)/g;
  const SITE_RE = /@\[iframe\]\(([^)]+)\)/g;

  function embedDirectives(text) {
    let out = text;
    out = out.replace(BILIBILI_RE, (_, bvid, page) => {
      const p = page || '1';
      return `\n\n<iframe class="embed" src="//player.bilibili.com/player.html?bvid=${bvid}&page=${p}&high_quality=1" `
        + 'scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true" '
        + 'style="width:100%;height:420px"></iframe>\n\n';
    });
    out = out.replace(IFRAME_RE, (_, _t, url) => `\n\n<iframe class="embed" src="${url.trim()}" style="width:100%;height:480px" loading="lazy"></iframe>\n\n`);
    out = out.replace(SITE_RE, (_, url) => `\n\n<iframe class="embed" src="${url.trim()}" style="width:100%;height:480px" loading="lazy"></iframe>\n\n`);
    out = out.replace(OFFICE_RE, (_, url) => `\n\n<iframe class="embed" src="https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url.trim())}" style="width:100%;height:520px" loading="lazy"></iframe>\n\n`);
    out = out.replace(AUDIO_RE, (_, url) => `\n\n<audio controls src="${url.trim()}" style="width:100%"></audio>\n\n`);
    out = out.replace(VIDEO_RE, (_, url) => `\n\n<video controls src="${url.trim()}" style="width:100%"></video>\n\n`);
    return out;
  }

  const KATEX_DELIMITERS = [
    { left: '$$', right: '$$', display: true },
    { left: '\\[', right: '\\]', display: true },
    { left: '$', right: '$', display: false },
    { left: '\\(', right: '\\)', display: false },
  ];

  function protectMath(text) {
    const blocks = [];
    let out = text.replace(/\$\$([\s\S]+?)\$\$/g, (m) => {
      blocks.push(m);
      return `@@MATHBLOCK${blocks.length - 1}@@`;
    });
    return { out, blocks };
  }
  function restoreMath(html, blocks) {
    return html.replace(/@@MATHBLOCK(\d+)@@/g, (_, i) => blocks[Number(i)]);
  }

  function renderMarkdown(text) {
    const source = String(text == null ? '' : text);
    if (!has('marked')) return `<pre>${escapeHtml(source)}</pre>`;

    const { out, blocks } = protectMath(embedDirectives(source));
    let html;
    try {
      html = marked.parse(out, { breaks: true, gfm: true });
    } catch {
      html = `<pre>${escapeHtml(source)}</pre>`;
    }
    html = restoreMath(html, blocks);

    if (has('DOMPurify')) {
      html = DOMPurify.sanitize(html, {
        ADD_TAGS: ['iframe', 'audio', 'video', 'source', 'div', 'span'],
        ADD_ATTR: ['allowfullscreen', 'frameborder', 'scrolling', 'loading', 'controls', 'data-echarts', 'data-mermaid', 'target'],
      });
    }
    return html;
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function mount(container) {
    if (!container) return;

    // Mermaid
    container.querySelectorAll('pre > code.language-mermaid, div.language-mermaid').forEach((node) => {
      const code = node.textContent;
      const holder = document.createElement('div');
      holder.className = 'mermaid';
      holder.textContent = code;
      node.closest('pre') ? node.closest('pre').replaceWith(holder) : node.replaceWith(holder);
    });
    if (has('mermaid')) {
      try { mermaid.initialize({ startOnLoad: false, theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default' }); } catch { /* noop */ }
      const nodes = container.querySelectorAll('.mermaid:not([data-processed])');
      if (nodes.length) {
        try { mermaid.run({ nodes }); } catch { /* invalid diagram, keep raw text */ }
      }
    }

    // ECharts
    container.querySelectorAll('pre > code.language-echarts').forEach((node) => {
      const raw = node.textContent;
      const holder = document.createElement('div');
      holder.className = 'echarts-block';
      holder.style.width = '100%';
      holder.style.height = '360px';
      node.closest('pre').replaceWith(holder);
      if (!has('echarts')) return;
      try {
        const option = JSON.parse(raw);
        const chart = echarts.init(holder);
        chart.setOption(option);
        window.addEventListener('resize', () => chart.resize());
      } catch {
        holder.replaceWith(Object.assign(document.createElement('pre'), { textContent: raw }));
      }
    });

    // KaTeX
    if (has('renderMathInElement')) {
      try { renderMathInElement(container, { delimiters: KATEX_DELIMITERS, throwOnError: false }); } catch { /* noop */ }
    }
  }

  function render(container, text) {
    if (typeof container === 'string') container = document.querySelector(container);
    if (!container) return;
    container.classList.add('markdown-body');
    container.innerHTML = renderMarkdown(text);
    mount(container);
  }

  window.NoldOJ = window.NoldOJ || {};
  window.NoldOJ.renderMarkdown = renderMarkdown;
  window.NoldOJ.mountMarkdown = mount;
  window.NoldOJ.renderMarkdownInto = render;
})();
