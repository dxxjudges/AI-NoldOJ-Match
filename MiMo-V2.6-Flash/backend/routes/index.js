'use strict';

const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth'));
router.use('/captcha', require('./captcha'));
router.use('/problems', require('./problems'));
router.use('/submissions', require('./submissions'));
router.use('/ide', require('./ide'));
router.use('/users', require('./users'));
router.use('/contests', require('./contests'));
router.use('/articles', require('./articles'));
router.use('/announcements', require('./announcements'));
router.use('/discussions', require('./discussions'));
router.use('/problem-sets', require('./problemSets'));
router.use('/exams', require('./exams'));
router.use('/files', require('./files'));
router.use('/admin', require('./admin'));
router.use('/search', require('./search'));
router.use('/plagiarism', require('./plagiarism'));
router.use('/virtual', require('./virtual'));
router.use('/ai', require('./ai'));

router.get('/health', (req, res) => {
  res.json({ ok: true, name: 'NoldOJ', version: require('../../package.json').version, time: Date.now() });
});

router.get('/openapi.json', (req, res) => {
  res.json(require('../utils/openapi').spec());
});

router.get('/openapi.yaml', (req, res) => {
  // JSON is served as the canonical spec; YAML clients can convert.
  res.type('application/json').send(JSON.stringify(require('../utils/openapi').spec(), null, 2));
});

module.exports = router;
