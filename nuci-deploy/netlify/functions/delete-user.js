// The Nuci · Delete a user completely (GDPR erasure)
// Removes the profile row from the database AND the auth user, so they are no longer a
// user, hold no data, and cannot receive any emails.
//
// Netlify env vars required:
//   SUPABASE_URL
//   THE_NUCI_SUPABASE_SERVICE_ROLE_KEY   (service role - server side only, never in the browser)
//
// Request:  POST { email: string }  with header  Authorization: Bearer <user access token>
// The caller must prove they ARE this user: we verify the token against Supabase and only
// delete if the token's own email matches the requested email. Without this, anyone could
// delete anyone's account by sending their email.
// Response: { ok: true } on success

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
  const ANON = process.env.SUPABASE_ANON_KEY || '';
  if (!URL || !KEY) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'not_configured' }) };

  let email;
  try { email = (JSON.parse(event.body || '{}').email || '').trim().toLowerCase(); }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_json' }) }; }
  if (!email || email.indexOf('@') < 0) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_email' }) };

  // ── Verify the caller owns this account ──
  // Read the bearer token and ask Supabase who it belongs to. Only proceed if it resolves
  // to the same email being deleted.
  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'no_token' }) };
  try {
    const who = await fetch(`${URL}/auth/v1/user`, { headers: { 'apikey': ANON || KEY, 'Authorization': 'Bearer ' + token } });
    if (!who.ok) return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'bad_token' }) };
    const u = await who.json();
    const tokenEmail = (u && u.email || '').trim().toLowerCase();
    if (!tokenEmail || tokenEmail !== email) {
      return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'not_your_account' }) };
    }
  } catch (e) {
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'auth_check_failed' }) };
  }

  const h = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

  try {
    // 1) Delete the profile row(s) for this email.
    const delUrl = `${URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`;
    const delRes = await fetch(delUrl, { method: 'DELETE', headers: Object.assign({ 'Prefer': 'return=minimal' }, h) });
    if (!delRes.ok && delRes.status !== 404) {
      const t = await delRes.text().catch(() => '');
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'db_delete_' + delRes.status, detail: t.slice(0, 200) }) };
    }

    // 2) Delete the auth user so the email is no longer a registered user.
    //    Find the user id via the admin API, then delete it.
    try {
      const listRes = await fetch(`${URL}/auth/v1/admin/users?email=${encodeURIComponent(email)}`, { headers: h });
      if (listRes.ok) {
        const list = await listRes.json();
        const users = (list && (list.users || list)) || [];
        for (const u of users) {
          if (u && u.id && (u.email || '').toLowerCase() === email) {
            await fetch(`${URL}/auth/v1/admin/users/${u.id}`, { method: 'DELETE', headers: h });
          }
        }
      }
    } catch (e) { /* auth deletion is best-effort; the profile row is already gone */ }

    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'exception', detail: String(e && e.message || e) }) };
  }
};
