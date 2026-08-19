// ── Premium email shell (forest-editorial, matches the app) ──────────
const NUCI = { bg:'#F2F1EC', card:'#FBFBF8', ink:'#1A211C', sec:'#5C6660', sage:'#6B8F71', forest:'#3E5A47', border:'#E6E3DA' };
function nuciEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function nuciBtn(label, href){ return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0"><tr><td style="background:${NUCI.forest};border-radius:14px"><a href="${href}" style="display:inline-block;padding:14px 26px;font-family:Arial,sans-serif;font-size:15px;color:#F4F1E9;text-decoration:none;font-weight:bold">${nuciEsc(label)}</a></td></tr></table>`; }
function nuciAccent(t){ return `<span style="font-family:Georgia,serif;font-style:italic;color:${NUCI.forest}">${nuciEsc(t)}</span>`; }
function nuciShell({ preheader='', eyebrow='', titleHtml='', bodyHtml='', unsubUrl='https://thenuci.com/' }){
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>The Nuci</title></head>
<body style="margin:0;padding:0;background:${NUCI.bg};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${nuciEsc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NUCI.bg};padding:28px 0"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%">
    <tr><td style="padding:4px 32px 24px">
      <div style="font-family:Arial,Helvetica,sans-serif;font-size:25px;font-weight:400;letter-spacing:-0.01em"><span style="color:${NUCI.sage}">The</span> <span style="color:${NUCI.ink}">Nuci</span><span style="color:${NUCI.sage}">.</span></div>
    </td></tr>
    <tr><td style="padding:0 20px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NUCI.card};border:1px solid ${NUCI.border};border-radius:22px;overflow:hidden">
        <tr><td style="padding:30px 30px 28px">
          ${eyebrow?`<div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:${NUCI.sage};font-family:Arial,sans-serif;font-weight:bold">${nuciEsc(eyebrow)}</div>`:''}
          ${titleHtml?`<h1 style="margin:8px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:26px;line-height:1.15;font-weight:normal;color:${NUCI.ink};letter-spacing:-0.01em">${titleHtml}</h1>`:''}
          ${bodyHtml}
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:24px 32px 28px">
      <div style="height:1px;background:${NUCI.border};margin:0 0 18px"></div>
      <p style="margin:0;font-size:12px;line-height:1.7;color:${NUCI.sec};font-family:Arial,sans-serif">The Nuci, behaviour plans for calmer pets. Contact us at <a href="mailto:hello@thenuci.com" style="color:${NUCI.sec}">hello@thenuci.com</a>. You're receiving this because you have a plan with The Nuci. <a href="${unsubUrl}" style="color:${NUCI.sage};text-decoration:underline">Unsubscribe</a> from these emails.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
function nuciPara(t,mt){ return `<p style="margin:${mt==null?14:mt}px 0 0;font-size:15px;line-height:1.6;color:${NUCI.sec};font-family:Arial,sans-serif">${t}</p>`; }
function nuciBox(inner){ return `<table role="presentation" width="100%" style="margin-top:18px;background:${NUCI.bg};border-radius:14px" cellpadding="0" cellspacing="0"><tr><td style="padding:16px 18px">${inner}</td></tr></table>`; }

// netlify/functions/checkin-reminder.js
//
// Scheduled function - runs every hour (see netlify.toml).
// For each user whose LOCAL time is currently 20:xx, hasn't checked in today,
// and hasn't already been reminded today, sends a check-in reminder email via Resend.
//
// Required Netlify env vars:
//   SUPABASE_URL                        (your project URL)
//   THE_NUCI_SUPABASE_SERVICE_ROLE_KEY  (service_role secret - bypasses RLS, server-only)
//   THE_NUCI_RESEND_API_KEY             (re_...)
//
// NOTE: this is a backend function. The Resend/Supabase keys live in Netlify
// env vars, never in index.html.

const REMINDER_HOUR = 20;            // 20:00 local time
const FROM = 'The Nuci <team@thenuci.com>';

// Returns the local hour (0–23) and YYYY-MM-DD date for a given IANA timezone.
function localParts(tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
    });
    const parts = {};
    for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
    // en-CA gives YYYY-MM-DD ordering for date parts
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    let hour = parseInt(parts.hour, 10);
    if (hour === 24) hour = 0; // some engines emit 24 for midnight
    return { hour, date };
  } catch (e) {
    return null; // invalid/unknown timezone → skip user
  }
}


// All pets on this profile with an ACTIVE plan right now (calendar-aware, frozen excluded),
// so multi-pet owners get "Nucci & Ruby" instead of only the currently active pet's name.
function activePetNames(data, localDate) {
  try {
    const d = typeof data === 'string' ? JSON.parse(data) : data;
    if (!d) return [];
    const pets = Array.isArray(d.pets) && d.pets.length ? d.pets : (d.answers ? [d] : []);
    const toNum = k => { if (!k) return null; const p = String(k).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };
    const today = toNum(localDate);
    const names = [];
    for (const p of pets) {
      if (!p || !p.answers || !p.answers.petName) continue;
      if (p.planComplete === true || p.frozenSince) continue;
      if (!p.planStartDate || !(p.aiPlan && Array.isArray(p.aiPlan.days) && p.aiPlan.days.length)) continue;
      const start = toNum(p.planStartDate);
      if (start == null || today == null) continue;
      const elapsed = Math.round((today - start) / 86400000);
      if (elapsed < 0 || elapsed >= (p.planLength || 7)) continue;
      if (names.indexOf(p.answers.petName) < 0) names.push(p.answers.petName);
    }
    return names;
  } catch (e) { return []; }
}
function joinNames(names) {
  if (!names || !names.length) return '';
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
}

function emailHtml(toEmail, names) {
  const forLine = names ? `${forLine}<p style="margin:0 0 6px;font-size:14px;color:#5C6660">Tonight\u2019s check-in: <b>${names}</b></p>` : '';
  const unsubUrl = toEmail ? `https://thenuci.com/app.html?unsub=all&e=${encodeURIComponent(toEmail)}` : 'https://thenuci.com/';
  return nuciShell({
      preheader: 'A quick check-in keeps the plan on track.',
      eyebrow: 'Evening check-in',
      titleHtml: 'How was your pet<br>today?',
      bodyHtml: nuciPara("A quick daily check-in keeps your pet's plan on track and your streak alive. It only takes a minute.")
        + nuciPara("Tomorrow's steps adapt to your answer.",10)
        + nuciBtn("Check in for today","https://thenuci.com/?checkin=1")
        + nuciBox(`<div style="text-align:center"><div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${NUCI.sec};font-family:Arial,sans-serif">Your check-in window</div><div style="font-family:Georgia,serif;font-size:26px;color:${NUCI.forest};margin-top:4px">20:00 - 23:00</div></div>`),
      unsubUrl: toEmail ? `https://thenuci.com/app.html?unsub=all&e=${encodeURIComponent(toEmail)}` : 'https://thenuci.com/'
    });
}

async function sendEmail(apiKey, to, names) {
  const unsubUrl = `https://thenuci.com/app.html?unsub=all&e=${encodeURIComponent(to)}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: names ? ('🐾 Check-in time for ' + names) : '🐾 Your daily check-in is waiting',
      html: emailHtml(to, names),
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${txt}`);
  }
  return res.json();
}

export default async (req) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_API_KEY = process.env.THE_NUCI_RESEND_API_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY) {
    console.error('Missing env vars');
    return new Response('Missing configuration', { status: 500 });
  }

  // Fetch candidate profiles via PostgREST using the service_role key (bypasses RLS).
  // Only pull rows that have a timezone and haven't opted out.
  // IMPORTANT: pet-related reminders go ONLY to people with a purchased, active plan.
  // Someone who merely signed up must never receive check-in nudges about an animal.
  const url = `${SUPABASE_URL}/rest/v1/profiles` +
    `?select=email,timezone,last_checkin_date,email_reminders,last_reminder_sent,marketing_opt_out,purchased,data` +
    `&timezone=not.is.null` +
    `&email_reminders=not.eq.false` +
    `&marketing_opt_out=not.eq.true` +
    `&purchased=eq.true`;

  // Does this profile have an active (started, not completed) plan? Without this check,
  // someone who finished their plan months ago would keep getting a 20:00 reminder forever.
  function hasActivePlan(data) {
    try {
      const d = typeof data === 'string' ? JSON.parse(data) : data;
      if (!d) return false;
      if (d.frozenSince) return false;   // plan frozen (holiday mode) - no emails until unfrozen
      const started = !!d.planStartDate || (Array.isArray(d.assessments) && d.assessments.length > 0) ||
                      (d.planOverrides && Object.keys(d.planOverrides).length > 0);
      return started && !d.planComplete;
    } catch (e) {
      return false;
    }
  }

  let profiles;
  try {
    const r = await fetch(url, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`
      }
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error('Supabase fetch failed', r.status, t);
      return new Response('DB error', { status: 500 });
    }
    profiles = await r.json();
  } catch (e) {
    console.error('Supabase fetch exception', e);
    return new Response('DB error', { status: 500 });
  }

  let sent = 0, skipped = 0, failed = 0;
  const diag = [];
  // Time budget: stop cleanly before the 26s function limit kills us mid-send. Anyone left
  // over is picked up by the next hourly run (per-day de-dupe makes re-runs safe).
  const DEADLINE = Date.now() + 24000;
  diag.push(`filter matched ${Array.isArray(profiles) ? profiles.length : 0} profile(s) (needs: timezone set, purchased=true, reminders on)`);
  // Debug output lists user emails, so it must never be publicly reachable. It only works
  // when THE_NUCI_DEBUG_KEY is set in Netlify env AND the caller passes the same value:
  //   ...checkin-reminder?debug=1&key=YOURSECRET
  let wantDebug = false;
  try{
    const sp = new URL(req.url).searchParams;
    const DK = process.env.THE_NUCI_DEBUG_KEY;
    wantDebug = sp.get('debug') === '1' && !!DK && sp.get('key') === DK;
  }catch(e){}

  for (const p of profiles) {
    if (Date.now() > DEADLINE) { console.warn(`checkin-reminder: time budget reached, ${profiles.length - sent - skipped - failed} profile(s) deferred to next run`); break; }
    const lp = localParts(p.timezone);
    if (!lp) { skipped++; diag.push(`${p.email}: bad/no timezone (${p.timezone})`); continue; }

    // Only the 20:00 hour, in the user's own timezone.
    if (lp.hour !== REMINDER_HOUR) { skipped++; diag.push(`${p.email}: local hour ${lp.hour} (need ${REMINDER_HOUR}), tz=${p.timezone}`); continue; }

    // Already checked in today (in their local date)? No reminder needed.
    if (p.last_checkin_date === lp.date) { skipped++; diag.push(`${p.email}: already checked in today`); continue; }

    // Already reminded today? Don't double-send (cron runs hourly).
    if (p.last_reminder_sent === lp.date) { skipped++; diag.push(`${p.email}: already reminded today`); continue; }

    // Reminders only make sense while a plan is actually running.
    if (!hasActivePlan(p.data)) { skipped++; diag.push(`${p.email}: no active plan`); continue; }

    if (wantDebug) { diag.push(`${p.email}: WOULD SEND (local ${lp.hour}:xx, tz=${p.timezone})`); continue; }

    try {
      await sendEmail(RESEND_API_KEY, p.email, joinNames(activePetNames(p.data, lp.date)));
      // Mark as reminded for this local date.
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(p.email)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ last_reminder_sent: lp.date })
      });
      sent++;
    } catch (e) {
      console.error('Send failed for', p.email, e.message);
      failed++;
    }
  }

  const summary = `Reminder run: sent=${sent} skipped=${skipped} failed=${failed} total=${profiles.length}`;
  console.log(summary);
  if (wantDebug) {
    return new Response(summary + '\n\n' + (diag.length ? diag.join('\n') : 'No profiles with timezone + reminders on.') +
      '\n\nNote: emails only actually send at 20:00 in each user\'s timezone; this debug view lists why each row is or isn\'t eligible right now.',
      { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response(summary, { status: 200 });
};

// Netlify scheduled config - runs at minute 0 of every hour.
export const config = {
  schedule: '0 * * * *'
};
