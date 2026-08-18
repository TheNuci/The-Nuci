// The Nuci · Stripe webhook
// Fires when Stripe confirms a payment. On a completed checkout we mark the
// buyer's profile as purchased.
//
// Required environment variables (set in Netlify > Site settings > Environment):
//   SUPABASE_URL                        your project URL, e.g. https://xxxx.supabase.co
//   THE_NUCI_SUPABASE_SERVICE_ROLE_KEY  service_role secret (server-only, bypasses RLS)
//   STRIPE_WEBHOOK_SECRET               signing secret for account 1's webhook (whsec_...)
//   STRIPE_WEBHOOK_SECRET_2             signing secret for account 2's webhook (whsec_...)
//   (No Stripe Secret Key is needed - payments use Payment Links + webhook verification.)
//
// Stripe setup:
//   - In Stripe Dashboard > Developers > Webhooks, add an endpoint:
//       https://thenuci.com/.netlify/functions/stripe-webhook
//     and subscribe to the event: checkout.session.completed
//   - On your Payment Links, enable "collect customer email". The buyer's email is used
//     to match their profile row (profiles.email).

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
// Two Stripe accounts (Slovenia + international) each have their own webhook signing
// secret. We accept either. STRIPE_WEBHOOK_SECRET is the primary; STRIPE_WEBHOOK_SECRET_2
// is the second account. A payment is valid if it verifies against ANY configured secret.
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_WEBHOOK_SECRET_2 = process.env.STRIPE_WEBHOOK_SECRET_2;
// Optional third slot for a TEST-mode webhook, so you can verify the whole billing flow with a
// test card without touching either live secret. Remove or ignore before it matters - live
// payments never verify against a test secret anyway.
const STRIPE_WEBHOOK_SECRET_TEST = process.env.STRIPE_WEBHOOK_SECRET_TEST;

// ---- Verify Stripe signature (so nobody can fake a purchase) ----
function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = {};
  sigHeader.split(',').forEach(kv => {
    const [k, v] = kv.split('=');
    parts[k] = v;
  });
  const t = parts['t'];
  const v1 = parts['v1'];
  if (!t || !v1) return false;
  const signedPayload = `${t}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  // timing-safe compare
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  return res;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }
  if (!SUPABASE_URL || !SERVICE_KEY || (!STRIPE_WEBHOOK_SECRET && !STRIPE_WEBHOOK_SECRET_2 && !STRIPE_WEBHOOK_SECRET_TEST)) {
    return { statusCode: 500, body: 'Missing environment configuration' };
  }

  const rawBody = event.body || '';
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];

  // Valid if the signature matches EITHER account's secret.
  const okSig = verifyStripeSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET)
    || verifyStripeSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET_2)
    || verifyStripeSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET_TEST);
  if (!okSig) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let evt;
  try { evt = JSON.parse(rawBody); }
  catch (e) { return { statusCode: 400, body: 'Bad JSON' }; }

  // We only act on a completed checkout (a real, paid purchase).
  if (evt.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: 'ignored' };
  }

  const session = evt.data && evt.data.object ? evt.data.object : {};
  // Only count if actually paid
  if (session.payment_status && session.payment_status !== 'paid') {
    return { statusCode: 200, body: 'not paid' };
  }

  const email = (session.customer_details && session.customer_details.email)
    || session.customer_email
    || null;
  if (!email) {
    return { statusCode: 200, body: 'no email on session' };
  }

  try {
    // Work out WHAT was bought from the amount Stripe actually charged. Amounts are in cents.
    // Both the normal and the 50%-off links are recognised, so a discounted purchase still
    // grants the right number of plans.
    const cents = typeof session.amount_total === 'number' ? session.amount_total : null;
    const PACKS = [
      { cents: 995,  id: 'single', credits: 1 },
      { cents: 1995, id: 'triple', credits: 3 },
      { cents: 2995, id: 'five',   credits: 5 },   // 5-pack full price
      { cents: 495,  id: 'single', credits: 1 },   // 50% off single
      { cents: 995,  id: 'triple', credits: 3 },   // 50% off triple (same price as full single)
      { cents: 1495, id: 'five',   credits: 5 }    // 50% off five
    ];
    // 995 is ambiguous (full single vs discounted triple). Prefer the single - the safer,
    // smaller grant - unless Stripe tells us otherwise via the link/product name.
    // TODO: the clean fix is to stop matching by amount entirely - put a `credits` value in
    // each Payment Link's metadata (Stripe Dashboard > Payment Link > Metadata) and read
    // session.metadata.credits here. Then discounts and future prices can never mis-grant.
    let pack = null;
    const metaCredits = session.metadata && parseInt(session.metadata.credits, 10);
    if (metaCredits >= 1 && metaCredits <= 10) {
      pack = { id: session.metadata.packageId || 'meta', credits: metaCredits };
    }
    else if (cents === 1995) pack = { id: 'triple', credits: 3 };
    else if (cents === 2995) pack = { id: 'five', credits: 5 };
    else if (cents === 1495) pack = { id: 'five', credits: 5 };
    else if (cents === 495) pack = { id: 'single', credits: 1 };
    else if (cents === 995) pack = { id: 'single', credits: 1 };
    else if (cents != null) {
      const match = PACKS.find(p => p.cents === cents);
      pack = match ? { id: match.id, credits: match.credits } : { id: 'single', credits: 1 };
    } else {
      pack = { id: 'single', credits: 1 };
    }

    // Read the current row so we can ADD to it (and so we can ignore a repeated delivery -
    // Stripe retries an event whenever it doesn't get a 2xx back).
    let row = null;
    try {
      const r = await sb(`profiles?email=eq.${encodeURIComponent(email)}&select=plan_credits,transactions,last_stripe_session`, { method: 'GET' });
      const rows = await r.json();
      row = Array.isArray(rows) && rows.length ? rows[0] : null;
    } catch (e) { row = null; }

    const sessionId = session.id || null;
    if (row && sessionId && row.last_stripe_session === sessionId) {
      return { statusCode: 200, body: 'already processed' };
    }

    const priorCredits = (row && typeof row.plan_credits === 'number') ? row.plan_credits : 0;
    const priorTx = (row && Array.isArray(row.transactions)) ? row.transactions : [];

    const patch = {
      purchased: true,
      plan_credits: priorCredits + pack.credits,
      transactions: priorTx.concat([{
        date: new Date().toISOString(),
        packageId: pack.id,
        price: cents != null ? cents / 100 : null,
        credits: pack.credits,
        sessionId: sessionId
      }]),
      updated_at: new Date().toISOString()
    };
    if (sessionId) patch.last_stripe_session = sessionId;

    if (row) {
      // Profile exists -> update it.
      await sb(`profiles?email=eq.${encodeURIComponent(email)}`, {
        method: 'PATCH',
        headers: { 'Prefer': 'return=minimal' },
        body: JSON.stringify(patch)
      });
    } else {
      // No profile row for this email (buyer used a different email at Stripe checkout, or
      // paid before the app ever wrote their row). A PATCH would match 0 rows, return 200,
      // and the purchase would be recorded NOWHERE. Create the row instead, so the payment
      // is always on record and the credit is granted the moment they sign in with this email.
      const ins = Object.assign({ email: email.toLowerCase(), signup_at: new Date().toISOString() }, patch);
      const insRes = await sb('profiles', {
        method: 'POST',
        headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(ins)
      });
      if (!insRes.ok) {
        const t = await insRes.text().catch(() => '');
        console.error('webhook insert failed', insRes.status, t.slice(0, 200));
        // Non-2xx makes Stripe retry the event, which is what we want here.
        return { statusCode: 500, body: 'insert failed' };
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    return { statusCode: 500, body: 'server error: ' + (e && e.message ? e.message : 'unknown') };
  }
};
