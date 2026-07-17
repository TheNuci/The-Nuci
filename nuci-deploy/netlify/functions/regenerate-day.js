// POST /.netlify/functions/regenerate-day
// body: { answers, checkins, notes, tasksDone, nextDay, planLength, nextDayPlan, lang }
// returns: { day:{title,sub,desc,tasks[]}, insight:string }
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Bad JSON' }) }; }
  const { answers = {}, checkins = [], notes = {}, nextDay = 2, planLength = 7, nextDayPlan = null, lang = 'en' } = b;

  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ day: nextDayPlan || null, insight: defaultInsight(checkins) }) };
  }

  const pet = answers.petName || 'the pet';
  const last = checkins[checkins.length - 1] || {};
  const sys = `You are a companion-animal behaviourist adapting a 7-day plan after a daily check-in.
Return ONLY valid minified JSON with EXACTLY these keys:
{"day":{"title":string,"sub":string,"desc":string,"tasks":[{"title":string,"detail":string}]},"insight":string}
Rules:
- Adapt day ${nextDay} of ${planLength} for ${pet} based on the latest check-in and notes.
- 5-7 tasks. Each task is an object with "title" (short imperative, 3-7 words) and "detail" (one concrete how/why sentence, 12-24 words), specific to the pet. Title 1-3 words, sub 2-4 words, desc one sentence.
- "insight" is one warm, specific sentence (max 22 words) about what the check-in showed and what today changes. Language: ${lang}.`;
  const user = `Answers: ${JSON.stringify(answers)}
Latest check-in: ${JSON.stringify(last)}
All check-ins: ${JSON.stringify(checkins)}
Owner notes: ${JSON.stringify(notes)}
Current planned day ${nextDay}: ${JSON.stringify(nextDayPlan)}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system: sys, messages: [{ role: 'user', content: user }] })
    });
    if (!resp.ok) { console.error('Anthropic', resp.status, await resp.text()); return { statusCode: 200, headers: CORS, body: JSON.stringify({ day: nextDayPlan || null, insight: defaultInsight(checkins) }) }; }
    const data = await resp.json();
    let text = (data.content || []).map(x => x.text || '').join('').trim();
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    let out;
    try { out = JSON.parse(text); } catch (e) { return { statusCode: 200, headers: CORS, body: JSON.stringify({ day: nextDayPlan || null, insight: defaultInsight(checkins) }) }; }
    const day = out.day && typeof out.day === 'object' ? {
      title: s(out.day.title) || (nextDayPlan && nextDayPlan.title) || 'Adapted day',
      sub: s(out.day.sub) || (nextDayPlan && nextDayPlan.sub) || '',
      desc: s(out.day.desc) || (nextDayPlan && nextDayPlan.desc) || '',
      tasks: (Array.isArray(out.day.tasks) && out.day.tasks.length ? out.day.tasks : (nextDayPlan ? nextDayPlan.tasks : [])).slice(0, 7)
    } : (nextDayPlan || null);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ day, insight: s(out.insight) || defaultInsight(checkins) }) };
  } catch (e) {
    console.error('regenerate-day failed', e);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ day: nextDayPlan || null, insight: defaultInsight(checkins) }) };
  }
};
const s = v => (typeof v === 'string' && v.trim()) ? v.trim() : null;
function defaultInsight(checkins) {
  const occ = (checkins || []).filter(c => c && c.occurred === 'Yes');
  if (occ.length >= 2) {
    const a = parseInt(occ[0].freq) || 1, b = parseInt(occ[occ.length - 1].freq) || 1;
    if (b < a) return 'Fewer incidents than when you started - the routine is taking hold.';
  }
  if ((checkins || []).length && checkins[checkins.length - 1].occurred === 'No') return 'A clear day - keep the routine exactly as it is.';
  return 'Consistency is doing the work - keep the routine steady today.';
}
