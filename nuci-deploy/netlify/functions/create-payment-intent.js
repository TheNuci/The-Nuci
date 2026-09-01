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
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PRICES = {
  single: { full: 995,  discounted: 495, credits: 1, name: 'The Nuci - 1 plan'  },
  triple: { full: 1995, discounted: 995, credits: 3, name: 'The Nuci - 3 plans' }
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  try {
    const body = JSON.parse(event.body || '{}');
    const p = PRICES[body.packageId];
    if (!p) {
      return { statusCode: 400, body: JSON.stringify({ error: 'unknown package' }) };
    }
    const amount = body.discount ? p.discounted : p.full;

    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'eur',
      // Card only (Apple Pay / Google Pay ride on card): no redirect-based methods, so the
      // whole payment - 3-D Secure included - completes inside the in-app sheet without a
      // page navigation. If you later want Klarna/EPS etc., switch to
      // automatic_payment_methods and handle the ?paid=true return_url path too.
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
      body: JSON.stringify({ clientSecret: intent.client_secret, amount, currency: 'eur' })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
