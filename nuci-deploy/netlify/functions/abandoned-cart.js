const { unsubUrl: nuciUnsubUrl } = require('./_unsubtoken');
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

// netlify/functions/abandoned-cart.js
//
// Scheduled function - runs every 5 minutes (see netlify.toml).
// Sends TWO nudges to users who signed up and have NOT purchased:
//   20h - about four hours before the free day one runs out ("it ends soon, unlock the week")
//   36h - twelve hours after it lapsed ("your pet is waiting to carry on")
// Each is sent at most once per user, and the wording differs depending on whether they ever
// actually opened their free day one. No 15-minute nudge: confirming the code drops people
// straight into plan generation, so at that point there is nothing to chase.
//
// Required Netlify env vars:
//   SUPABASE_URL
//   THE_NUCI_SUPABASE_SERVICE_ROLE_KEY
//   THE_NUCI_RESEND_API_KEY
//
// Required DB columns (add once in Supabase):
//   alter table profiles add column if not exists signup_at timestamptz;
//   alter table profiles add column if not exists pet_name_pending text;
//   alter table profiles add column if not exists purchased boolean default false;
//   alter table profiles add column if not exists cart_nudge_sent boolean default false;

const FROM = 'The Nuci <team@thenuci.com>';
// Retimed for the free day-one model (Aug 2026). Nudging 15 minutes after signup made no
// sense any more: at that point the owner has a live, free plan and is using it. The three
// stages now sit around the moments that actually matter - shortly before the free day runs
// out, during the 12-hour hold, and one last soft note days later.
const MIN_AGE_MIN = 1200;    // 20h - about four hours before the free day ends
// (MAX_AGE_MIN removed: it was never referenced. Stage 3 is checked before stage 2 and
//  stage 2 before stage 1, so an old profile can never fall through to an early nudge.)

function escapeHtml(s) {
  return String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// `started` = this person actually opened their free day one. When it is false, every line
// that says "continue", "day two" or "paused" describes something that never happened to
// them, so each stage gets its own not-yet-started wording instead.
function emailHtml(petName, toEmail, stage, started) {
  const pet = petName ? escapeHtml(petName) : 'your pet';
  const unsubUrl = toEmail ? nuciUnsubUrl(toEmail, 'all') : 'https://thenuci.com/';
  const cta = `https://thenuci.com/app.html?resume=1`;
  const tick = (x) => `<div style="font-size:14px;color:${NUCI.ink};font-family:Arial,sans-serif;padding:5px 0"><span style="color:${NUCI.sage}">&#10003;</span>&nbsp;&nbsp;${x}</div>`;

  // ── NOT STARTED: signed up and answered the questions, but never opened day one ──
  if (!started) {
    if (stage === 2) {
      return nuciShell({
        preheader: `${pet}'s free day is still unopened.`,
        eyebrow: 'Waiting for you',
        titleHtml: `Behaviour rarely<br>${nuciAccent('fixes itself')}.`,
        bodyHtml: nuciPara(`You told us about ${pet}, but day one is still unopened. It is free, and it takes a few minutes.`)
          + nuciPara('Patterns hold until something in the routine changes. Day one is where that starts.',10)
          + nuciBtn(`Start ${pet}'s free day`, cta)
          + nuciBox([
              'Written from your answers, not a template',
              'Free to start, no card needed',
              'Tells you what not to do, as well as what to do'
            ].map(tick).join('')),
        unsubUrl
      });
    }
    return nuciShell({
      preheader: `${pet}'s day one is ready.`,
      eyebrow: 'Your free day',
      titleHtml: `Day one is ready<br>${nuciAccent('and it is free')}.`,
      bodyHtml: nuciPara(`We wrote ${pet}'s first day from the answers you gave us. It is waiting, and it costs nothing to try.`)
        + nuciPara('A few small, specific steps, then one short check-in in the evening.',10)
        + nuciBtn(`Open ${pet}'s day one`, cta)
        + nuciBox([
            'Written for '+pet+', not a template',
            'Free to start, no card needed',
            'One short check-in a day'
          ].map(tick).join('')),
      unsubUrl
    });
  }

  // Stage 2 · 36 hours - twelve hours after the free day lapsed. Nothing is lost, it waits.
  if (stage === 2) {
    return nuciShell({
      preheader: `${pet}'s plan is waiting to continue.`,
      eyebrow: 'Waiting for you',
      titleHtml: `${nuciAccent(pet)} is waiting<br>to carry on.`,
      bodyHtml: nuciPara(`The free day has ended, but nothing is lost. ${pet}'s week picks up from day two, with everything you logged still in place.`)
        + nuciPara('Patterns hold until something in the routine changes. That is what the rest of the week is for.',10)
        + nuciBtn(`Continue ${pet}'s week`, cta)
        + nuciBox([
            'Written from your answers, not a template',
            'One short check-in a day',
            'Tells you what not to do, as well as what to do'
          ].map(tick).join('')),
      unsubUrl
    });
  }

  // Stage 1 · 20 hours, about four hours before the free day runs out.
  return nuciShell({
    preheader: `${pet}'s free day ends in a few hours.`,
    eyebrow: 'Ending soon',
    titleHtml: `${nuciAccent(pet)}'s free day<br>ends in a few hours.`,
    bodyHtml: nuciPara(`Day one has been yours to try. When it ends, the plan pauses until you unlock the rest of the week - the remaining six days are already written for ${pet}.`)
      + nuciPara('If day one told you something useful, the week is where the pattern actually changes.',10)
      + nuciBtn(`Continue ${pet}'s week`, cta)
      + nuciBox([
          'Six more days, written for '+pet,
          'Each evening adapts the next day',
          'One payment, no subscription'
        ].map(tick).join('')),
    unsubUrl
  });
}

async function sendEmail(apiKey, to, petName, stage, started) {
  const pet = petName || 'your pet';
  const subjects = started ? {
    1: petName ? `${petName}'s free day ends in a few hours` : `Your free day ends in a few hours`,
    2: petName ? `${petName} is waiting to carry on` : `Your plan is waiting to carry on`
  } : {
    1: petName ? `${petName}'s day one is ready` : `Your free day one is ready`,
    2: petName ? `${petName}'s free day is still unopened` : `Your free day is still unopened`
  };
  const subject = subjects[stage] || subjects[1];
  const unsubUrl = nuciUnsubUrl(to, 'all');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html: emailHtml(petName, to, stage || 1, started),
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } })
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

  // The test-send and debug dumps below can email arbitrary addresses and list every user's
  // email + signup data, so they must never be publicly reachable. They only work when
  // THE_NUCI_DEBUG_KEY is set in Netlify env AND the caller passes the same value as &key=.
  let debugKeyOk = false;
  try{
    const sp0 = new URL(req.url).searchParams;
    const DK = process.env.THE_NUCI_DEBUG_KEY;
    debugKeyOk = !!DK && sp0.get('key') === DK;
  }catch(e){}

  // test=EMAIL : send one abandoned-cart email right now to that address,
  // bypassing all timing/DB filters. Proves the email pipeline works.
  let testEmail = null;
  try{ testEmail = new URL(req.url).searchParams.get('test'); }catch(e){}
  if (testEmail && debugKeyOk) {
    try{
      await sendEmail(RESEND_API_KEY, testEmail, 'your pet');
      return new Response('[test] Sent abandoned-cart email to ' + testEmail + '. Check inbox + spam.', { status: 200 });
    }catch(e){
      return new Response('[test] Send FAILED: ' + String(e), { status: 200 });
    }
  }

  // debug=2: dump ALL profiles with raw columns, no filters, so we can see
  // exactly what's in the table and which condition excludes each row.
  let debugAll = false;
  try{
    const sp = new URL(req.url).searchParams;
    debugAll = (sp.get('debug') === '2' || sp.get('all') === '1') && debugKeyOk;
  }catch(e){}
  if (debugAll) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=email,signup_at,purchased,cart_nudge_sent,marketing_opt_out,pet_name_pending`, {
        headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
      });
      const txt = await r.text();
      if (!r.ok) return new Response('[v2] DB error '+r.status+': '+txt, { status: 200 });
      const rows = JSON.parse(txt);
      const now = Date.now();
      const lines = rows.map(p => {
        const t = Date.parse(p.signup_at);
        const age = isNaN(t) ? 'no-date' : Math.round((now-t)/60000)+'min';
        return `${p.email} | signup_at=${p.signup_at||'NULL'} (${age}) | purchased=${p.purchased} | cart_nudge_sent=${p.cart_nudge_sent} | marketing_opt_out=${p.marketing_opt_out}`;
      });
      return new Response(
        `[v2 debug] ALL profiles (${rows.length}):\n\n` + (lines.join('\n') || 'table empty') +
        `\n\nStages: 1st at 20h, 2nd at 36h. Requires purchased!=true and marketing_opt_out!=true.`,
        { status: 200, headers: { 'Content-Type': 'text/plain' } });
    } catch (e) {
      return new Response('[v2] debug2 error: '+String(e), { status: 200 });
    }
  }

  // Candidates: signed up, not purchased, opted in. We fetch both nudge flags
  // and decide per-profile whether the 15-min or the 48-h nudge is due.
  const url = `${SUPABASE_URL}/rest/v1/profiles` +
    `?select=email,signup_at,pet_name_pending,purchased,cart_nudge_sent,cart_nudge2_sent,marketing_opt_out,data` +
    `&signup_at=not.is.null` +
    `&purchased=not.eq.true` +
    `&marketing_opt_out=not.eq.true`;

  let profiles;
  try {
    const r = await fetch(url, {
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` }
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

  const now = Date.now();
  // Two nudges only. 20h catches the decision while the free day is still open; 36h is
  // twelve hours after it has lapsed, when the plan is sitting there waiting to resume.
  const SECOND_NUDGE_MIN = 2160;   // 36h - 12 hours after the free day has run out
  let sent = 0, skipped = 0, failed = 0;
  const diag = [];
  // Time budget: stop cleanly before the 26s limit; the every-5-minutes cadence and the
  // per-user sent-flags mean anyone left over is picked up on the very next run.
  const DEADLINE = Date.now() + 24000;

  async function markFlag(email, field){
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ [field]: true })
    });
  }

  for (const p of profiles) {
    if (Date.now() > DEADLINE) { console.warn(`abandoned-cart: time budget reached, ${profiles.length - sent - skipped - failed} profile(s) deferred to next run`); break; }
    const t = Date.parse(p.signup_at);
    if (isNaN(t)) { skipped++; diag.push(`${p.email}: bad/empty signup_at (${p.signup_at})`); continue; }
    const ageMin = Math.round((now - t) / 60000);
    // Did this person ever actually open day one? A saved pet name only means they answered
    // the questions; a generated plan means the free day really started. Without this the
    // "paused / continue from day two" wording went to people who never had a day one.
    const _d = p.data || {};
    const started = !!(
      (_d.aiPlan && _d.aiPlan.days && _d.aiPlan.days.length) ||
      _d.trialStart ||
      (Array.isArray(_d.archive) && _d.archive.length) ||
      (Array.isArray(_d.pets) && _d.pets.some(function(x){ return x && x.aiPlan && x.aiPlan.days && x.aiPlan.days.length; }))
    );

    // Decide which nudge (if any) is due. The longer wait is checked first.
    // Second nudge: 27h after signup, if not sent and still no purchase.
    if (ageMin >= SECOND_NUDGE_MIN && p.cart_nudge2_sent !== true) {
      try {
        await sendEmail(RESEND_API_KEY, p.email, p.pet_name_pending, 2, started);
        await markFlag(p.email, 'cart_nudge2_sent');
        // also set the first flag in case they somehow skipped it
        if (p.cart_nudge_sent !== true) await markFlag(p.email, 'cart_nudge_sent');
        sent++; diag.push(`${p.email}: SENT 2nd nudge (age ${ageMin}min / 36h)`);
      } catch (e) { failed++; diag.push(`${p.email}: 2nd send failed - ${e.message}`); }
      continue;
    }
    // First nudge: 20h after signup, if not sent yet.
    if (ageMin >= MIN_AGE_MIN && p.cart_nudge_sent !== true) {
      try {
        await sendEmail(RESEND_API_KEY, p.email, p.pet_name_pending, 1, started);
        await markFlag(p.email, 'cart_nudge_sent');
        sent++; diag.push(`${p.email}: SENT 1st nudge (age ${ageMin}min)`);
      } catch (e) { failed++; diag.push(`${p.email}: 1st send failed - ${e.message}`); }
      continue;
    }
    // Nothing due.
    if (ageMin < MIN_AGE_MIN) { skipped++; diag.push(`${p.email}: too new (${ageMin}min, need >=${MIN_AGE_MIN})`); }
    else if (p.cart_nudge_sent === true && ageMin < SECOND_NUDGE_MIN) { skipped++; diag.push(`${p.email}: 1st sent, waiting for 36h (${ageMin}min)`); }
    else if (p.cart_nudge2_sent === true) { skipped++; diag.push(`${p.email}: both nudges sent, nothing further`); }
    else { skipped++; diag.push(`${p.email}: all three nudges already sent`); }
  }

  const summary = `Cart nudge run: sent=${sent} skipped=${skipped} failed=${failed} total=${profiles.length}`;
  console.log(summary);
  // When called manually with ?debug=1&key=SECRET, return a detailed per-profile report.
  let wantDebug = false;
  try{ wantDebug = new URL(req.url).searchParams.get('debug') === '1' && debugKeyOk; }catch(e){}
  if (wantDebug) {
    return new Response(
      summary + '\n\n' + (diag.length ? diag.join('\n') : 'No candidate profiles matched the query (signup_at not null, not purchased, not nudged, not opted out).'),
      { status: 200, headers: { 'Content-Type': 'text/plain' } }
    );
  }
  return new Response(summary, { status: 200 });
};

// Hourly is enough: the earliest nudge is 20 hours after signup, so the old every-5-minutes
// cadence ran 288 times a day to do the work of 24.
export const config = {
  schedule: '0 * * * *'
};
