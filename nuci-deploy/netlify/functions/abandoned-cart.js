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
// Sends ONE gentle nudge to users who signed up ~15+ minutes ago, entered a
// pet name, but have NOT purchased a plan yet. Sent only once per user.
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
const MIN_AGE_MIN = 15;      // wait at least 15 minutes after signup
const MAX_AGE_MIN = 2880;    // ...within 48h (was 3h - too narrow to ever fire)

function escapeHtml(s) {
  return String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function emailHtml(petName, toEmail) {
  const unsubUrl = toEmail ? `https://thenuci.com/?unsubscribe=${encodeURIComponent(toEmail)}` : 'https://thenuci.com/';
  const pet = petName ? escapeHtml(petName) : 'your pet';
  const headline = petName ? `${pet} is waiting for your help` : `Your pet is waiting for your help`;
  return nuciShell({
      preheader: `${pet}'s plan is ready whenever you are.`,
      eyebrow: 'Still thinking?',
      titleHtml: `${nuciAccent(pet)}'s plan<br>is ready.`,
      bodyHtml: nuciPara(`You answered the questions, the hard part's done. ${pet}'s personalised 7-day plan is built and waiting for you.`)
        + nuciPara("One calmer week could start today.",10)
        + nuciBtn(`Get ${pet}'s plan`,"https://thenuci.com/")
        + nuciBox(['A day-by-day plan built for '+pet,'Daily check-ins that adapt','Progress you can actually see'].map(function(x){return `<div style="font-size:14px;color:${NUCI.ink};font-family:Arial,sans-serif;padding:5px 0"><span style="color:${NUCI.sage}">&#10003;</span>&nbsp;&nbsp;${x}</div>`;}).join('')),
      unsubUrl: toEmail ? `https://thenuci.com/?unsubscribe=${encodeURIComponent(toEmail)}` : 'https://thenuci.com/'
    });
}

async function sendEmail(apiKey, to, petName) {
  const subject = petName ? `${petName} is waiting for your help 🐾` : `Your pet is waiting for your help 🐾`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html: emailHtml(petName, to) })
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

  // test=EMAIL : send one abandoned-cart email right now to that address,
  // bypassing all timing/DB filters. Proves the email pipeline works.
  let testEmail = null;
  try{ testEmail = new URL(req.url).searchParams.get('test'); }catch(e){}
  if (testEmail) {
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
    debugAll = sp.get('debug') === '2' || sp.get('all') === '1';
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
        `\n\nWindow needed: signup between ${MIN_AGE_MIN}min and ${MAX_AGE_MIN}min ago, purchased!=true, cart_nudge_sent!=true, marketing_opt_out!=true.`,
        { status: 200, headers: { 'Content-Type': 'text/plain' } });
    } catch (e) {
      return new Response('[v2] debug2 error: '+String(e), { status: 200 });
    }
  }

  // Candidates: signed up, not purchased, opted in. We fetch both nudge flags
  // and decide per-profile whether the 15-min or the 48-h nudge is due.
  const url = `${SUPABASE_URL}/rest/v1/profiles` +
    `?select=email,signup_at,pet_name_pending,purchased,cart_nudge_sent,cart_nudge2_sent,marketing_opt_out` +
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
  const SECOND_NUDGE_MIN = 2880;   // 48 hours
  let sent = 0, skipped = 0, failed = 0;
  const diag = [];

  async function markFlag(email, field){
    await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ [field]: true })
    });
  }

  for (const p of profiles) {
    const t = Date.parse(p.signup_at);
    if (isNaN(t)) { skipped++; diag.push(`${p.email}: bad/empty signup_at (${p.signup_at})`); continue; }
    const ageMin = Math.round((now - t) / 60000);

    // Decide which nudge (if any) is due for this profile.
    // Second nudge: 48h after signup, if not sent and still no purchase.
    if (ageMin >= SECOND_NUDGE_MIN && p.cart_nudge2_sent !== true) {
      try {
        await sendEmail(RESEND_API_KEY, p.email, p.pet_name_pending);
        await markFlag(p.email, 'cart_nudge2_sent');
        // also set the first flag in case they somehow skipped it
        if (p.cart_nudge_sent !== true) await markFlag(p.email, 'cart_nudge_sent');
        sent++; diag.push(`${p.email}: SENT 2nd nudge (age ${ageMin}min / 48h)`);
      } catch (e) { failed++; diag.push(`${p.email}: 2nd send failed - ${e.message}`); }
      continue;
    }
    // First nudge: 15min after signup, if not sent yet.
    if (ageMin >= MIN_AGE_MIN && p.cart_nudge_sent !== true) {
      try {
        await sendEmail(RESEND_API_KEY, p.email, p.pet_name_pending);
        await markFlag(p.email, 'cart_nudge_sent');
        sent++; diag.push(`${p.email}: SENT 1st nudge (age ${ageMin}min)`);
      } catch (e) { failed++; diag.push(`${p.email}: 1st send failed - ${e.message}`); }
      continue;
    }
    // Nothing due.
    if (ageMin < MIN_AGE_MIN) { skipped++; diag.push(`${p.email}: too new (${ageMin}min, need >=${MIN_AGE_MIN})`); }
    else if (p.cart_nudge_sent === true && ageMin < SECOND_NUDGE_MIN) { skipped++; diag.push(`${p.email}: 1st sent, waiting for 48h (${ageMin}min)`); }
    else { skipped++; diag.push(`${p.email}: both nudges already sent`); }
  }

  const OLD_LOOP_DISABLED = false;

  const summary = `Cart nudge run: sent=${sent} skipped=${skipped} failed=${failed} total=${profiles.length}`;
  console.log(summary);
  // When called manually with ?debug=1, return a detailed per-profile report.
  let wantDebug = false;
  try{ wantDebug = new URL(req.url).searchParams.get('debug') === '1'; }catch(e){}
  if (wantDebug) {
    return new Response(
      summary + '\n\n' + (diag.length ? diag.join('\n') : 'No candidate profiles matched the query (signup_at not null, not purchased, not nudged, not opted out).'),
      { status: 200, headers: { 'Content-Type': 'text/plain' } }
    );
  }
  return new Response(summary, { status: 200 });
};

// Runs every 5 minutes so the ~15-minute timing is accurate.
export const config = {
  schedule: '*/5 * * * *'
};
