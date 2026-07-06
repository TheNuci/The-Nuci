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
const FROM = 'The Nuci <noreply@thenuci.com>';

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

function emailHtml(toEmail) {
  const unsubUrl = toEmail ? `https://thenuci.com/?unsubscribe=${encodeURIComponent(toEmail)}` : 'https://thenuci.com/';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#F1F1F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111111;">
  <div style="max-width:440px;margin:0 auto;padding:40px 16px;">
    <div style="background:#FAFAFA;border-radius:20px;padding:36px 32px;text-align:center;">
      <img src="https://thenuci.com/email-logo.png" width="120" height="35" alt="The Nuci" style="display:block;margin:0 auto 16px;border:0;">
      <h1 style="font-size:1.35rem;margin:0 0 12px;font-weight:600;letter-spacing:-0.02em;">Time for today's check-in</h1>
      <p style="font-size:0.95rem;line-height:1.6;color:#555;margin:0 0 18px;">
        A quick daily check-in keeps your pet's plan on track and your streak alive. It only takes a minute.
      </p>
      <div style="background:#fff;border:1px solid #eee;border-radius:14px;padding:14px 18px;margin:0 0 24px;">
        <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.06em;color:#999;margin-bottom:4px;">Your check-in window</div>
        <div style="font-size:1.15rem;font-weight:700;color:#6B8F71;font-variant-numeric:tabular-nums;">20:00 &rarr; 23:00</div>
        <div style="font-size:0.8rem;color:#888;margin-top:4px;">You have 3 hours - it closes at 23:00 tonight.</div>
      </div>
      <a href="https://thenuci.com/"
         style="display:inline-block;background:#111111;color:#fff;text-decoration:none;
                padding:14px 32px;border-radius:14px;font-size:0.95rem;font-weight:600;">
        Open The Nuci
      </a>
      <p style="font-size:0.75rem;color:#aaa;margin:28px 0 0;line-height:1.5;">
        You're receiving this because daily reminders are on.
        You can turn them off anytime in your profile.
      </p>
    </div>
    <p style="text-align:center;font-size:12px;color:#aaa;margin:20px 0 0;line-height:1.6;">The Nuci &middot; Pet Behaviour &amp; Wellbeing<br>
      <a href="${unsubUrl}" style="color:#aaa;text-decoration:underline;">Unsubscribe from these emails</a>
    </p>
  </div>
</body></html>`;
}

async function sendEmail(apiKey, to) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: '🐾 Your daily check-in is waiting',
      html: emailHtml(to)
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
  const url = `${SUPABASE_URL}/rest/v1/profiles` +
    `?select=email,timezone,last_checkin_date,email_reminders,last_reminder_sent,marketing_opt_out` +
    `&timezone=not.is.null` +
    `&email_reminders=not.eq.false` +
    `&marketing_opt_out=not.eq.true`;

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
  let wantDebug = false;
  try{ wantDebug = new URL(req.url).searchParams.get('debug') === '1'; }catch(e){}

  for (const p of profiles) {
    const lp = localParts(p.timezone);
    if (!lp) { skipped++; diag.push(`${p.email}: bad/no timezone (${p.timezone})`); continue; }

    // Only the 20:00 hour, in the user's own timezone.
    if (lp.hour !== REMINDER_HOUR) { skipped++; diag.push(`${p.email}: local hour ${lp.hour} (need ${REMINDER_HOUR}), tz=${p.timezone}`); continue; }

    // Already checked in today (in their local date)? No reminder needed.
    if (p.last_checkin_date === lp.date) { skipped++; diag.push(`${p.email}: already checked in today`); continue; }

    // Already reminded today? Don't double-send (cron runs hourly).
    if (p.last_reminder_sent === lp.date) { skipped++; diag.push(`${p.email}: already reminded today`); continue; }

    if (wantDebug) { diag.push(`${p.email}: WOULD SEND (local ${lp.hour}:xx, tz=${p.timezone})`); continue; }

    try {
      await sendEmail(RESEND_API_KEY, p.email);
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
