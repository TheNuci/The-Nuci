// netlify/functions/checkin-reminder.js
//
// Scheduled function — runs every hour (see netlify.toml).
// For each user whose LOCAL time is currently 20:xx, hasn't checked in today,
// and hasn't already been reminded today, sends a check-in reminder email via Resend.
//
// Required Netlify env vars:
//   SUPABASE_URL                        (your project URL)
//   THE_NUCI_SUPABASE_SERVICE_ROLE_KEY  (service_role secret — bypasses RLS, server-only)
//   THE_NUCI_RESEND_API_KEY             (re_...)
//
// NOTE: this is a backend function. The Resend/Supabase keys live in Netlify
// env vars, never in index.html.

const REMINDER_HOUR = 20;            // 20:00 local time
const FROM = 'Nucci <noreply@send.thenuci.com>';

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

function emailHtml() {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#F1F1F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="background:#fff;border-radius:20px;padding:32px;text-align:center;">
      <div style="font-size:40px;margin-bottom:8px;">🐾</div>
      <h1 style="font-size:1.35rem;margin:0 0 12px;">Time for today's check-in</h1>
      <p style="font-size:0.95rem;line-height:1.5;color:#555;margin:0 0 24px;">
        A quick daily check-in keeps your pet's plan on track and your streak alive.
        It only takes a minute.
      </p>
      <a href="https://thenuci.com/"
         style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;
                padding:13px 28px;border-radius:99px;font-size:0.95rem;font-weight:600;">
        Open Nucci
      </a>
      <p style="font-size:0.75rem;color:#aaa;margin:24px 0 0;">
        You're receiving this because daily reminders are on.
        You can turn them off anytime in your Nucci profile.
      </p>
    </div>
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
      html: emailHtml()
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
    `?select=email,timezone,last_checkin_date,email_reminders,last_reminder_sent` +
    `&timezone=not.is.null` +
    `&email_reminders=not.eq.false`;

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

  for (const p of profiles) {
    const lp = localParts(p.timezone);
    if (!lp) { skipped++; continue; }

    // Only the 20:00 hour, in the user's own timezone.
    if (lp.hour !== REMINDER_HOUR) { skipped++; continue; }

    // Already checked in today (in their local date)? No reminder needed.
    if (p.last_checkin_date === lp.date) { skipped++; continue; }

    // Already reminded today? Don't double-send (cron runs hourly).
    if (p.last_reminder_sent === lp.date) { skipped++; continue; }

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
  return new Response(summary, { status: 200 });
};

// Netlify scheduled config — runs at minute 0 of every hour.
export const config = {
  schedule: '0 * * * *'
};
