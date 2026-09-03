// netlify/functions/_requireuser.js
//
// Shared gate for the endpoints that cost money on every call: the Anthropic ones
// (generate-plan, regenerate-day, ask-followup, vet-message) and the OpenAI one
// (transcribe). They were open to the internet, so anyone who read the page source could
// use your API keys as a free service. The per-IP rate limiter helped, but it lives in one
// warm Netlify instance and forgets itself on every cold start.
//
// This asks for the caller's Supabase access token and checks it with Supabase. No token,
// no AI call. It is the same check delete-user.js and checkout-context.js already use.

const SUPABASE_URL = process.env.SUPABASE_URL
  || process.env.THE_NUCI_SUPABASE_URL
  || 'https://dsuiqkcjfayazzvfwdqk.supabase.co';

async function requireUser(event) {
  const h = (event && event.headers) || {};
  const raw = h.authorization || h.Authorization || '';
  const token = String(raw).replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, status: 401, error: 'sign_in_required' };
  try {
    const apikey = process.env.SUPABASE_ANON_KEY
      || process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY
      || '';
    const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey, Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return { ok: false, status: 401, error: 'bad_token' };
    const u = await r.json();
    const email = String((u && u.email) || '').trim().toLowerCase();
    if (!email) return { ok: false, status: 401, error: 'bad_token' };
    return { ok: true, email };
  } catch (e) {
    return { ok: false, status: 401, error: 'auth_check_failed' };
  }
}

module.exports = { requireUser };
