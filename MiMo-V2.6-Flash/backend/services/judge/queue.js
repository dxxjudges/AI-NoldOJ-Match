'use strict';

/**
 * Judge queue: serialises judging jobs with bounded concurrency.
 * Status transitions are pushed over WebSocket via events/ws.js.
 */

const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(100);

const jobs = [];       // { kind: 'submission'|'ide', id, payload }
const running = new Set();

function enqueue(job) {
  jobs.push(job);
  pump();
  return job;
}

function pump() {
  const { config } = require('../../config');
  const max = Math.max(1, config.judge.queueConcurrency);
  while (running.size < max && jobs.length) {
    const job = jobs.shift();
    running.add(job.id);
    runJob(job)
      .catch(e => console.error('[judge] job error', job, e))
      .finally(() => {
        running.delete(job.id);
        bus.emit('queue', { size: jobs.length, running: running.size });
        pump();
      });
  }
  bus.emit('queue', { size: jobs.length, running: running.size });
}

async function runJob(job) {
  if (job.kind === 'submission') {
    const { judgeSubmission } = require('./runner');
    await judgeSubmission(job.id);
  } else if (job.kind === 'ide') {
    const { runIde } = require('./ide');
    await runIde(job.id);
  }
}

function stats() {
  return { pending: jobs.length, running: running.size };
}

function queuePosition(submissionId) {
  const idx = jobs.findIndex(j => j.kind === 'submission' && j.id === submissionId);
  return idx >= 0 ? idx + 1 : 0;
}

module.exports = { enqueue, stats, queuePosition, bus };
