// POST /.netlify/functions/track
// Anonymous first-party analytics: stores ONLY an event name, path, referrer and a
// per-tab session id (random, gone when the tab closes). No cookies, no IP, no email,
// no user id - deliberately, so it stays within the "no trackers" promise.
// Events land in the analytics_events table (service-role only; see supabase_schema.sql,
// which also contains a ready-made funnel query).

const { rateLimit } = require('./_ratelimit');

const SUPABASE_URL = process.env.THE_NUCI_SUPABASE_URL || 'https://dsuiqkcjfayazzvfwdqk.supabase.co';
const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  // sendBeacon fires on page unload too; keep the limit generous but real.
  const rl = rateLimit(event, { max: 60, windowMs: 60000 });
  if (!rl.ok) return { statusCode: 429, body: '' };
  if ((event.body || '').length > 2000) return { statusCode: 413, body: '' };
  if (!SERVICE_KEY) return { statusCode: 204, body: '' };   // not configured -> silently drop

  let b = {};
  // sendBeacon may arrive as text/plain - parse the body regardless of content type.
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 204, body: '' }; }

  const ev = String(b.e || '');
  if (!/^[a-z0-9_]{1,40}$/.test(ev)) return { statusCode: 204, body: '' };

  const row = {
    event: ev,
    path: String(b.p || '').slice(0, 120) || null,
    ref: String(b.r || '').slice(0, 200) || null,
    session: String(b.s || '').slice(0, 20) || null,
    extra: b.x != null ? String(b.x).slice(0, 80) : null
  };

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row)
    });
  } catch (e) { /* analytics must never break anything */ }

  return { statusCode: 204, body: '' };
};
