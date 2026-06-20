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
const FROM = 'The Nuci <noreply@thenuci.com>';

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
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#F1F1F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111111;">
  <div style="max-width:440px;margin:0 auto;padding:40px 16px;">
    <div style="background:#FAFAFA;border-radius:20px;padding:36px 32px;">
      <img src="https://thenuci.com/email-logo.png" width="50" height="30" alt="The Nuci" style="display:block;margin:0 auto 18px;border:0;">
      <h1 style="font-size:1.3rem;margin:0 0 14px;font-weight:600;letter-spacing:-0.02em;text-align:center;">Good morning!</h1>
      <div style="font-size:0.95rem;line-height:1.65;color:#444;">
        <p>Today is another step forward with ${pet}. Two small things keep the plan working:</p>
        <p style="margin:14px 0 6px;"><strong>1. Jot down what you notice.</strong><br>Open the app and add quick notes through the day - when the behaviour happens, what triggered it, what helped. These notes are part of the plan: they shape how tomorrow's plan is built, so the more you write, the more accurate it gets.</p>
        <p style="margin:14px 0 6px;"><strong>2. Do today's tasks.</strong><br>Small, concrete steps for ${pet} - a few minutes is all it takes.</p>
      </div>
      <div style="text-align:center;margin-top:26px;">
        <a href="https://thenuci.com/"
           style="display:inline-block;background:#111111;color:#fff;text-decoration:none;
                  padding:13px 30px;border-radius:14px;font-size:0.92rem;font-weight:600;">
          Open The Nuci
        </a>
      </div>
      <p style="font-size:0.74rem;color:#aaa;margin:24px 0 0;line-height:1.5;text-align:center;">
        A gentle daily nudge while your plan is active.
      </p>
    </div>
    <p style="text-align:center;font-size:12px;color:#aaa;margin:20px 0 0;line-height:1.6;">
      The Nuci &middot; Every behavior has a cause<br>
      <a href="${unsubUrl}" style="color:#aaa;text-decoration:underline;">Unsubscribe from these emails</a>
    </p>
  </div>
</body></html>`;
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
    `?select=email,timezone,data,last_morning_sent,marketing_opt_out` +
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
