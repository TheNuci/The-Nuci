// netlify/functions/admin-reset-stats.js
//
// Erases the collected STATISTICS: tracking events (funnel, app opens, check-ins/day,
// signups chart source) and logged client errors. It deliberately does NOT touch user
// accounts, pets, plans, purchases or revenue.
//
// Guarded three ways: the admin key, an explicit confirm:"RESET" in the body, and POST-only.
//
// ⚠️ TABLE NAMES: I could not see track.js / log-error.js / admin-stats.js, so the two
// table names below are a best guess following the app's naming. Before deploying, open
// netlify/functions/track.js and log-error.js and make sure STATS_TABLES matches the
// tables they insert into. If a listed table doesn't exist, the function skips it and
// reports that in the response instead of failing.
const { createClient } = require('@supabase/supabase-js');

const STATS_TABLES = [
  'events',        // <- written by track.js  (verify!)
  'client_errors'  // <- written by log-error.js (verify!)
];

exports.handler = async function(event){
  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }
  let body = {};
  try{ body = JSON.parse(event.body || '{}'); }catch(e){}

  const adminKey = process.env.THE_NUCI_DEBUG_KEY;
  if(!adminKey || body.key !== adminKey){
    return { statusCode: 403, body: JSON.stringify({ error: 'forbidden' }) };
  }
  if(body.confirm !== 'RESET'){
    return { statusCode: 400, body: JSON.stringify({ error: 'missing confirm:"RESET"' }) };
  }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !serviceKey){
    return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured' }) };
  }
  const supa = createClient(url, serviceKey, { auth: { persistSession: false } });

  let deleted = 0;
  const results = {};
  for(const table of STATS_TABLES){
    try{
      // count first so the dashboard can report how much was erased
      const { count, error: cErr } = await supa.from(table).select('*', { count: 'exact', head: true });
      if(cErr){ results[table] = 'skipped: ' + cErr.message; continue; }
      // delete everything; the not-null filter on a column every row has satisfies
      // PostgREST's requirement that DELETE carries a WHERE clause
      const { error: dErr } = await supa.from(table).delete().not('id', 'is', null);
      if(dErr){ results[table] = 'delete failed: ' + dErr.message; continue; }
      deleted += (count || 0);
      results[table] = 'erased ' + (count || 0) + ' rows';
    }catch(e){
      results[table] = 'error: ' + (e && e.message);
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, deleted, results, at: new Date().toISOString() })
  };
};
