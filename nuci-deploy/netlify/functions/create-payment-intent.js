// netlify/functions/create-payment-intent.js
// Companion to the in-app payment sheet in app.html (openEmbeddedPay).
//
// Setup:
//   1. `npm i stripe` in the site repo (if not already a dependency of your other functions)
//   2. Netlify -> Site settings -> Environment variables -> STRIPE_SECRET_KEY = sk_live_...
//      (same Stripe account as the payment links)
//   3. In app.html set STRIPE_PK = 'pk_live_...'
//
// Prices live HERE, server-side. The client only ever sends a package id and a discount
// flag - never an amount - so the sheet cannot be tampered with into paying less.
// ── LIVE ON THE REAL DOMAIN, TEST EVERYWHERE ELSE ──
// The mode is decided from the request's Origin/Referer host, mirroring the rule in app.html
// exactly. It is deliberately NOT a field in the request body: the client must not be able to
// ask for test mode, or someone on thenuci.com could pay with a test card and get a real plan.
//
// Netlify env vars:
//   STRIPE_SECRET_KEY        sk_live_...  (already set)
//   STRIPE_SECERET_KEY_TEST  sk_test_...  (the name in Netlify, typo and all)
// Both spellings of the test name are accepted below, so renaming it later breaks nothing.
const Stripe = require('stripe');

// Test mode is granted for exactly two reasons, and a request body alone is never one of
// them on its own: the token must MATCH the secret that only Netlify holds.
function wantsTestMode(event, body) {
  const secret = process.env.THE_NUCI_DEBUG_KEY;
  if (secret && body && typeof body.testToken === 'string' && body.testToken === secret) return true;
  return isTestHost(event);
}

function isTestHost(event) {
  try {
    const h = event.headers || {};
    const src = h.origin || h.Origin || h.referer || h.Referer || '';
    const host = src ? new URL(src).hostname.toLowerCase() : '';
    return host === 'localhost' || host === '127.0.0.1' || host === '::1'
        || host.endsWith('.netlify.app') || host.endsWith('.netlify.live');
  } catch (e) {
    return false;   // unreadable origin -> live, never the permissive direction
  }
}

const PRICES = {
  single: { full: 995,  discounted: 495, credits: 1, name: 'The Nuci - 1 plan'  },
  triple: { full: 1995, discounted: 995, credits: 3, name: 'The Nuci - 3 plans' }
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const body0 = (() => { try { return JSON.parse(event.body || '{}'); } catch (e) { return {}; } })();
    const testMode = wantsTestMode(event, body0);
    const testKey = process.env.STRIPE_SECERET_KEY_TEST   // current name in Netlify
                 || process.env.STRIPE_SECRET_KEY_TEST;    // correctly spelled, if renamed
    const key = testMode ? testKey : process.env.STRIPE_SECRET_KEY;
    if (!key) {
      return { statusCode: 500, body: JSON.stringify({ error: testMode ? 'test secret key not set in Netlify' : 'STRIPE_SECRET_KEY not set' }) };
    }
    const stripe = Stripe(key);
    const body = body0;
    const p = PRICES[body.packageId];
    if (!p) {
      return { statusCode: 400, body: JSON.stringify({ error: 'unknown package' }) };
    }
    const amount = body.discount ? p.discounted : p.full;

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'eur',
      // WHY automatic_payment_methods AND NOT payment_method_types: ['card'].
      //
      // Apple Pay and Google Pay do settle as card payments, so `['card']` looks like it should
      // cover them - and for the Payment Element it does, because that element draws the card
      // form itself. The Express Checkout Element is different: it asks Stripe which one-click
      // methods are available for this intent, and listing payment_method_types explicitly
      // turns dynamic payment methods OFF. With nothing to evaluate it renders no buttons and
      // fires no events at all - not even loaderror - which is exactly the silence we chased.
      //
      // allow_redirects:'never' keeps the original intent of this function: redirect-based
      // methods (Klarna, EPS, iDEAL...) are filtered out, so the whole payment including 3-D
      // Secure still completes inside the in-app sheet with no page navigation, and no
      // return_url is required. Which wallets appear is now governed by
      // Dashboard -> Settings -> Payment methods.
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      receipt_email: body.email || undefined,
      description: p.name,
      metadata: {
        packageId: body.packageId,
        credits: String(p.credits),
        discount: body.discount ? '1' : '0',
        email: body.email || ''
      }
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientSecret: intent.client_secret, amount, currency: 'eur', testMode })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
