// GET /.netlify/functions/public-stats
// Public, aggregate-only numbers for the landing page's social proof: real user count and
// real plan ratings (collected in-app at plan end). Nothing personal, nothing per-user.
// Cached in memory for 10 minutes so the landing page never hammers the database.

const { rateLimit } = require('./_ratelimit');

const SUPABASE_URL = process.env.THE_NUCI_SUPABASE_URL || 'https://dsuiqkcjfayazzvfwdqk.supabase.co';
const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' };

let CACHE = null, CACHE_AT = 0;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: CORS, body: '{}' };
  const rl = rateLimit(event, { max: 30, windowMs: 60000 });
  if (!rl.ok) return { statusCode: 429, headers: CORS, body: '{}' };

  if (CACHE && Date.now() - CACHE_AT < 10 * 60 * 1000) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify(CACHE) };
  }
  if (!SERVICE_KEY) return { statusCode: 200, headers: CORS, body: JSON.stringify({ users: null, ratingAvg: null, ratingCount: 0 }) };

  const H = { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY };
  const out = { users: null, ratingAvg: null, ratingCount: 0 };

  try {
    // exact row count without pulling rows
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=email`, {
      headers: Object.assign({ 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0' }, H)
    });
    const cr = r.headers.get('content-range');           // e.g. "0-0/126"
    if (cr && cr.includes('/')) out.users = parseInt(cr.split('/')[1], 10) || null;
  } catch (e) {}

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events?select=extra&event=eq.rating`, {
      headers: Object.assign({ 'Range-Unit': 'items', 'Range': '0-4999' }, H)
    });
    if (r.ok) {
      const rows = await r.json();
      const vals = rows.map(x => parseInt(x.extra, 10)).filter(n => n >= 1 && n <= 5);
      out.ratingCount = vals.length;
      if (vals.length) out.ratingAvg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    }
  } catch (e) {}

  CACHE = out; CACHE_AT = Date.now();
  return { statusCode: 200, headers: CORS, body: JSON.stringify(out) };
};
