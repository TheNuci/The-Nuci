// netlify/functions/check-email.js
//
// Answers exactly two questions about an email address, and nothing else:
//
//   exists   - is there a profile for it?
//   hasPlan  - has that profile EVER had a plan? (bought, finished, or a used free day)
//
// Why it has to live on the server: RLS only lets a user read their own profiles row once
// they are authenticated, so the app cannot ask "is this email taken?" before login. This
// function uses the service-role key to look, and deliberately returns booleans only - no
// name, no pet, no dates, nothing that would make it useful to anyone fishing.
//
// It NEVER selects the `data` blob. Only two small JSON paths are pulled out of it
// server-side (trialStart, plansGenerated), so this costs no meaningful egress.
//
// ENV (Netlify -> Site configuration -> Environment variables):
//   SUPABASE_URL                 https://dsuiqkcjfayazzvfwdqk.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    the service_role key (NEVER the anon key, NEVER in app.html)

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.SUPA_URL || '';
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

// Light throttle. Netlify recycles instances, so this is a speed bump against casual
// enumeration rather than a real limit - it costs nothing and stops a naive script.
const HITS = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

function throttled(ip) {
  const now = Date.now();
  const rec = HITS.get(ip);
  if (!rec || now - rec.start > WINDOW_MS) {
    HITS.set(ip, { start: now, n: 1 });
    if (HITS.size > 5000) HITS.clear();
    return false;
  }
  rec.n += 1;
  return rec.n > MAX_PER_WINDOW;
}

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const ip =
    (event.headers &&
      (event.headers['x-nf-client-connection-ip'] ||
        (event.headers['x-forwarded-for'] || '').split(',')[0].trim())) ||
    'unknown';
  // Fail OPEN on throttle: the app treats an unusable answer as "new email" and falls back
  // to its sign-in probe, which is safe. Never block a real signup over a rate limit.
  if (throttled(ip)) return json(200, { exists: false, hasPlan: false, throttled: true });

  let email = '';
  try {
    email = String((JSON.parse(event.body || '{}').email) || '').trim().toLowerCase();
  } catch (e) {
    return json(400, { error: 'Bad request' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 254) {
    return json(400, { error: 'Bad request' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    // Misconfigured -> same safe fallback as above rather than a hard failure.
    console.error('check-email: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set');
    return json(200, { exists: false, hasPlan: false, unavailable: true });
  }

  const select = [
    'purchased',
    'plan_credits',
    'transactions',
    'trial_start:data->>trialStart',
    'plans_generated:data->>plansGenerated',
    'archive_len:data->archive'
  ].join(',');

  const url =
    SUPABASE_URL.replace(/\/+$/, '') +
    '/rest/v1/profiles?select=' + encodeURIComponent(select) +
    '&email=eq.' + encodeURIComponent(email) +
    '&limit=1';

  try {
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: 'Bearer ' + SERVICE_KEY,
        Accept: 'application/json'
      }
    });
    if (!res.ok) {
      console.error('check-email: supabase ' + res.status + ' ' + (await res.text()).slice(0, 300));
      return json(200, { exists: false, hasPlan: false, unavailable: true });
    }
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return json(200, { exists: false, hasPlan: false });

    // MIRRORS accountEverHadPlan() in app.html. Any one of these means the free first day
    // has already been spent, for good.
    const credits = Number(row.plan_credits || 0);
    const txCount = Array.isArray(row.transactions) ? row.transactions.length : 0;
    const plansGenerated = Number(row.plans_generated || 0);
    const archiveLen = Array.isArray(row.archive_len) ? row.archive_len.length : 0;

    const hasPlan =
      row.purchased === true ||
      credits > 0 ||
      txCount > 0 ||
      plansGenerated > 0 ||
      !!row.trial_start ||
      archiveLen > 0;

    return json(200, { exists: true, hasPlan: hasPlan });
  } catch (e) {
    console.error('check-email:', e && e.message);
    return json(200, { exists: false, hasPlan: false, unavailable: true });
  }
};
