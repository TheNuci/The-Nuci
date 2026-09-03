// netlify/functions/_unsubtoken.js
//
// A short signature attached to every unsubscribe link, so a link can be followed but not
// guessed. unsubscribe.js used to accept any address at all, which meant knowing someone's
// email was enough to switch off their emails - including the daily check-ins a paying
// customer is entitled to.
//
// The signature covers the address only, so one token works for every kind of unsubscribe
// link that address receives, and it never expires. Expiry would be worse than useless here:
// people unsubscribe from old emails, and a dead link is exactly what must not happen.
//
// Optional env: THE_NUCI_UNSUB_SECRET. Falls back to the service-role key so the signature
// works without any new configuration; set the dedicated secret if you ever rotate that key.

const crypto = require('crypto');

function unsubSecret() {
  return process.env.THE_NUCI_UNSUB_SECRET
      || process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY
      || process.env.SUPABASE_SERVICE_ROLE_KEY
      || '';
}

function unsubToken(email) {
  const secret = unsubSecret();
  if (!secret) return '';
  return crypto.createHmac('sha256', secret)
    .update(String(email || '').trim().toLowerCase(), 'utf8')
    .digest('hex').slice(0, 24);   // 96 bits is far beyond guessable for this purpose
}

// The full link to put in an email.
function unsubUrl(email, kind) {
  const e = encodeURIComponent(String(email || '').trim().toLowerCase());
  const t = unsubToken(email);
  return 'https://thenuci.com/app.html?unsub=' + encodeURIComponent(kind || 'all')
       + '&e=' + e + (t ? ('&t=' + t) : '');
}

module.exports = { unsubToken, unsubUrl };
