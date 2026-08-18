// POST /.netlify/functions/log-error
// Receives uncaught frontend errors (capped at 5 per session client-side) and stores them
// in the client_errors table so bugs on real users' phones are visible to the developer,
// not just to the user. Contains no personal data: message, file, line, stack, UA, build.
// View in Supabase:  select ts, build, msg, src, line from client_errors order by ts desc;

const { rateLimit } = require('./_ratelimit');

const SUPABASE_URL = process.env.THE_NUCI_SUPABASE_URL || 'https://dsuiqkcjfayazzvfwdqk.supabase.co';
const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: '' };
  const rl = rateLimit(event, { max: 10, windowMs: 60000 });
  if (!rl.ok) return { statusCode: 429, body: '' };
  if ((event.body || '').length > 6000) return { statusCode: 413, body: '' };
  if (!SERVICE_KEY) return { statusCode: 204, body: '' };

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 204, body: '' }; }

  const row = {
    msg: String(b.msg || '').slice(0, 500) || null,
    src: String(b.src || '').slice(0, 300) || null,
    line: Number.isFinite(+b.line) ? Math.max(0, Math.floor(+b.line)) : null,
    col: Number.isFinite(+b.col) ? Math.max(0, Math.floor(+b.col)) : null,
    stack: String(b.stack || '').slice(0, 2000) || null,
    ua: String(b.ua || '').slice(0, 300) || null,
    build: String(b.build || '').slice(0, 60) || null,
    path: String(b.path || '').slice(0, 120) || null
  };
  if (!row.msg && !row.stack) return { statusCode: 204, body: '' };

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/client_errors`, {
      method: 'POST',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': 'Bearer ' + SERVICE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row)
    });
  } catch (e) { /* error logging must never throw */ }

  return { statusCode: 204, body: '' };
};
