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

// netlify/functions/welcome-email.js
//
// Sends a one-time welcome email when a new user signs up.
// Called from the frontend right after a successful sign-up.
//
// Required Netlify env var:
//   THE_NUCI_RESEND_API_KEY   (re_...)
//
// The Resend key lives only here (server-side), never in index.html.

const FROM = 'The Nuci <hello@thenuci.com>';

// ── Server-side dedupe (added 2026-08-21) ──
// The welcome trigger now fires from more than one place (confirm.html right after
// verifyOtp - the only moment guaranteed to happen on ANY device/browser - plus the
// app's ?resume=1 path as backup). One email per address, ever, is enforced HERE,
// in admin_meta (kv), so callers can be naive. If the bookkeeping is unreachable we
// still send: a rare duplicate welcome beats a silently missing one.
function sbHeaders(){
  const k = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
  return { 'apikey': k, 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' };
}
async function welcomeAlreadySent(email){
  try{
    if(!process.env.SUPABASE_URL || !process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY) return false;
    const id = 'welcome_' + email.toLowerCase();
    const r = await fetch(process.env.SUPABASE_URL + '/rest/v1/admin_meta?id=eq.' + encodeURIComponent(id) + '&select=id', { headers: sbHeaders() });
    if(!r.ok) return false;
    const rows = await r.json();
    return Array.isArray(rows) && rows.length > 0;
  }catch(e){ return false; }
}
// Also stamp signup_at on the profile at confirm time (2026-08-21): the app only wrote
// it on the immediate-login / ?resume paths - the same fragile chain that broke the
// welcome email - so confirm-flow users had signup_at NULL and the abandoned-cart
// nudges never considered them. Two careful steps so an existing timestamp is NEVER
// reset (that would restart the nudge clock):
//   1. INSERT the row with signup_at only if no row exists yet (ignore-duplicates)
//   2. PATCH signup_at only WHERE it is currently null
async function ensureSignupAt(email){
  try{
    if(!process.env.SUPABASE_URL || !process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY) return;
    const now = new Date().toISOString();
    await fetch(process.env.SUPABASE_URL + '/rest/v1/profiles?on_conflict=email', {
      method:'POST',
      headers: Object.assign(sbHeaders(), { 'Prefer':'resolution=ignore-duplicates,return=minimal' }),
      body: JSON.stringify([{ email, signup_at: now }])
    });
    await fetch(process.env.SUPABASE_URL + '/rest/v1/profiles?email=eq.' + encodeURIComponent(email) + '&signup_at=is.null', {
      method:'PATCH',
      headers: Object.assign(sbHeaders(), { 'Prefer':'return=minimal' }),
      body: JSON.stringify({ signup_at: now })
    });
  }catch(e){}
}
async function markWelcomeSent(email){
  try{
    if(!process.env.SUPABASE_URL || !process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY) return;
    const id = 'welcome_' + email.toLowerCase();
    await fetch(process.env.SUPABASE_URL + '/rest/v1/admin_meta?on_conflict=id', {
      method:'POST',
      headers: Object.assign(sbHeaders(), { 'Prefer':'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify([{ id, value:{ at:new Date().toISOString() }, updated_at:new Date().toISOString() }])
    });
  }catch(e){}
}

function welcomeHtml(name, toEmail) {
  const unsubUrl = toEmail ? `https://thenuci.com/app.html?unsub=all&e=${encodeURIComponent(toEmail)}` : 'https://thenuci.com/';
  return nuciShell({
      preheader: 'Day one of your plan is ready.',
      eyebrow: 'Welcome',
      titleHtml: name ? `Welcome, ${nuciAccent(name)}.` : `Welcome to ${nuciAccent('The Nuci')}.`,
      bodyHtml: nuciPara("Day one of your personalised plan is ready, and it is free. A few small, specific steps: do them, then check in this evening.")
        + nuciPara("That evening check-in is the important habit. It is how each following day gets written around what actually happened.",10)
        + nuciBtn("Open day one","https://thenuci.com/")
        + nuciBox(`<div style="font-family:Georgia,serif;font-style:italic;font-size:15px;color:${NUCI.ink};line-height:1.5">"Every behaviour has a cause."</div><div style="font-size:13px;color:${NUCI.sec};margin-top:6px;font-family:Arial,sans-serif">We'll help you find it, one day at a time.</div>`),
      unsubUrl: unsubUrl
    });
}

export default async (req) => {
  const RESEND_API_KEY = process.env.THE_NUCI_RESEND_API_KEY;

  // Health check: GET ...welcome-email?debug=1&key=SECRET  (and optionally &to=you@email.com)
  // Tells you if the key is present and, with &to=, actually sends a test welcome email.
  // Gated behind THE_NUCI_DEBUG_KEY so strangers can't use it to send emails to anyone.
  try {
    const url = new URL(req.url);
    const DK = process.env.THE_NUCI_DEBUG_KEY;
    if (req.method === 'GET' && url.searchParams.get('debug') === '1' && DK && url.searchParams.get('key') === DK) {
      if (!RESEND_API_KEY) {
        return new Response(JSON.stringify({ ok:false, reason:'THE_NUCI_RESEND_API_KEY missing in Netlify env' }), { status:200, headers:{'Content-Type':'application/json'} });
      }
      const to = url.searchParams.get('to');
      if (!to) {
        return new Response(JSON.stringify({ ok:true, keyPresent:true, note:'Key is set. Add &to=your@email.com to send a real test.' }), { status:200, headers:{'Content-Type':'application/json'} });
      }
      const r = await fetch('https://api.resend.com/emails', {
        method:'POST',
        headers:{ 'Authorization':`Bearer ${RESEND_API_KEY}`, 'Content-Type':'application/json' },
        body: JSON.stringify({ from: FROM, to:[to], subject:'Welcome to The Nuci (test)', html: welcomeHtml('there', to) })
      });
      const txt = await r.text().catch(()=> '');
      return new Response(JSON.stringify({ ok:r.ok, status:r.status, resend:txt.slice(0,400) }), { status:200, headers:{'Content-Type':'application/json'} });
    }
  } catch(e){
    return new Response(JSON.stringify({ ok:false, reason:'debug error', detail:String(e) }), { status:200, headers:{'Content-Type':'application/json'} });
  }

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

  // One welcome per address, ever - regardless of which trigger called us first.
  if (await welcomeAlreadySent(email)) {
    return new Response(JSON.stringify({ ok: true, deduped: true }), { status: 200 });
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
    await markWelcomeSent(email);
    await ensureSignupAt(email);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error', detail: String(e) }), { status: 500 });
  }
};
