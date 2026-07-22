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

// netlify/functions/morning-nudge.js
//
// Scheduled function - runs every hour.
// For each user with an active plan whose LOCAL time is currently 09:xx,
// sends a friendly morning email reminding them to (1) jot daily notes/observations
// and (2) do their daily tasks. De-duped per local date via `last_morning_sent`.
//
// Required Netlify env vars:
//   SUPABASE_URL
//   THE_NUCI_SUPABASE_SERVICE_ROLE_KEY
//   THE_NUCI_RESEND_API_KEY
//
// Required Supabase column (add once):
//   alter table profiles add column if not exists last_morning_sent text;

const MORNING_HOUR = 9;              // 09:00 local time
const FROM = 'The Nuci <team@thenuci.com>';

function localParts(tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
    });
    const parts = {};
    for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    let hour = parseInt(parts.hour, 10);
    if (hour === 24) hour = 0;
    return { hour, date };
  } catch (e) {
    return null;
  }
}

function emailHtml(petName, toEmail) {
  const unsubUrl = toEmail ? `https://thenuci.com/?unsubscribe=${encodeURIComponent(toEmail)}` : 'https://thenuci.com/';
  const pet = petName || 'your pet';
  return nuciShell({
      preheader: "Today's small steps are waiting.",
      eyebrow: 'Good morning',
      titleHtml: `A fresh day for<br>${nuciAccent(pet)}.`,
      bodyHtml: nuciPara(`Two small things keep ${nuciEsc(pet)}'s plan working today.`)
        + nuciPara(`<b style="color:${NUCI.ink};font-weight:600">1. Jot down what you notice.</b> Add quick notes through the day: when the behaviour happens, what triggered it, what helped. These notes shape how tomorrow's plan is built.`,14)
        + nuciPara(`<b style="color:${NUCI.ink};font-weight:600">2. Do today's tasks.</b> Small, concrete steps for ${nuciEsc(pet)}. A few minutes is all it takes.`,10)
        + nuciBtn("See today's plan","https://thenuci.com/"),
      unsubUrl: toEmail ? `https://thenuci.com/?unsubscribe=${encodeURIComponent(toEmail)}` : 'https://thenuci.com/'
    });
}

async function sendEmail(apiKey, to, petName) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: `Don't forget today's notes & tasks for ${petName || 'your pet'} 🐾`,
      html: emailHtml(petName, to)
    })
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Resend ${res.status}: ${txt}`);
  }
  return res.json();
}

// Does this profile have an active (started, not completed) plan?
function hasActivePlan(data) {
  try {
    const d = typeof data === 'string' ? JSON.parse(data) : data;
    if (!d) return false;
    // Active if there's a plan start date or assessments with progress, and not complete.
    const started = !!d.planStartDate || (Array.isArray(d.assessments) && d.assessments.length > 0) ||
                    (d.planOverrides && Object.keys(d.planOverrides).length > 0);
    return started && !d.planComplete;
  } catch (e) {
    return false;
  }
}

// Pull the pet name from the stored data blob.
function petNameFrom(data) {
  try {
    const d = typeof data === 'string' ? JSON.parse(data) : data;
    if (d && d.answers && d.answers.petName) return d.answers.petName;
    if (d && Array.isArray(d.assessments) && d.assessments[0] && d.assessments[0].petName) return d.assessments[0].petName;
  } catch (e) {}
  return null;
}

export default async (req) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
  const RESEND_API_KEY = process.env.THE_NUCI_RESEND_API_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY) {
    console.error('Missing env vars');
    return new Response('Missing configuration', { status: 500 });
  }

  // Plan-holders who haven't opted out. We need `data` to confirm an active plan.
  const url = `${SUPABASE_URL}/rest/v1/profiles` +
    `?select=email,timezone,data,last_morning_sent,marketing_opt_out,purchased` +
    `&timezone=not.is.null` +
    `&marketing_opt_out=not.eq.true` +
    `&purchased=eq.true`;

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

  let sent = 0, skipped = 0, failed = 0;

  for (const p of profiles) {
    const lp = localParts(p.timezone);
    if (!lp) { skipped++; continue; }
    if (lp.hour !== MORNING_HOUR) { skipped++; continue; }     // only the 09:00 hour
    if (p.last_morning_sent === lp.date) { skipped++; continue; } // already sent today
    if (!hasActivePlan(p.data)) { skipped++; continue; }       // only active plans

    const petName = petNameFrom(p.data);

    try {
      await sendEmail(RESEND_API_KEY, p.email, petName);
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(p.email)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ last_morning_sent: lp.date })
      });
      sent++;
    } catch (e) {
      console.error('Send failed for', p.email, e.message);
      failed++;
    }
  }

  const summary = `Morning nudge run: sent=${sent} skipped=${skipped} failed=${failed} total=${profiles.length}`;
  console.log(summary);
  return new Response(summary, { status: 200 });
};

// Runs at minute 0 of every hour; fires per-user at their local 09:00.
export const config = {
  schedule: '0 * * * *'
};
