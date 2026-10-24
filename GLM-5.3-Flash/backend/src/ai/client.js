const config = require('../config');

async function chat(aiCfg, messages, opts = {}) {
  const url = aiCfg.baseUrl.replace(/\/+$/, '') + '/api/chat';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 60000);
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (aiCfg.apiKey) headers['Authorization'] = 'Bearer ' + aiCfg.apiKey;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: aiCfg.model || 'qwen3:1.7b',
        messages,
        stream: false,
        options: { temperature: opts.temperature != null ? opts.temperature : 0.4 }
      })
    });
    if (!res.ok) throw new Error(`AI service HTTP ${res.status}`);
    const data = await res.json();
    let content = (data.message && data.message.content) || '';
    // strip <think>...</think> for reasoning models
    content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    return content;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { chat };
