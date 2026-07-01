// netlify/functions/welcome-email.js
//
// Sends a one-time welcome email when a new user signs up.
// Called from the frontend right after a successful sign-up.
//
// Required Netlify env var:
//   THE_NUCI_RESEND_API_KEY   (re_...)
//
// The Resend key lives only here (server-side), never in index.html.

const FROM = 'The Nuci <noreply@thenuci.com>';

function welcomeHtml(name, toEmail) {
  const unsubUrl = toEmail ? `https://thenuci.com/?unsubscribe=${encodeURIComponent(toEmail)}` : 'https://thenuci.com/';
  const hi = name ? `Welcome, ${name}!` : 'Welcome to The Nuci!';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;background:#F1F1F1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111111;">
  <div style="max-width:440px;margin:0 auto;padding:40px 16px;">
    <div style="background:#FAFAFA;border-radius:20px;padding:36px 32px;text-align:center;">
      <img src="https://thenuci.com/email-logo.png" width="120" height="35" alt="The Nuci" style="display:block;margin:0 auto 16px;border:0;">
      <h1 style="font-size:1.4rem;margin:0 0 12px;font-weight:600;letter-spacing:-0.02em;">${hi}</h1>
      <p style="font-size:0.95rem;line-height:1.6;color:#555;margin:0 0 24px;">
        We're glad you're here. The Nuci helps you understand and improve your pet's behaviour with a personalized 7-day plan and a simple daily check-in.
      </p>
      <div style="text-align:left;background:#fff;border-radius:14px;padding:18px 20px;margin:0 0 24px;">
        <p style="font-size:0.9rem;line-height:1.6;color:#333;margin:0 0 10px;"><strong>How it works:</strong></p>
        <p style="font-size:0.88rem;line-height:1.6;color:#555;margin:0 0 6px;">1. Your AI plan adapts to your pet each day</p>
        <p style="font-size:0.88rem;line-height:1.6;color:#555;margin:0 0 6px;">2. Check in once a day (your window opens at 20:00)</p>
        <p style="font-size:0.88rem;line-height:1.6;color:#555;margin:0;">3. Watch the behaviour improve over the week</p>
      </div>
      <a href="https://thenuci.com/"
         style="display:inline-block;background:#111111;color:#fff;text-decoration:none;
                padding:14px 32px;border-radius:14px;font-size:0.95rem;font-weight:600;">
        Open The Nuci
      </a>
      <p style="font-size:0.78rem;color:#aaa;margin:24px 0 0;line-height:1.5;">
        Every behavior has a cause. Let's find your pet's.
      </p>
    </div>
    <p style="text-align:center;font-size:12px;color:#aaa;margin:20px 0 0;">
      The Nuci &middot; Pet Behaviour &amp; Wellbeing &middot; <a href="https://thenuci.com" style="color:#6B8F71;text-decoration:none;">thenuci.com</a><br><a href="${unsubUrl}" style="color:#aaa;text-decoration:underline;font-size:11px;">Unsubscribe from these emails</a>
    </p>
  </div>
</body></html>`;
}

export default async (req) => {
  const RESEND_API_KEY = process.env.THE_NUCI_RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: 'Email not configured' }), { status: 500 });
  }

  let email, name;
  try {
    const body = await req.json();
    email = (body.email || '').trim();
    name = (body.name || '').trim();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });
  }

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return new Response(JSON.stringify({ error: 'Invalid email' }), { status: 400 });
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM,
        to: [email],
        subject: 'Welcome to The Nuci 🐾',
        html: welcomeHtml(name, email)
      })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return new Response(JSON.stringify({ error: 'Send failed', detail: txt }), { status: 502 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error', detail: String(e) }), { status: 500 });
  }
};
