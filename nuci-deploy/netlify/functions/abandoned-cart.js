// netlify/functions/abandoned-cart.js
//
// Scheduled function — runs every 5 minutes (see netlify.toml).
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

const FROM = 'The Nuci <noreply@thenuci.com>';
const MIN_AGE_MIN = 15;     // wait at least 15 minutes after signup
const MAX_AGE_MIN = 180;    // ...but don't nudge people who signed up long ago (3h window)

function escapeHtml(s) {
  return String(s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function emailHtml(petName) {
  const pet = petName ? escapeHtml(petName) : 'your pet';
  const headline = petName ? `${pet} is waiting for your help` : `Your pet is waiting for your help`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#F1F1F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111111;">
  <div style="max-width:440px;margin:0 auto;padding:40px 16px;">
    <div style="background:#FAFAFA;border-radius:20px;padding:36px 32px;text-align:center;">
      <img src="https://thenuci.com/email-logo.png" width="50" height="30" alt="The Nuci" style="display:block;margin:0 auto 18px;border:0;">
      <h1 style="font-size:1.35rem;margin:0 0 14px;font-weight:600;letter-spacing:-0.02em;">${headline}</h1>
      <p style="font-size:0.95rem;line-height:1.65;color:#555;margin:0 0 14px;">
        You're one step away. Unlock ${pet}'s personalized 7-day plan and start understanding the behaviour — its likely causes, what to do, and what to avoid.
      </p>
      <p style="font-size:0.95rem;line-height:1.65;color:#555;margin:0 0 26px;">
        Every behavior has a cause. Let's find ${pet}'s together.
      </p>
      <a href="https://thenuci.com/"
         style="display:inline-block;background:#111111;color:#fff;text-decoration:none;
                padding:14px 32px;border-radius:14px;font-size:0.95rem;font-weight:600;">
        Get ${pet}'s 7-day plan
      </a>
      <p style="font-size:0.74rem;color:#aaa;margin:26px 0 0;line-height:1.5;">
        You started a plan for ${pet} on The Nuci. You can finish anytime.
      </p>
    </div>
    <p style="text-align:center;font-size:12px;color:#aaa;margin:20px 0 0;">The Nuci &middot; Every behavior has a cause</p>
  </div>
</body></html>`;
}

async function sendEmail(apiKey, to, petName) {
  const subject = petName ? `${petName} is waiting for your help 🐾` : `Your pet is waiting for your help 🐾`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html: emailHtml(petName) })
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

  // Candidates: signed up, not purchased, not yet nudged, opted in.
  const url = `${SUPABASE_URL}/rest/v1/profiles` +
    `?select=email,signup_at,pet_name_pending,purchased,cart_nudge_sent,email_reminders` +
    `&signup_at=not.is.null` +
    `&purchased=not.eq.true` +
    `&cart_nudge_sent=not.eq.true` +
    `&email_reminders=not.eq.false`;

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
  let sent = 0, skipped = 0, failed = 0;

  for (const p of profiles) {
    const t = Date.parse(p.signup_at);
    if (isNaN(t)) { skipped++; continue; }
    const ageMin = (now - t) / 60000;
    // Only the 15min–3h window: old enough to count as "didn't buy", not ancient.
    if (ageMin < MIN_AGE_MIN || ageMin > MAX_AGE_MIN) { skipped++; continue; }

    try {
      await sendEmail(RESEND_API_KEY, p.email, p.pet_name_pending);
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(p.email)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json', 'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ cart_nudge_sent: true })
      });
      sent++;
    } catch (e) {
      console.error('Cart nudge failed for', p.email, e.message);
      failed++;
    }
  }

  const summary = `Cart nudge run: sent=${sent} skipped=${skipped} failed=${failed} total=${profiles.length}`;
  console.log(summary);
  return new Response(summary, { status: 200 });
};

// Runs every 5 minutes so the ~15-minute timing is accurate.
export const config = {
  schedule: '*/5 * * * *'
};
