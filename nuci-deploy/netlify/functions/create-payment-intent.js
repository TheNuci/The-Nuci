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

// Test mode is granted for exactly ONE reason: the request came from localhost.
//
// The ?teststripe= token that used to unlock it on thenuci.com was removed. Stripe separates
// test from live, but Supabase does not, so a test purchase ran the real code against a real
// profile and converted it permanently. The live domain now has no path into test mode at all.
function isTestHost(event) {
  try {
    const h = event.headers || {};
    const src = h.origin || h.Origin || h.referer || h.Referer || '';
    const host = src ? new URL(src).hostname.toLowerCase() : '';
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
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
    const testMode = isTestHost(event);
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
      // BACK TO CARD ONLY, on purpose.
      //
      // automatic_payment_methods was introduced while chasing the Express Checkout Element,
      // which needed Stripe to evaluate available wallets. That element is gone - the wallet
      // button is now the Payment Request Button, which rides on `card` and works fine here.
      //
      // What automatic_payment_methods also switched on was LINK: the "Secure, fast checkout
      // with Link" header and the optional "Save my information for faster checkout" block
      // with its email field. Card only removes both, leaving exactly the wallet button, the
      // card fields and nothing else. It also keeps every payment redirect-free, so 3-D
      // Secure stays an overlay inside the sheet.
      payment_method_types: ['card'],
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
