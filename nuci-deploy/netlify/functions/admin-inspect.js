// POST /.netlify/functions/admin-inspect   body: { key: THE_NUCI_DEBUG_KEY, email: "..." }
// Returns a SANITIZED structural view of one profile's data blob - counts, day numbers,
// flags, pet names - so a broken data state can be diagnosed precisely. No answer texts,
// no notes, no photos ever leave the server.

const { rateLimit } = require('./_ratelimit');

const SUPABASE_URL = process.env.THE_NUCI_SUPABASE_URL || 'https://dsuiqkcjfayazzvfwdqk.supabase.co';
const SERVICE_KEY = process.env.THE_NUCI_SUPABASE_SERVICE_ROLE_KEY;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json' };

function petShape(p) {
  if (!p) return null;
  const a = p.answers || {};
  return {
    petName: a.petName || null,
    petType: a.petType || null,
    planStartDate: p.planStartDate || null,
    currentDay: p.currentDay ?? null,
    planLength: p.planLength ?? null,
    planComplete: p.planComplete === true,
    frozenSince: p.frozenSince || null,
    aiPlanDays: (p.aiPlan && Array.isArray(p.aiPlan.days)) ? p.aiPlan.days.length : 0,
    aiPlanDayNulls: (p.aiPlan && Array.isArray(p.aiPlan.days)) ? p.aiPlan.days.filter(d => !d || !d.tasks || !d.tasks.length).length : 0,
    overrideDays: p.planOverrides ? Object.keys(p.planOverrides).map(Number).sort((a,b)=>a-b) : [],
    checkins: Array.isArray(p.checkins) ? p.checkins.map(c => ({ day: c.day, late: !!c.late })) : [],
    lastCheckinDate: p.lastCheckinDate || null,
    hasPhoto: !!p.petPhoto
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'method' }) };
  const rl = rateLimit(event, { max: 15, windowMs: 60000 });
  if (!rl.ok) return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'rate_limited' }) };

  const DK = process.env.THE_NUCI_DEBUG_KEY;
  let key = null, email = null;
  try { const b = JSON.parse(event.body || '{}'); key = String(b.key || ''); email = String(b.email || '').trim().toLowerCase(); } catch (e) {}
  if (!DK || !SERVICE_KEY || key !== DK) return { statusCode: 403, headers: CORS, body: JSON.stringify({ error: 'forbidden' }) };
  if (!email || email.indexOf('@') < 0) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_email' }) };

  const H = { 'apikey': SERVICE_KEY, 'Authorization': 'Bearer ' + SERVICE_KEY };
  const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=*`, { headers: H });
  if (!r.ok) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'fetch', status: r.status }) };
  const rows = await r.json();
  if (!rows.length) return { statusCode: 200, headers: CORS, body: JSON.stringify({ found: false }) };
  const row = rows[0];

  let d = row.data;
  try { if (typeof d === 'string') d = JSON.parse(d); } catch (e) { d = null; }
  d = d || {};

  const out = {
    found: true,
    columns: {
      purchased: row.purchased === true,
      plan_credits: row.plan_credits ?? null,
      transactions: Array.isArray(row.transactions) ? row.transactions.map(t => ({ date: t.date, packageId: t.packageId, price: t.price, credits: t.credits })) : [],
      updated_at: row.updated_at || null,
      last_checkin_date: row.last_checkin_date || null
    },
    blob: {
      savedAt: d.savedAt ? new Date(d.savedAt).toISOString() : null,
      userEmail: d.userEmail || null,
      activePet: d.activePet ?? null,
      plansGenerated: d.plansGenerated ?? null,
      planCredits_inBlob: d.planCredits ?? null,
      purchased_inBlob: d.purchased === true,
      badges: d.badges || [],
      topLevel: petShape(d),
      pets: Array.isArray(d.pets) ? d.pets.map(petShape) : null,
      archive: Array.isArray(d.archive) ? d.archive.map(ar => ({
        petName: (ar.answers && ar.answers.petName) || ar.petName || null,
        petType: (ar.answers && ar.answers.petType) || ar.petType || null,
        completedAt: ar.completedAt || null,
        aiPlanDays: (ar.aiPlan && Array.isArray(ar.aiPlan.days)) ? ar.aiPlan.days.length : 0
      })) : null
    }
  };

  return { statusCode: 200, headers: CORS, body: JSON.stringify(out, null, 2) };
};
