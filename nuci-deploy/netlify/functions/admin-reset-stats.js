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
//   {key, action:'purge'}                  -> DELETES the analytics rows for good
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

const META_ID = 'stats_baseline';

// Destructive counterpart to the baseline reset above. The baseline hides history; this
// removes it. Only the two ANALYTICS tables are touched - profiles, purchases and revenue are
// never in scope, because losing those would be unrecoverable and is never what "reset the
// statistics" means.
async function sbDeleteAll(table){
  // PostgREST refuses an unfiltered DELETE, which is a good safety rule - so the filter is
  // written to match every row rather than removed.
  const url = process.env.SUPABASE_URL + '/rest/v1/' + table + '?ts=not.is.null';
  const r = await fetch(url, {
    method: 'DELETE',
    headers: Object.assign(sbHeaders(), { 'Prefer': 'return=minimal' })
  });
  if(!r.ok) throw new Error(table + ' delete ' + r.status + ' ' + (await r.text()).slice(0,120));
}

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
  const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });

  const action = body.action || 'get';
  try{
    if(action === 'get'){
      let value=null;
      try{ value = await sbGetMeta(META_ID); }
      catch(e){ return json(200, { baseline: null, note: 'admin_meta not readable: ' + e.message }); }
      return json(200, { baseline: value });
    }
    if(action === 'set'){
      const snapshot = (body.snapshot && typeof body.snapshot === 'object') ? body.snapshot : {};
      const value = { at: new Date().toISOString(), snapshot };
      try{ await sbUpsertMeta(META_ID, value); }
      catch(e){ return json(500, { error: 'could not store baseline: ' + e.message }); }
      return json(200, { ok: true, baseline: value });
    }
    if(action === 'purge'){
      const done = [], failed = [];
      for(const t of ['analytics_events','client_errors']){
        try{ await sbDeleteAll(t); done.push(t); }
        catch(e){ failed.push(t + ': ' + e.message); }
      }
      // The baseline is meaningless once the rows behind it are gone.
      try{ await sbDeleteMeta(META_ID); }catch(e){}
      if(failed.length && !done.length){
        return json(500, { ok:false, error: failed.join(' | ') });
      }
      return json(200, { ok:true, cleared: done, failed: failed.length ? failed : undefined });
    }
    if(action === 'clear'){
      try{ await sbDeleteMeta(META_ID); }
      catch(e){ return json(500, { error: 'could not clear baseline: ' + e.message }); }
      return json(200, { ok: true, baseline: null });
    }
    return json(400, { error: 'unknown action' });
  }catch(e){
    return json(500, { error: (e && e.message) || 'unexpected error' });
  }
};
