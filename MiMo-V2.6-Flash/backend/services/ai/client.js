'use strict';

const { config } = require('../../config');

/** Minimal Ollama/OpenAI-compatible chat client. */
async function chat(messages, opts = {}) {
  const base = config.ai.baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || config.ai.timeoutMs);
  try {
    // Ollama native API
    const res = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.ai.apiKey ? { Authorization: `Bearer ${config.ai.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: opts.model || config.ai.model,
        messages,
        stream: false,
        options: { temperature: opts.temperature ?? 0.2 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
    const data = await res.json();
    return data.message?.content || data.response || '';
  } finally {
    clearTimeout(timer);
  }
}

function available() {
  return !!(config.ai.reviewEnabled || config.ai.hintEnabled || config.ai.testdataEnabled);
}

module.exports = { chat, available };
