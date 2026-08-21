// netlify/functions/verify-payment.js
//
// Gate for plan unlock: confirms with Stripe that the checkout session in the return URL
// was actually PAID before the app commits a plan. Closes the "?paid=true without paying"
// hole. Uses Stripe's REST API directly (no npm dependency).
//
// Requires:
//   - env STRIPE_SECRET_KEY  (sk_live_...)
//   - env SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (redeem bookkeeping in admin_meta)
//   - each Payment Link's confirmation URL set to:
//       https://thenuci.com/app?paid=true&session_id={CHECKOUT_SESSION_ID}
//
// Rules:
//   - session must exist and have payment_status === 'paid'
//   - session must be recent (created within 2 hours) - an old id can't be replayed later
//   - a session can be redeemed for 2 hours after first redemption (covers refresh/retry
//     on the same return), after that it is dead
// Minimal Supabase REST helper (service_role) - no npm dependency, same pattern as the
// site's other functions. All calls hit PostgREST directly.
function sbHeaders(){
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { 'apikey': k, 'Authorization': 'Bearer ' + k, 'Content-Type': 'application/json' };
}
async function sbGetMeta(id){
  const url = process.env.SUPABASE_URL + '/rest/v1/admin_meta?id=eq.' + encodeURIComponent(id) + '&select=value';
  const r = await fetch(url, { headers: sbHeaders() });
  if(!r.ok) throw new Error('supabase read ' + r.status);
  const rows = await r.json();
  return rows && rows[0] ? rows[0].value : null;
}
async function sbUpsertMeta(id, value){
  const url = process.env.SUPABASE_URL + '/rest/v1/admin_meta?on_conflict=id';
  const r = await fetch(url, { method: 'POST',
    headers: Object.assign(sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify([{ id, value, updated_at: new Date().toISOString() }]) });
  if(!r.ok) throw new Error('supabase upsert ' + r.status);
}
async function sbDeleteMeta(id){
  const url = process.env.SUPABASE_URL + '/rest/v1/admin_meta?id=eq.' + encodeURIComponent(id);
  const r = await fetch(url, { method: 'DELETE', headers: sbHeaders() });
  if(!r.ok) throw new Error('supabase delete ' + r.status);
}

const REDEEM_WINDOW_MS = 2 * 60 * 60 * 1000;   // re-verify allowed this long after first use
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // session itself must be this fresh

exports.handler = async function(event){
  if(event.httpMethod !== 'POST'){
    return json(405, { error: 'POST only' });
  }
  let body = {};
  try{ body = JSON.parse(event.body || '{}'); }catch(e){}
  const sessionId = String(body.session_id || '').trim();
  if(!/^cs_[A-Za-z0-9_]+$/.test(sessionId)){
    return json(200, { verified: false, reason: 'missing or malformed session_id' });
  }

  const sk = process.env.STRIPE_SECRET_KEY;
  if(!sk) return json(500, { error: 'STRIPE_SECRET_KEY not configured' });

  // 1. Ask Stripe about the session
  let sess;
  try{
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(sessionId), {
      headers: { 'Authorization': 'Bearer ' + sk }
    });
    if(r.status === 404) return json(200, { verified: false, reason: 'unknown session' });
    if(!r.ok) return json(502, { error: 'stripe error ' + r.status });
    sess = await r.json();
  }catch(e){
    return json(502, { error: 'stripe unreachable' });
  }

  if(sess.payment_status !== 'paid'){
    return json(200, { verified: false, reason: 'not paid (' + (sess.payment_status || 'unknown') + ')' });
  }
  const createdMs = (sess.created || 0) * 1000;
  if(!createdMs || (Date.now() - createdMs) > SESSION_MAX_AGE_MS){
    return json(200, { verified: false, reason: 'session too old' });
  }

  // 2. Redeem bookkeeping (admin_meta as a small kv store). If this fails we still verify -
  // blocking a real payer over bookkeeping would be worse than allowing a rare replay.
  let redeemNote = null;
  try{
    if(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY){
      const id = 'sess_' + sessionId;
      const existing = await sbGetMeta(id);
      const firstAt = existing && existing.at ? new Date(existing.at).getTime() : null;
      if(firstAt && (Date.now() - firstAt) > REDEEM_WINDOW_MS){
        return json(200, { verified: false, reason: 'session already redeemed' });
      }
      if(!firstAt){
        await sbUpsertMeta(id, { at: new Date().toISOString() });
      }
    } else {
      redeemNote = 'redeem bookkeeping skipped (supabase env missing)';
    }
  }catch(e){
    redeemNote = 'redeem bookkeeping skipped: ' + (e && e.message);
  }

  // 3. Verified. Return the trustworthy facts the app should prefer over anything local.
  const md = sess.metadata || {};
  return json(200, {
    verified: true,
    amount_total: sess.amount_total,           // cents
    currency: sess.currency,
    packageId: md.packageId || null,           // metadata set on the payment links
    credits: md.credits ? parseInt(md.credits, 10) : null,
    customer_email: (sess.customer_details && sess.customer_details.email) || null,
    note: redeemNote
  });
};

function json(code, obj){
  return { statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) };
}
