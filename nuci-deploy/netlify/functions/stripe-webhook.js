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
// Test-mode webhook, accepted but FENCED IN (see the livemode guard below). Without a fence
// this secret could grant real credits on a real profile, which is why it was taken out
// entirely for a while.
const STRIPE_WEBHOOK_SECRET_TEST = process.env.STRIPE_WEBHOOK_SECRET_TEST;
// Which addresses a TEST payment is allowed to touch. Anything else is ignored outright, so
// a test card can never convert a paying customer.
//   THE_NUCI_TEST_EMAILS   optional, comma-separated exact addresses
// Any address containing "+test" is always allowed, which is what plus-addressing is for.
function testEmailAllowed(email){
  const e = String(email || '').toLowerCase();
  if (!e) return false;
  if (e.includes('+test')) return true;
  const list = String(process.env.THE_NUCI_TEST_EMAILS || '')
    .split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  return list.includes(e);
}

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

  // TWO shapes of paid event, because there are two ways to pay:
  //   checkout.session.completed  - the hosted Payment Links
  //   payment_intent.succeeded    - the in-app sheet (card, Apple Pay, Google Pay)
  // The sheet creates a PaymentIntent directly and never produces a Checkout Session, so
  // until now NOTHING server-side recorded an in-app purchase: the credit existed only
  // because the browser wrote purchased=true into its own row. That is exactly the write we
  // are about to take away from the client, so this has to land first.
  if (evt.type !== 'checkout.session.completed' && evt.type !== 'payment_intent.succeeded') {
    return { statusCode: 200, body: 'ignored' };
  }

  const obj = evt.data && evt.data.object ? evt.data.object : {};
  // Normalise a PaymentIntent into the same shape the rest of this function already reads.
  const session = (evt.type === 'payment_intent.succeeded')
    ? {
        id: obj.id,                                   // pi_... - dedupe key, same column
        payment_status: obj.status === 'succeeded' ? 'paid' : obj.status,
        amount_total: obj.amount_received != null ? obj.amount_received : obj.amount,
        metadata: obj.metadata || {},                 // create-payment-intent sets packageId/credits/email
        customer_details: { email: (obj.metadata && obj.metadata.email) || obj.receipt_email || null },
        customer_email: obj.receipt_email || null
      }
    : obj;
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

  // ── THE FENCE ──
  // Stripe stamps every event with livemode. A test event may only ever write to an address
  // that is obviously a test address; for anyone else it is acknowledged (so Stripe stops
  // retrying) and then dropped. Without this, a 4242 card could hand a real customer's
  // profile a free week - or, worse, mark your own live account as paid, which is precisely
  // what happened once already.
  if (evt.livemode === false && !testEmailAllowed(email)) {
    console.warn('test-mode event ignored for non-test address');
    return { statusCode: 200, body: 'test event ignored (not a test address)' };
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
