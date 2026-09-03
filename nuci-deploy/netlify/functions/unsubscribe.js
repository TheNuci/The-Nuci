// The Nuci · One-click email unsubscribe (GDPR Art. 7(3))
// Runs server-side with the service role because the person clicking the link in an email
// is NOT logged in, so the browser (anon key, ownership RLS) cannot update their row.
// This only ever flips marketing consent OFF - it can't read or change anything else, so
// accepting an email address here is low-risk (worst case: someone unsubscribes an address
// they know, which simply stops marketing emails to it).
//
// Netlify env vars required:
//   SUPABASE_URL
//   THE_NUCI_SUPABASE_SERVICE_ROLE_KEY
//
// Request:  POST { email: string, kind?: string }
// Response: { ok: true }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'not_configured' }) };

  let email, kind, token;
  try {
    const b = JSON.parse(event.body || '{}');
    email = (b.email || '').trim().toLowerCase();
    kind = (b.kind || 'all').toString().slice(0, 20);
    token = (b.token || '').toString().slice(0, 64);
  }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_json' }) }; }
  if (!email || email.indexOf('@') < 0) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_email' }) };

  // ── SIGNATURE, CHECKED ONLY WHEN PRESENT ──
  // New links carry &t=<hmac of the address>. If it is there it must match, which stops
  // anyone switching off a stranger's emails just by knowing the address.
  //
  // A MISSING token is accepted on purpose. Every email sent before today has an unsigned
  // link, and an unsubscribe link that errors is worse than the hole it closes: it annoys
  // the person, it damages the sending domain, and GDPR Art. 7(3) requires withdrawal to be
  // as easy as consent was. Once the old emails have aged out, change this to reject a
  // missing token as well and the hole is shut for good.
  if (token) {
    const { unsubToken } = require('./_unsubtoken');
    const expected = unsubToken(email);
    if (!expected || token !== expected) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ ok: false, error: 'bad_token' }) };
    }
  }

  // What gets switched off depends on WHICH email the person clicked:
  //  - kind 'tips'      -> only the optional behaviour-tips consent (service emails untouched)
  //  - kind 'marketing' -> marketing consent + the general marketing opt-out flag
  //  - kind 'all'       -> everything, including plan reminder emails (email_reminders)
  // This also closes the earlier hole where ANY unsubscribe silently set marketing_opt_out
  // and thereby killed a paying user's service reminders too.
  let patch;
  if (kind === 'tips') {
    patch = { marketing_consent: false, marketing_consent_at: null };
  } else if (kind === 'marketing') {
    patch = { marketing_consent: false, marketing_consent_at: null, marketing_opt_out: true };
  } else {
    patch = { marketing_consent: false, marketing_consent_at: null, marketing_opt_out: true, email_reminders: false };
  }

  const h = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };
  try {
    const url = `${URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`;
    const res = await fetch(url, { method: 'PATCH', headers: h, body: JSON.stringify(patch) });
    if (!res.ok && res.status !== 404) {
      const t = await res.text().catch(() => '');
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'update_' + res.status, detail: t.slice(0, 160) }) };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: false, error: 'exception' }) };
  }
};
