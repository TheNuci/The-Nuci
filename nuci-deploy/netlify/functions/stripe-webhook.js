// The Nuci · Stripe webhook
// Fires when Stripe confirms a payment. On a completed checkout we:
//   1) mark the buyer's profile as purchased
//   2) if the buyer was referred (referred_by set), increment the REFERRER's referral_count
//
// IMPORTANT: referral_count only ever increments here — on a CONFIRMED PURCHASE.
// A signup alone never counts.
//
// Required environment variables (set in Netlify > Site settings > Environment):
//   SUPABASE_URL                        your project URL, e.g. https://xxxx.supabase.co
//   THE_NUCI_SUPABASE_SERVICE_ROLE_KEY  service_role secret (server-only, bypasses RLS)
//   STRIPE_WEBHOOK_SECRET               the signing secret from the Stripe webhook (whsec_...)
//   STRIPE_SECRET_KEY                   your Stripe secret key (sk_live_... or sk_test_...)
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
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

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
  if (!SUPABASE_URL || !SERVICE_KEY || !STRIPE_WEBHOOK_SECRET) {
    return { statusCode: 500, body: 'Missing environment configuration' };
  }

  const rawBody = event.body || '';
  const sig = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];

  if (!verifyStripeSignature(rawBody, sig, STRIPE_WEBHOOK_SECRET)) {
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
    // 1) Load the buyer's profile
    const r = await sb(`profiles?email=eq.${encodeURIComponent(email)}&select=email,purchased,referred_by`);
    const rows = await r.json();
    const profile = Array.isArray(rows) && rows.length ? rows[0] : null;

    // If profile is already purchased, do NOT double-credit the referrer.
    const alreadyPurchased = profile && profile.purchased === true;

    // 2) Mark buyer as purchased
    await sb(`profiles?email=eq.${encodeURIComponent(email)}`, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: JSON.stringify({ purchased: true, updated_at: new Date().toISOString() })
    });

    // 3) Credit the referrer — ONLY on the first purchase, and only if referred
    if (profile && profile.referred_by && !alreadyPurchased) {
      // atomic increment via the SQL function
      await sb(`rpc/increment_referral`, {
        method: 'POST',
        body: JSON.stringify({ referrer_code: profile.referred_by })
      });
    }

    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    return { statusCode: 500, body: 'server error: ' + (e && e.message ? e.message : 'unknown') };
  }
};
