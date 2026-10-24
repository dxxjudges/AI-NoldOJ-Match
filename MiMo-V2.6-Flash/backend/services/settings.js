'use strict';

/** Persist a subset of runtime config into config/config.json so admin toggles survive restart. */
const fs = require('fs');
const { config, CONFIG_FILE } = require('../config');

function persist() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (_) {}
  file.security = file.security || {};
  file.ai = file.ai || {};
  file.files = file.files || {};
  file.judge = file.judge || {};
  file.security.captchaEnabled = config.security.captchaEnabled;
  file.security.registrationEnabled = config.security.registrationEnabled;
  file.ai.reviewEnabled = config.ai.reviewEnabled;
  file.ai.hintEnabled = config.ai.hintEnabled;
  file.ai.testdataEnabled = config.ai.testdataEnabled;
  file.ai.baseUrl = config.ai.baseUrl;
  file.ai.model = config.ai.model;
  if (config.ai.apiKey) file.ai.apiKey = config.ai.apiKey;
  file.files.defaultUserQuotaMb = config.files.defaultUserQuotaMb;
  file.files.maxSingleFileMb = config.files.maxSingleFileMb;
  file.judge.queueConcurrency = config.judge.queueConcurrency;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(file, null, 2) + '\n', 'utf8');
}

function snapshot() {
  return {
    registrationEnabled: config.security.registrationEnabled,
    captchaEnabled: config.security.captchaEnabled,
    aiReviewEnabled: config.ai.reviewEnabled,
    aiHintEnabled: config.ai.hintEnabled,
    aiTestdataEnabled: config.ai.testdataEnabled,
    aiBaseUrl: config.ai.baseUrl,
    aiModel: config.ai.model,
    aiApiKeySet: !!config.ai.apiKey,
    defaultUserQuotaMb: config.files.defaultUserQuotaMb,
    maxSingleFileMb: config.files.maxSingleFileMb,
    queueConcurrency: config.judge.queueConcurrency,
  };
}

module.exports = { persist, snapshot };
