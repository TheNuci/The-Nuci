// The Nuci · lightweight in-memory rate limiter for the paid-API functions.
// Netlify keeps a function "warm" between nearby invocations, so a module-level map catches
// bursts from the same IP within that window. It isn't a hard guarantee across every cold
// instance, but combined with per-request size caps it stops the cheap, high-volume abuse
// that would run up Anthropic / Google bills. For a hard ceiling, also set provider-side
// quotas (e.g. Google Places daily cap).
//
// Usage in a function:
//   const { rateLimit } = require('./_ratelimit');
//   const rl = rateLimit(event, { max: 8, windowMs: 60000 });
//   if (!rl.ok) return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'rate_limited' }) };

const HITS = new Map();   // ip -> [timestamps]

function clientIp(event) {
  const h = event.headers || {};
  return (h['x-nf-client-connection-ip'] ||
          (h['x-forwarded-for'] || '').split(',')[0].trim() ||
          h['client-ip'] || 'unknown');
}

function rateLimit(event, opts) {
  const max = (opts && opts.max) || 10;
  const windowMs = (opts && opts.windowMs) || 60000;
  const ip = clientIp(event);
  const now = Date.now();
  let arr = HITS.get(ip) || [];
  // drop timestamps outside the window
  arr = arr.filter(t => now - t < windowMs);
  arr.push(now);
  HITS.set(ip, arr);
  // opportunistic cleanup so the map doesn't grow unbounded
  if (HITS.size > 5000) {
    for (const [k, v] of HITS) { if (!v.length || now - v[v.length - 1] > windowMs) HITS.delete(k); }
  }
  return { ok: arr.length <= max, ip, count: arr.length };
}

module.exports = { rateLimit, clientIp };
