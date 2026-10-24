'use strict';

/**
 * Native Windows Job Object integration point.
 *
 * The full three-layer isolation (Low Integrity Level + Job Object +
 * Restricted Token/AppContainer) requires native calls:
 *   - CreateJobObjectW / SetInformationJobObject(JOB_OBJECT_LIMIT_*)
 *   - AssignProcessToJobObject (process created suspended, then assigned)
 *   - SetTokenInformation / CreateRestrictedToken for privilege stripping
 *   - SetFileSecurity + low-IL SID on the work directory
 *
 * In this scaffold those calls are exposed behind this interface; when a
 * native helper (noldoj-sandbox.node / sandbox.exe) is present it is loaded,
 * otherwise every method degrades safely to no-op / fallback behaviour and
 * runner.js's polling layer takes over.
 */

let native = null;
try {
  // Optional native binding. Drop noldoj-sandbox.node into backend/services/sandbox/
  // to enable full Job Object enforcement.
  native = require('./noldoj-sandbox.node');
  console.log('[sandbox] Native Job Object binding loaded');
} catch (_) {
  console.log('[sandbox] Native binding not present — using fallback isolation (timeout + tree-kill + memory polling)');
}

const available = !!native;

/** Create a job object with CPU/memory/process limits; returns handle id or null. */
function createJob({ memoryLimitMb, timeLimitMs, processLimit = 64 }) {
  if (!native || !native.createJob) return null;
  try {
    return native.createJob({ memoryLimitMb, timeLimitMs, processLimit });
  } catch (e) {
    console.error('[sandbox] createJob failed, falling back:', e.message);
    return null;
  }
}

/** Assign a (suspended) process to the job. Prevents sandbox escape race. */
function assign(job, pid) {
  if (!native || !native.assignProcess || job == null) return false;
  try { return !!native.assignProcess(job, pid); } catch (_) { return false; }
}

/** Terminate everything in the job (process-tree cleanup). */
function terminate(job) {
  if (!native || !native.terminateJob || job == null) return false;
  try { return !!native.terminateJob(job); } catch (_) { return false; }
}

/** Close job handle. */
function close(job) {
  if (!native || !native.closeJob || job == null) return;
  try { native.closeJob(job); } catch (_) {}
}

/**
 * Mark a directory as Low Integrity so it cannot write to high-IL objects.
 * Extension point — no-op without native binding.
 */
function markLowIntegrity(dir) {
  if (!native || !native.setLowIntegrity) return false;
  try { return !!native.setLowIntegrity(dir); } catch (_) { return false; }
}

module.exports = { available, createJob, assign, terminate, close, markLowIntegrity };
