// POST /.netlify/functions/checkout-context
// The checkout "note" (which pet, which answers, which package) used to live ONLY in the
// window that started the payment. If Stripe returned into a different window (in-app
// browsers, second tab), the note was unreachable and the plan could not be built. This
// function parks the note SERVER-SIDE at Pay time (service role - works even with an
// expired auth session) and hands it back to whichever window the return lands in.
//  save : { action:'save', email, ctx }   -> stores ctx (lean, no photos, capped)
//  load : { action:'load', email }        -> returns { ctx } (or {})
//  clear: { action:'clear', email }       -> removes it (after a completed return)
const { rateLimit } = require('./_ratelimit');
const SUPABASE_URL = process.env.THE_NUCI_SUPABASE_URL || 'https://dsuiqkcjfayazzvfwdqk.supabase.co';
const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Content-Type': 'application/json' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: '{}' };
  const rl = rateLimit(event, { max: 20, windowMs: 60000 });
  if (!rl.ok) return { statusCode: 429, headers: CORS, body: '{}' };
  if ((event.body || '').length > 120000) return { statusCode: 413, headers: CORS, body: '{}' };
  if (!SERVICE_KEY) return { statusCode: 200, headers: CORS, body: '{}' };

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: CORS, body: '{}' }; }
  const email = String(b.email || '').trim().toLowerCase();
  const action = String(b.action || '');
  if (!email || email.indexOf('@') < 0) return { statusCode: 400, headers: CORS, body: '{}' };

  // ── PROVE THE CALLER IS THIS PERSON ──
  // This used to accept an email and nothing else, so `{action:'load', email:'someone@else'}`
  // handed back a stranger's questionnaire answers and pet name to anybody who asked. The
  // note is written with the service role (that is the whole point - it must survive an
  // expired session), so ownership has to be checked here, exactly as delete-user.js does:
  // read the bearer token, ask Supabase who it belongs to, and require the same address.
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no_token' }) };
  try {
    const ANON = process.env.SUPABASE_ANON_KEY || SERVICE_KEY;
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { 'apikey': ANON, 'Authorization': 'Bearer ' + token }
    });
    if (!who.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'bad_token' }) };
    const u = await who.json();
    const tokenEmail = ((u && u.email) || '').trim().toLowerCase();
    if (!tokenEmail || tokenEmail !== email) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'not_your_account' }) };
    }
  } catch (e) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'auth_check_failed' }) };
  }

  const H = { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

  if (action === 'save') {
    let ctx = b.ctx && typeof b.ctx === 'object' ? b.ctx : null;
    if (!ctx || !ctx.answers || !ctx.answers.petName) return { statusCode: 400, headers: CORS, body: '{}' };
    // lean + fresh: no photos ever, always stamped now
    try { delete ctx.petPhoto; if (ctx.addPetPending) delete ctx.addPetPending.petPhoto; } catch (e) {}
    ctx.ts = Date.now();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?on_conflict=email`, {
      method: 'POST',
      headers: Object.assign({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }, H),
      body: JSON.stringify({ email, checkout_ctx: ctx })
    });
    return { statusCode: res.ok ? 200 : 500, headers: CORS, body: '{}' };
  }
  if (action === 'load') {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=checkout_ctx`, { headers: H });
    if (!res.ok) return { statusCode: 200, headers: CORS, body: '{}' };
    const rows = await res.json();
    const ctx = rows.length ? rows[0].checkout_ctx : null;
    // stale notes (older than 2h) are never handed out - they can't belong to THIS return
    if (!ctx || (ctx.ts && Date.now() - ctx.ts > 2 * 60 * 60 * 1000)) return { statusCode: 200, headers: CORS, body: '{}' };
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ctx }) };
  }
  if (action === 'clear') {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH', headers: Object.assign({ 'Prefer': 'return=minimal' }, H),
      body: JSON.stringify({ checkout_ctx: null })
    }).catch(() => {});
    return { statusCode: 200, headers: CORS, body: '{}' };
  }
  return { statusCode: 400, headers: CORS, body: '{}' };
};
