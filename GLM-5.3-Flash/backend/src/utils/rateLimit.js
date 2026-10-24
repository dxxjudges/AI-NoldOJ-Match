// Fixed-window in-memory rate limiter.
const buckets = new Map();

// Cleanup expired window keys periodically
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.reset < now) buckets.delete(k);
  }
}, 60 * 1000).unref();

/**
 * @param {string} key unique key, e.g. `reg:1.2.3.4`
 * @param {number} limit max hits
 * @param {number} windowMs window size
 * @returns {boolean} true if allowed
 */
function hit(key, limit, windowMs = 60 * 1000) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) {
    b = { count: 0, reset: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return b.count <= limit;
}

module.exports = { hit };
