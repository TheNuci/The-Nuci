// The Nuci · Educational behaviour tips
//
// Sends occasional, genuinely useful behaviour tips.
//
// GDPR: these are NOT service emails. They go ONLY to people who explicitly ticked
// the optional "Send me behaviour tips" box (profiles.marketing_consent = true).
// Signing up alone is never treated as consent. Every email carries a one-click
// unsubscribe, and withdrawing consent is as easy as giving it (Art. 7(3) GDPR).
//
// Schedule: run at most once every two weeks (Netlify scheduled function or cron).
//
// Required environment variables:
//   SUPABASE_URL
//   THE_NUCI_SUPABASE_SERVICE_ROLE_KEY
//   THE_NUCI_RESEND_API_KEY

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY = process.env.THE_NUCI_RESEND_API_KEY;
const FROM = 'The Nuci <team@thenuci.com>';

const NUCI = { bg:'#F2F1EC', card:'#FBFBF8', text:'#1A211C', sec:'#5C6660', sage:'#6B8F71', forest:'#3E5A47' };

function esc(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// A small library of tips. One is picked per send, cycling by index so nobody
// receives the same tip twice in a row.
const TIPS = [
  {
    eyebrow: 'Behaviour, understood',
    title: 'Why punishment usually backfires',
    body: [
      'When a pet does something we dislike, the instinct is to interrupt it. The problem is that most unwanted behaviour is driven by an underlying state - boredom, fear, or unmet energy - and a telling-off does nothing to that state.',
      'What it does do is add tension to the moment. The behaviour often continues, but now it happens when you are out of the room.',
      'The more reliable move is to change what happens <em>before</em> the behaviour: the trigger, the timing, or what your pet has to do instead.'
    ]
  },
  {
    eyebrow: 'Behaviour, understood',
    title: 'The five-minute rule for a calmer evening',
    body: [
      'Most household flashpoints happen in the same twenty-minute window - usually when someone comes home, or just before food.',
      'A short, predictable activity placed just before that window changes the whole shape of it. Five minutes of sniffing, chewing or slow play is enough to take the edge off.',
      'It works because you are not asking your pet to calm down during the peak. You are lowering the peak before it arrives.'
    ]
  },
  {
    eyebrow: 'Behaviour, understood',
    title: 'What a sudden change usually means',
    body: [
      'Behaviour that appears suddenly, in a pet that was previously settled, deserves a different reading from behaviour that built up slowly.',
      'Sudden onset points at something that changed: a new noise, a new routine, a new person - or discomfort. Pain in particular shows up as irritability, restlessness or avoidance long before it looks like limping.',
      'If something changed in days rather than weeks, a vet check is worth doing before any behavioural work.'
    ]
  },
  {
    eyebrow: 'Behaviour, understood',
    title: 'Consistency beats intensity',
    body: [
      'A short routine done every day outperforms a long one done twice a week - not slightly, but substantially.',
      'Animals read patterns, not effort. Ten minutes at roughly the same time each day tells your pet what the day looks like. An hour on Sunday tells them nothing.',
      'If a plan feels too big to keep up, shrink it until it is easy. The version you actually do is the version that works.'
    ]
  },
  {
    eyebrow: 'Behaviour, understood',
    title: 'Reading the moment before the behaviour',
    body: [
      'Almost every unwanted behaviour has a quiet run-up: a stillness, a fixed stare, a change in breathing, ears moving back.',
      'Learning to see that run-up is the single most useful skill for an owner, because it is the only point where you can change the outcome easily.',
      'Once the behaviour has started, you are managing it. Before it starts, you are preventing it.'
    ]
  }
];

function emailHtml(tip, unsubUrl){
  const paras = tip.body.map(p => `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:${NUCI.text};font-family:Arial,sans-serif">${p}</p>`).join('');
  return `<!doctype html><html><body style="margin:0;padding:0;background:${NUCI.bg}">
  <div style="display:none;max-height:0;overflow:hidden">${esc(tip.title)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${NUCI.bg};padding:28px 14px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${NUCI.card};border-radius:18px;padding:32px 28px">
        <tr><td>
          <p style="margin:0 0 6px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:${NUCI.sage};font-family:Arial,sans-serif">${esc(tip.eyebrow)}</p>
          <h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:${NUCI.text};font-family:Georgia,serif;font-weight:normal">${esc(tip.title)}</h1>
          ${paras}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 0">
            <tr><td style="background:${NUCI.forest};border-radius:14px">
              <a href="https://thenuci.com/" style="display:inline-block;padding:14px 26px;font-family:Arial,sans-serif;font-size:15px;color:#F4F1E9;text-decoration:none;font-weight:bold">Build a plan for your pet</a>
            </td></tr>
          </table>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;padding:18px 6px 0">
        <tr><td>
          <p style="margin:0;font-size:12px;line-height:1.7;color:${NUCI.sec};font-family:Arial,sans-serif">
            The Nuci, behaviour plans for calmer pets. Contact us at <a href="mailto:hello@thenuci.com" style="color:${NUCI.sec}">hello@thenuci.com</a>.
            You are receiving this because you asked for behaviour tips when you signed up.
            <a href="${unsubUrl}" style="color:${NUCI.sage};text-decoration:underline">Unsubscribe</a> - it takes one click and stops these emails immediately.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

async function sendEmail(to, tip){
  const unsubUrl = `https://thenuci.com/app.html?unsub=tips&e=${encodeURIComponent(to)}`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      subject: tip.title,
      html: emailHtml(tip, unsubUrl),
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    })
  });
  return res.ok;
}

exports.handler = async (event) => {
  if (!SUPABASE_URL || !SERVICE_KEY || !RESEND_KEY) {
    return { statusCode: 500, body: 'Missing environment configuration' };
  }

  // ONLY people who gave explicit, separate consent. No exceptions.
  const url = `${SUPABASE_URL}/rest/v1/profiles` +
    `?select=email,marketing_consent,last_tip_sent,tip_index` +
    `&marketing_consent=eq.true`;

  let profiles = [];
  try {
    const r = await fetch(url, { headers: { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` } });
    profiles = await r.json();
  } catch (e) {
    return { statusCode: 500, body: 'Could not read profiles' };
  }
  if (!Array.isArray(profiles)) return { statusCode: 200, body: 'no profiles' };

  const now = Date.now();
  const FORTNIGHT = 14 * 24 * 60 * 60 * 1000;
  let sent = 0;

  for (const p of profiles) {
    if (!p.email) continue;
    // never more often than once a fortnight
    if (p.last_tip_sent && (now - new Date(p.last_tip_sent).getTime()) < FORTNIGHT) continue;

    const idx = Number.isInteger(p.tip_index) ? p.tip_index : 0;
    const tip = TIPS[idx % TIPS.length];

    const ok = await sendEmail(p.email, tip);
    if (!ok) continue;
    sent++;

    try {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(p.email)}`, {
        method: 'PATCH',
        headers: {
          'apikey': SERVICE_KEY,
          'Authorization': `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify({ last_tip_sent: new Date().toISOString(), tip_index: (idx + 1) % TIPS.length })
      });
    } catch (e) { /* non-fatal */ }
  }

  return { statusCode: 200, body: `sent ${sent}` };
};
