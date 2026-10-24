'use strict';

const express = require('express');
const { config } = require('../config');
const captcha = require('../services/captcha');
const { rateLimit } = require('../middleware/rateLimit');

const router = express.Router();

// GET /api/captcha  -> { id, svg, enabled }
router.get('/', rateLimit('captcha', 60, 30), (req, res) => {
  if (!config.security.captchaEnabled) {
    return res.json({ enabled: false, id: null, svg: null });
  }
  const { id, svg } = captcha.generate(4);
  res.json({ enabled: true, id, svg });
});

module.exports = router;
