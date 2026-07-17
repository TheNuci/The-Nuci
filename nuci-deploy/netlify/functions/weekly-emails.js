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

// netlify/functions/weekly-emails.js
//
// Scheduled function - runs every hour (see netlify.toml).
// Sends ONE themed engagement email per day, at the user's LOCAL 13:00:
//
//   Monday    → "Did you know?"      (AI, by pet species)        → ALL users
//   Wednesday → "Tip of the day"     (AI, by pet species)        → ALL users
//   Friday    → "Progress spotlight" (streak + improvements)     → users WITH an active plan
//   Sunday    → "AI micro-insight"   (from recent check-ins)     → users WITH an active plan
//
// De-duplication: we stamp `last_weekly_sent` with the local date so the hourly
// cron never double-sends on the same day.
//
// Required Netlify env vars:
//   SUPABASE_URL
//   THE_NUCI_SUPABASE_SERVICE_ROLE_KEY
//   THE_NUCI_RESEND_API_KEY
//   ANTHROPIC_API_KEY
//
// Required DB column (add once in Supabase):
//   alter table profiles add column if not exists last_weekly_sent text;

const SEND_HOUR = 13;                 // 13:00 local time
const FROM = 'The Nuci <noreply@thenuci.com>';

// ── local time helper ───────────────────────────────────────────────
function localParts(tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false, weekday: 'long',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit'
    });
    const parts = {};
    for (const p of fmt.formatToParts(new Date())) parts[p.type] = p.value;
    const date = `${parts.year}-${parts.month}-${parts.day}`;
    let hour = parseInt(parts.hour, 10);
    if (hour === 24) hour = 0;
    return { hour, date, weekday: parts.weekday }; // weekday e.g. "Monday"
  } catch (e) {
    return null;
  }
}

// Which theme runs on which weekday, and whether it needs an active plan.
const SCHEDULE = {
  Monday:    { theme: 'didyouknow', planOnly: false },
  Tuesday:   { theme: 'noplan',     planOnly: false, noPlanOnly: true },
  Wednesday: { theme: 'tip',        planOnly: false },
  Friday:    { theme: 'progress',   planOnly: true  },
  Sunday:    { theme: 'insight',    planOnly: true  }
};

// ── email shell ─────────────────────────────────────────────────────
function wrapEmail(title, bodyHtml, footerNote, toEmail) {
  const unsub = toEmail
    ? `https://thenuci.com/?unsubscribe=${encodeURIComponent(toEmail)}`
    : 'https://thenuci.com/';
  return nuciShell({
      preheader: 'A note from The Nuci.',
      eyebrow: 'Weekly',
      titleHtml: title,
      bodyHtml: `<div style="font-size:15px;line-height:1.6;color:${NUCI.sec};font-family:Arial,sans-serif">${bodyHtml}</div>` + nuciBtn("Open the app","https://thenuci.com/"),
      unsubUrl: toEmail ? `https://thenuci.com/?unsubscribe=${encodeURIComponent(toEmail)}` : 'https://thenuci.com/'
    });
}

// ── AI helper (Claude Haiku) ────────────────────────────────────────
async function aiText(apiKey, system, user, maxTokens) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens || 400,
      system,
      messages: [{ role: 'user', content: user }]
    })
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error('AI failed: ' + JSON.stringify(data).slice(0, 200));
  return (data.content || []).map(b => (b.type === 'text' ? b.text : '')).join('').trim();
}

// ── build the email for a given theme & user ────────────────────────
async function buildEmail(theme, profileData, anthropicKey, toEmail) {
  const data = profileData || {};
  const assessments = Array.isArray(data.assessments) ? data.assessments : [];
  const firstPet = assessments[0] || {};
  const species = (firstPet.petType || (data.answers && data.answers.petType) || 'pet');
  const petName = (firstPet.petName || (data.answers && data.answers.petName) || 'your pet');

  if (theme === 'didyouknow') {
    const txt = await aiText(anthropicKey,
      'You are a friendly animal behaviourist. Write ONE surprising, accurate "did you know" fact about the given species\' behaviour. 2-3 sentences, warm and engaging, no preamble, no markdown.',
      `Species: ${species}. Write a did-you-know behaviour fact.`, 300);
    return {
      subject: `🐾 Did you know this about your ${species}?`,
      html: wrapEmail('Did you know?', `<p>${escapeHtml(txt)}</p>`,
        'A little something to brighten your day.', toEmail)
    };
  }

  if (theme === 'tip') {
    const txt = await aiText(anthropicKey,
      'You are an expert animal behaviourist. Give ONE concrete, easy, actionable tip the owner can try TODAY to support their pet\'s wellbeing or behaviour. 2-3 sentences, specific and practical, no preamble, no markdown.',
      `Species: ${species}. Give one practical tip for today.`, 300);
    return {
      subject: `💡 A quick tip for your ${species} today`,
      html: wrapEmail('Tip of the day', `<p>${escapeHtml(txt)}</p>`,
        'One small step today.', toEmail)
    };
  }

  if (theme === 'progress') {
    const streak = (firstPet.progress && firstPet.progress.streak) || data.streak || 0;
    const checkins = (firstPet.progress && firstPet.progress.checkins) || data.checkins || [];
    const count = Array.isArray(checkins) ? checkins.length : 0;
    const body =
      `<p>You're building real consistency with <strong>${escapeHtml(petName)}</strong>.</p>` +
      `<div style="display:flex;gap:12px;margin:18px 0;justify-content:center;">
         <div style="width:120px;background:#fff;border-radius:12px;padding:16px;text-align:center;">
           <div style="font-size:1.6rem;font-weight:700;color:#6B8F71;">${streak}</div>
           <div style="font-size:0.78rem;color:#888;">day streak 🔥</div>
         </div>
         <div style="width:120px;background:#fff;border-radius:12px;padding:16px;text-align:center;">
           <div style="font-size:1.6rem;font-weight:700;color:#6B8F71;">${count}</div>
           <div style="font-size:0.78rem;color:#888;">check-ins</div>
         </div>
       </div>` +
      `<p>Every check-in sharpens ${escapeHtml(petName)}'s plan. Keep going - consistency is what changes behaviour.</p>`;
    return {
      subject: `🔥 Your progress with ${petName}`,
      html: wrapEmail('Your progress this week', body, 'Keep the momentum going.', toEmail)
    };
  }

  if (theme === 'insight') {
    const checkins = (firstPet.progress && firstPet.progress.checkins) || data.checkins || [];
    if (!Array.isArray(checkins) || checkins.length === 0) return null; // nothing to analyse
    const txt = await aiText(anthropicKey,
      'You are an expert animal behaviourist. Based on the recent check-in history, write a short, encouraging micro-insight about the pet\'s pattern or progress, and one thing to focus on next. 2-3 sentences, no preamble, no markdown.',
      `Pet: ${petName} (${species}). Recent check-ins:\n${JSON.stringify(checkins).slice(0, 2000)}`, 350);
    return {
      subject: `✨ A small insight about ${petName}`,
      html: wrapEmail('Your weekly insight', `<p>${escapeHtml(txt)}</p>`,
        'Based on your recent check-ins.', toEmail)
    };
  }

  if (theme === 'noplan') {
    // Gentle weekly nudge for anyone without an active plan (registered but
    // never bought, or finished a plan and has none active).
    const pet = (data.pet_name_pending || petName || 'your pet');
    const body =
      `<p>Your pet's behaviour won't sort itself out - but a clear, structured plan makes it manageable.</p>` +
      `<p>Start a personalized 7-day plan and get the likely causes, what to do, and what to avoid - built specifically for ${escapeHtml(pet)}.</p>`;
    return {
      subject: `🐾 Ready to help ${pet === 'your pet' ? 'your pet' : pet}?`,
      html: wrapEmail('Your pet is waiting', body, 'Start whenever you\'re ready.', toEmail)
    };
  }

  return null;
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function sendEmail(apiKey, to, subject, html) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html })
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
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_API_KEY || !ANTHROPIC_API_KEY) {
    console.error('Missing env vars');
    return new Response('Missing configuration', { status: 500 });
  }

  // Pull profiles with a timezone, not opted out. We need `data` for species/check-ins.
  const url = `${SUPABASE_URL}/rest/v1/profiles` +
    `?select=email,timezone,email_reminders,marketing_opt_out,last_weekly_sent,pet_name_pending,data` +
    `&timezone=not.is.null` +
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

  let sent = 0, skipped = 0, failed = 0;

  for (const p of profiles) {
    const lp = localParts(p.timezone);
    if (!lp) { skipped++; continue; }
    if (lp.hour !== SEND_HOUR) { skipped++; continue; }            // only 13:00 local
    if (p.last_weekly_sent === lp.date) { skipped++; continue; }   // already sent today

    const slot = SCHEDULE[lp.weekday];
    if (!slot) { skipped++; continue; }                            // not a sending day

    const data = p.data || {};
    const hasPlan = !!((Array.isArray(data.assessments) && data.assessments.length) ||
                       data.currentAssessmentId || (data.answers && data.answers.petName));
    if (slot.planOnly && !hasPlan) { skipped++; continue; }        // plan-only theme, no plan
    if (slot.noPlanOnly && hasPlan) { skipped++; continue; }       // no-plan nudge, but user HAS a plan

    try {
      if (slot.theme === 'noplan') data.pet_name_pending = p.pet_name_pending;
      const email = await buildEmail(slot.theme, data, ANTHROPIC_API_KEY, p.email);
      if (!email) { skipped++; continue; }                         // nothing to send (e.g. no check-ins)
      await sendEmail(RESEND_API_KEY, p.email, email.subject, email.html);
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(p.email)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ last_weekly_sent: lp.date })
      });
      sent++;
    } catch (e) {
      console.error('Weekly send failed for', p.email, e.message);
      failed++;
    }
  }

  const summary = `Weekly run: sent=${sent} skipped=${skipped} failed=${failed} total=${profiles.length}`;
  console.log(summary);
  return new Response(summary, { status: 200 });
};

// Runs at minute 0 of every hour; the function itself picks the right users/day.
export const config = {
  schedule: '0 * * * *'
};
