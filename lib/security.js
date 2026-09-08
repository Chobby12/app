/**
 * Small security helpers. Deliberately dependency-free — these are a handful of
 * headers and a counter, not worth another package.
 */

function headers(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');       // stops /uploads/ MIME sniffing
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
}

/**
 * JSON safe to drop inside a <script> tag. JSON.stringify alone is not: a value
 * containing "</script>" closes the tag and everything after it becomes markup.
 */
function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** Fixed-window attempt limiter, keyed by IP. Enough to make guessing pointless. */
function attemptLimiter({ max = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.resets) hits.delete(k);
  }, windowMs).unref();

  return {
    blocked(ip) {
      const e = hits.get(ip);
      return Boolean(e && Date.now() < e.resets && e.count >= max);
    },
    fail(ip) {
      const now = Date.now();
      const e = hits.get(ip);
      if (!e || now > e.resets) hits.set(ip, { count: 1, resets: now + windowMs });
      else e.count++;
    },
    clear(ip) { hits.delete(ip); },
    retryMinutes(ip) {
      const e = hits.get(ip);
      return e ? Math.max(1, Math.ceil((e.resets - Date.now()) / 60000)) : 0;
    }
  };
}

module.exports = { headers, scriptJson, attemptLimiter };
