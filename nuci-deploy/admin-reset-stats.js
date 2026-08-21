// netlify/functions/admin-reset-stats.js
//
// NON-DESTRUCTIVE statistics reset. Nothing is ever deleted from Supabase.
// "Reset" stores a BASELINE (timestamp + the cumulative totals at that moment) in a tiny
// admin_meta table; the dashboard then shows numbers relative to that baseline and day
// charts from that date on. "Clear" removes the baseline -> the all-time view returns.
//
// One-time setup (Supabase SQL editor):
//   create table if not exists admin_meta (
//     id text primary key,
//     value jsonb,
//     updated_at timestamptz default now()
//   );
//   alter table admin_meta enable row level security;
//   -- no policies on purpose: anon can't touch it, service_role (this function) can.
//
// Actions (POST, guarded by THE_NUCI_DEBUG_KEY):
//   {key, action:'get'}                    -> {baseline: {...}|null}
//   {key, action:'set', snapshot:{...}}    -> stores {at, snapshot}
//   {key, action:'clear'}                  -> removes the baseline
const { createClient } = require('@supabase/supabase-js');

const META_ID = 'stats_baseline';

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

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !serviceKey){
    return { statusCode: 500, body: JSON.stringify({ error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured' }) };
  }
  const supa = createClient(url, serviceKey, { auth: { persistSession: false } });
  const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

  const action = body.action || 'get';
  try{
    if(action === 'get'){
      const { data, error } = await supa.from('admin_meta').select('value').eq('id', META_ID).maybeSingle();
      if(error){
        // most likely the admin_meta table hasn't been created yet - tell the dashboard plainly
        return json(200, { baseline: null, note: 'admin_meta not readable: ' + error.message });
      }
      return json(200, { baseline: (data && data.value) || null });
    }
    if(action === 'set'){
      const snapshot = (body.snapshot && typeof body.snapshot === 'object') ? body.snapshot : {};
      const value = { at: new Date().toISOString(), snapshot };
      const { error } = await supa.from('admin_meta').upsert({ id: META_ID, value, updated_at: new Date().toISOString() });
      if(error) return json(500, { error: 'could not store baseline: ' + error.message });
      return json(200, { ok: true, baseline: value });
    }
    if(action === 'clear'){
      const { error } = await supa.from('admin_meta').delete().eq('id', META_ID);
      if(error) return json(500, { error: 'could not clear baseline: ' + error.message });
      return json(200, { ok: true, baseline: null });
    }
    return json(400, { error: 'unknown action' });
  }catch(e){
    return json(500, { error: (e && e.message) || 'unexpected error' });
  }
};
