// POST /.netlify/functions/admin-stats   body: { key: THE_NUCI_DEBUG_KEY }
// Aggregates everything the admin dashboard (admin.html) shows: users, plans, funnel,
// activity, errors. Returns ONLY aggregate numbers - no emails, no personal data, no
// photos (the profile query selects specific JSON fields so pet photos are never pulled).

const { rateLimit } = require('./_ratelimit');

const SUPABASE_URL = process.env.THE_NUCI_SUPABASE_URL || 'https://dsuiqkcjfayazzvfwdqk.supabase.co';
const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

function dayKeyUTC(d) { return d.toISOString().slice(0, 10); }

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method' }) };
  const rl = rateLimit(event, { max: 20, windowMs: 60000 });
  if (!rl.ok) return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'rate_limited' }) };

  const DK = process.env.THE_NUCI_DEBUG_KEY;
  let key = null;
  try { key = (JSON.parse(event.body || '{}').key || '').toString(); } catch (e) {}
  if (!DK || !SERVICE_KEY || key !== DK) {
    return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'forbidden' }) };
  }

  const H = { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY };

  // ── profiles: specific fields only (never data->pets / photos / notes) ──
  const sel = 'purchased,plan_credits,signup_at,last_checkin_date,marketing_consent,marketing_opt_out,email_reminders,transactions,'
    + 'curday:data->currentDay,planlen:data->planLength,pstart:data->>planStartDate,'
    + 'pcomplete:data->planComplete,frozen:data->>frozenSince,streak:data->streak';
  const profiles = [];
  for (let from = 0; ; from += 500) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=${encodeURIComponent(sel)}`, {
      headers: Object.assign({ 'Range-Unit': 'items', 'Range': `${from}-${from + 499}` }, H)
    });
    if (!r.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'profiles_fetch', status: r.status }) };
    const page = await r.json();
    profiles.push(...page);
    if (!Array.isArray(page) || page.length < 500) break;
  }

  const now = new Date();
  const today = dayKeyUTC(now);
  const daysAgo = n => dayKeyUTC(new Date(Date.now() - n * 86400000));

  const stats = {
    generatedAt: now.toISOString(),
    users: { total: profiles.length, purchased: 0, creditsOutstanding: 0, newLast7: 0, newLast30: 0, signupsByDay: {} },
    plans: { active: 0, frozen: 0, completed: 0, stalled: 0, dayDistribution: {}, checkedInToday: 0 },
    emails: { remindersOn: 0, marketingConsent: 0, optedOut: 0 },
    revenue: { total: 0, transactions: 0 },
    funnel7: {}, funnel30: {}, funnelSessions7: {}, funnelSessions30: {},
    activity: { appOpensByDay: {}, checkinsByDay: {}, activeSessions7: 0, activeSessionsToday: 0 },
    errors: { last7: 0, recent: [] }
  };

  for (const p of profiles) {
    if (p.purchased === true) stats.users.purchased++;
    stats.users.creditsOutstanding += (typeof p.plan_credits === 'number' ? p.plan_credits : 0);
    if (p.signup_at) {
      const sd = String(p.signup_at).slice(0, 10);
      if (sd >= daysAgo(7)) stats.users.newLast7++;
      if (sd >= daysAgo(30)) stats.users.newLast30++;
      if (sd >= daysAgo(14)) stats.users.signupsByDay[sd] = (stats.users.signupsByDay[sd] || 0) + 1;
    }
    if (p.email_reminders !== false) stats.emails.remindersOn++;
    if (p.marketing_consent === true) stats.emails.marketingConsent++;
    if (p.marketing_opt_out === true) stats.emails.optedOut++;
    if (Array.isArray(p.transactions)) {
      for (const t of p.transactions) {
        if (t && typeof t.price === 'number') { stats.revenue.total += t.price; stats.revenue.transactions++; }
      }
    }
    // plan state
    const complete = p.pcomplete === true;
    const hasStart = !!p.pstart;
    if (complete) stats.plans.completed++;
    if (hasStart && !complete && p.purchased === true) {
      if (p.frozen) { stats.plans.frozen++; }
      else {
        stats.plans.active++;
        const d = Math.min(Math.max(parseInt(p.curday, 10) || 1, 1), parseInt(p.planlen, 10) || 7);
        stats.plans.dayDistribution[d] = (stats.plans.dayDistribution[d] || 0) + 1;
        if (p.last_checkin_date === today) stats.plans.checkedInToday++;
        // stalled: active plan but no check-in for 2+ days (or never, with an old start)
        const lc = p.last_checkin_date || null;
        if ((lc && lc < daysAgo(2)) || (!lc && p.pstart < daysAgo(2))) stats.plans.stalled++;
      }
    }
  }
  stats.revenue.total = Math.round(stats.revenue.total * 100) / 100;

  // ── analytics_events: last 30 days (cap 10000 rows, newest first) ──
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events?select=event,ts,session&ts=gte.${encodeURIComponent(since)}&order=ts.desc`, {
      headers: Object.assign({ 'Range-Unit': 'items', 'Range': '0-9999' }, H)
    });
    if (r.ok) {
      const evs = await r.json();
      const s7 = {}, s30 = {};
      for (const e of evs) {
        const d = String(e.ts).slice(0, 10);
        const in7 = d >= daysAgo(7);
        stats.funnel30[e.event] = (stats.funnel30[e.event] || 0) + 1;
        if (in7) stats.funnel7[e.event] = (stats.funnel7[e.event] || 0) + 1;
        const sid = e.session || 'anon';
        (s30[e.event] = s30[e.event] || new Set()).add(sid);
        if (in7) (s7[e.event] = s7[e.event] || new Set()).add(sid);
        if (e.event === 'app_open' && d >= daysAgo(14)) {
          stats.activity.appOpensByDay[d] = (stats.activity.appOpensByDay[d] || 0) + 1;
        }
        if (e.event === 'checkin_done' && d >= daysAgo(14)) {
          stats.activity.checkinsByDay[d] = (stats.activity.checkinsByDay[d] || 0) + 1;
        }
      }
      for (const k in s7) stats.funnelSessions7[k] = s7[k].size;
      for (const k in s30) stats.funnelSessions30[k] = s30[k].size;
      const openSessions7 = new Set(), openSessionsToday = new Set();
      for (const e of evs) {
        if (e.event !== 'app_open') continue;
        const d = String(e.ts).slice(0, 10);
        if (d >= daysAgo(7)) openSessions7.add(e.session || 'anon');
        if (d === today) openSessionsToday.add(e.session || 'anon');
      }
      stats.activity.activeSessions7 = openSessions7.size;
      stats.activity.activeSessionsToday = openSessionsToday.size;
    }
  } catch (e) { /* analytics table may not exist yet - dashboard shows zeros */ }

  // ── plan ratings (all time): the real numbers behind the landing-page stars ──
  stats.ratings = { avg: null, count: 0 };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/analytics_events?select=extra&event=eq.rating`, {
      headers: Object.assign({ 'Range-Unit': 'items', 'Range': '0-4999' }, H)
    });
    if (r.ok) {
      const rows = await r.json();
      const vals = rows.map(x => parseInt(x.extra, 10)).filter(n => n >= 1 && n <= 5);
      stats.ratings.count = vals.length;
      if (vals.length) stats.ratings.avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
    }
  } catch (e) {}

  // ── client errors: last 7 days count + 5 most recent ──
  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/client_errors?select=ts,msg,src,line,build&ts=gte.${encodeURIComponent(since)}&order=ts.desc`, {
      headers: Object.assign({ 'Range-Unit': 'items', 'Range': '0-499' }, H)
    });
    if (r.ok) {
      const errs = await r.json();
      stats.errors.last7 = errs.length;
      stats.errors.recent = errs.slice(0, 5).map(e => ({
        ts: e.ts, build: e.build || '',
        msg: String(e.msg || '').slice(0, 160),
        where: (e.src ? String(e.src).split('/').pop() : '') + (e.line ? ':' + e.line : '')
      }));
    }
  } catch (e) {}

  return { statusCode: 200, headers: CORS, body: JSON.stringify(stats) };
};
