// POST /.netlify/functions/generate-plan
// body: { answers: {...}, lang: 'en' }
// returns: { behaviorExplain, assessment, seekProfessional, professionalNote, causes[], whatNotToDo[], days[{title,sub,desc,tasks[]}] }
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
const { rateLimit } = require('./_ratelimit');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // ── HEALTH CHECK ──  GET ...generate-plan?debug=1&key=SECRET
  // Tells you, without spending a real plan, whether the AI path is actually working.
  // Gated behind THE_NUCI_DEBUG_KEY: this check makes a REAL (max 5000 token) AI request,
  // so leaving it publicly callable let anyone repeatedly spend Anthropic credit.
  var isDebug = false;
  try {
    var _qp = event.queryStringParameters || {};
    var _dk = process.env.THE_NUCI_DEBUG_KEY;
    var _wants = /[?&]debug=1/.test(event.rawUrl || event.path || '') || _qp.debug === '1';
    isDebug = _wants && !!_dk && _qp.key === _dk;
  } catch(e){}
  if (event.httpMethod === 'GET' && isDebug) {
    if (!ANTHROPIC_API_KEY) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ai: 'DOWN', reason: 'ANTHROPIC_API_KEY is not set in Netlify environment variables', model: MODEL }) };
    }
    try {
      const ping = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 16, messages: [{ role: 'user', content: 'Reply with the single word: ok' }] })
      });
      const txt = await ping.text();
      if (!ping.ok) {
        return { statusCode: 200, headers: CORS, body: JSON.stringify({ ai: 'DOWN', httpStatus: ping.status, model: MODEL, detail: txt.slice(0, 300) }) };
      }
      // Key works. Now run a REAL plan request to confirm it parses (this is where
      // truncation shows up). Uses a tiny sample pet so it is cheap.
      const sample = { petName: 'Test', petType: 'dog', behaviour: 'barking in the evening', warningSigns: [] };
      const debugSys = `You are an expert companion-animal behaviourist. Produce a practical, safe, 7-day behaviour plan. Reply with ONLY valid JSON in this shape: {"behaviorExplain":string,"assessment":string,"seekProfessional":boolean,"professionalNote":string,"causes":string[],"whatNotToDo":string[],"days":[{"title":string,"sub":string,"desc":string,"tasks":[{"title":string,"detail":string}]}]}. days MUST contain exactly 7 items, each with 5-7 tasks.`;
      const testReq = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 5000, system: debugSys, messages: [{ role: 'user', content: 'Owner answers (JSON):\\n' + JSON.stringify(sample) }] })
      });
      const td = await testReq.json();
      const stop = td.stop_reason;
      let raw = (td.content || []).map(b => b.text || '').join('').trim();
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
      // Robust extraction: slice first { to last }.
      let jsonText = raw;
      var _fb = raw.indexOf('{'), _lb = raw.lastIndexOf('}');
      if (_fb > -1 && _lb > _fb) jsonText = raw.slice(_fb, _lb + 1);
      let parses = false, dayCount = 0;
      try { const pj = JSON.parse(jsonText); parses = true; dayCount = (pj.days || []).length; } catch (e) {}
      return { statusCode: 200, headers: CORS, body: JSON.stringify({
        ai: parses ? 'OK' : 'PARSE-FAIL',
        model: MODEL,
        stop_reason: stop,
        truncated: stop === 'max_tokens',
        planParses: parses,
        dayCount: dayCount,
        rawStart: raw.slice(0, 200),
        rawEnd: raw.slice(-200),
        rawLength: raw.length,
        note: parses ? 'Full plan generated and parsed - real plans are AI-generated.'
                     : 'AI responded but the JSON did not parse (likely truncated). Raising max_tokens fixes this.'
      }) };
    } catch (e) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ai: 'DOWN', reason: 'network/exception', detail: String(e && e.message || e) }) };
    }
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Rate limit real generation (protects the Anthropic bill from scripted abuse).
  const rl = rateLimit(event, { max: 12, windowMs: 60000 });
  if (!rl.ok) return { statusCode: 429, headers: CORS, body: JSON.stringify({ error: 'rate_limited', message: 'Too many requests, please wait a moment.' }) };
  // Cap request body size so a huge payload can't be used to run up token costs.
  if ((event.body || '').length > 12000) return { statusCode: 413, headers: CORS, body: JSON.stringify({ error: 'too_large' }) };

  let answers = {}, lang = 'en', previewOnly = false, sorryMessage = false, extend = false, fromDay = 0, days = 0, priorCheckins = null, issue = '';
  try { const b = JSON.parse(event.body || '{}'); answers = b.answers || {}; lang = b.lang || 'en'; previewOnly = !!b.previewOnly; sorryMessage = !!b.sorryMessage; extend = !!b.extend; fromDay = b.fromDay || 0; days = b.days || 0; priorCheckins = b.priorCheckins || null; issue = b.issue || ''; }
  catch (e) { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Bad JSON' }) }; }

  // A short, warm "we're sorry it didn't resolve" note, written around this pet and behaviour,
  // pointing gently toward a vet/behaviourist. Used after the plan was extended once and the
  // behaviour still hasn't shifted.
  if (sorryMessage && ANTHROPIC_API_KEY) {
    try {
      const petNm = answers.petName || 'your pet';
      const sys = `You are a warm, honest companion-animal behaviourist writing to a pet owner whose ${answers.petType || 'pet'} "${petNm}" has been through a full behaviour plan plus a 3-day extension, and the issue ("${issue || answers.mainIssue || 'the behaviour'}") still hasn't resolved.
Write ONE short paragraph (55-80 words), second person, addressed to the owner. Acknowledge their effort and ${petNm} by name, express genuine care that it hasn't worked yet, and explain simply that some behaviours have medical or deeper roots that need an in-person professional (a vet or qualified behaviourist) who can build on what they've already tracked. Do NOT be clinical or cold, do NOT use bullet points, do NOT use an em dash. Return ONLY the paragraph text, no quotes, no preamble.`;
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 400, system: sys, messages: [{ role: 'user', content: 'Owner + checkin context (JSON): ' + JSON.stringify({ answers: answers, priorCheckins: priorCheckins }).slice(0, 4000) }] })
      });
      if (r.ok) {
        const j = await r.json();
        const txt = (j.content || []).map(c => c.text || '').join('').trim();
        if (txt) return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: txt }) };
      }
    } catch (e) { /* fall through to a generic message */ }
    const petNm = answers.petName || 'your pet';
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ message: 'We\u2019re genuinely sorry the plan didn\u2019t bring the change you and ' + petNm + ' were hoping for. Some behaviours have deeper or medical roots that need a professional who can assess ' + petNm + ' in person and build on everything you\u2019ve tracked here.' }) };
  }

  if (!ANTHROPIC_API_KEY) {
    // graceful fallback so the app still works without a key - flagged so we can tell.
    const fb = fallbackPlan(answers); fb._fallback = 'no-api-key';
    return { statusCode: 200, headers: CORS, body: JSON.stringify(fb) };
  }

  const pet = answers.petName || 'the pet';
  // Preview mode: generate ONLY day 1 (plus the short explanation the preview shows). This
  // is ~7x less text than the full plan, so it returns in a couple of seconds instead of ~10.
  // The full 7-day plan is generated after payment, on the "generating" screen.
  const sys = previewOnly ? `You are an expert companion-animal behaviourist. Produce just the FIRST day of a 7-day behaviour plan, as a teaser.
Return ONLY valid minified JSON (no markdown, no preamble) with EXACTLY these keys:
{"behaviorExplain":string,"causes":string[],"days":[{"title":string,"sub":string,"desc":string,"tasks":[{"title":string,"detail":string}]}]}
Rules:
- "days" MUST contain EXACTLY 1 item (day 1 only). It MUST have 5-6 tasks.
- Each task is an OBJECT: "title" is a short imperative action (3-7 words), "detail" is one concrete sentence explaining HOW or WHY (12-24 words), specific to this pet and issue.
- "title" is 1-3 words, "sub" a 2-4 word tag, "desc" one sentence.
- "behaviorExplain": 1-2 sentences on what is likely going on. "causes": 2-4 likely causes.
- Be specific to ${pet}. Language: ${lang}.
- Never use em-dashes or en-dashes (— or –). Use a hyphen (-), comma, or full stop.` : `You are an expert companion-animal behaviourist. Produce a practical, safe, 7-day behaviour plan.
Return ONLY valid minified JSON (no markdown, no preamble) with EXACTLY these keys:
{"behaviorExplain":string,"assessment":string,"seekProfessional":boolean,"professionalNote":string,"causes":string[],"whatNotToDo":string[],"days":[{"title":string,"sub":string,"desc":string,"tasks":[{"title":string,"detail":string}]}]}
Rules:
- "days" MUST contain exactly 7 items (day 1..7). Each day MUST have 4-5 tasks.
- Each task is an OBJECT: "title" is a short imperative action (3-7 words), "detail" is one concise sentence (10-18 words) on HOW or WHY, specific to this pet and issue.
- Titles are 1-3 words. "sub" is a 2-4 word tag. "desc" is one sentence.
- If any warning sign suggests a medical issue (aggression/biting, not eating or drinking, lethargy, vomiting/diarrhea), set seekProfessional=true and explain briefly in professionalNote.
- "causes": 2-3 likely causes. "whatNotToDo": 2-3 concise items. Keep behaviorExplain to 2 sentences.
- Base everything on the owner's answers. Be specific to ${pet}. Language: ${lang}.
- Never use em-dashes or en-dashes (— or –) anywhere in your output. Use a normal hyphen (-), a comma, or a full stop instead.`;

  const user = `Owner's answers (JSON):\n${JSON.stringify(answers, null, 2)}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: previewOnly ? 1500 : 5000, system: sys, messages: [{ role: 'user', content: user }] })
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error('Anthropic error', resp.status, t);
      const fb = fallbackPlan(answers); fb._fallback = 'api-error-' + resp.status;
      return { statusCode: 200, headers: CORS, body: JSON.stringify(fb) };
    }
    const data = await resp.json();
    let text = (data.content || []).map(b => b.text || '').join('').trim();
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    // The model sometimes wraps the JSON in a sentence ("Here is the plan: {...}") or adds a
    // trailing note, which makes a whole-string JSON.parse fail even though valid JSON is present.
    // Slice from the first "{" to the last "}" so surrounding prose is ignored.
    let plan;
    let jsonText = text;
    var _fb = text.indexOf('{'), _lb = text.lastIndexOf('}');
    if (_fb > 0 || (_lb > -1 && _lb < text.length - 1)) {
      if (_fb > -1 && _lb > _fb) jsonText = text.slice(_fb, _lb + 1);
    }
    try { plan = JSON.parse(jsonText); }
    catch (e) {
      // last resort: try the original text too
      try { plan = JSON.parse(text); }
      catch (e2) { console.error('Parse fail', text.slice(0, 300)); const fb = fallbackPlan(answers); fb._fallback = 'parse-fail'; return { statusCode: 200, headers: CORS, body: JSON.stringify(fb) }; }
    }
    plan = normalize(plan, answers);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(plan) };
  } catch (e) {
    console.error('generate-plan failed', e);
    const fb = fallbackPlan(answers); fb._fallback = 'exception';
    return { statusCode: 200, headers: CORS, body: JSON.stringify(fb) };
  }
};

function normalize(plan, answers) {
  const fb = fallbackPlan(answers);
  const out = {
    behaviorExplain: str(plan.behaviorExplain) || fb.behaviorExplain,
    assessment: str(plan.assessment) || fb.assessment,
    seekProfessional: !!plan.seekProfessional,
    professionalNote: str(plan.professionalNote) || '',
    causes: arr(plan.causes) || fb.causes,
    whatNotToDo: arr(plan.whatNotToDo) || fb.whatNotToDo,
    days: Array.isArray(plan.days) ? plan.days.slice(0, 7).map((d, i) => ({
      title: str(d.title) || fb.days[i].title,
      sub: str(d.sub) || fb.days[i].sub,
      desc: str(d.desc) || fb.days[i].desc,
      tasks: normTasks(d.tasks, fb.days[i].tasks)
    })) : fb.days
  };
  while (out.days.length < 7) out.days.push(fb.days[out.days.length]);
  return out;
}
function normTasks(t, fbTasks){
  if(!Array.isArray(t) || !t.length) return fbTasks;
  const out = t.slice(0,7).map(function(x){
    if(x && typeof x === 'object'){ const title=str(x.title)||str(x.task)||str(x.label); if(!title) return null; return {title:title, detail:str(x.detail)||str(x.how)||str(x.why)||''}; }
    const title=str(x); return title?{title:title, detail:''}:null;
  }).filter(Boolean);
  return out.length? out : fbTasks;
}
const str = v => (typeof v === 'string' && v.trim()) ? v.trim() : null;
const arr = v => (Array.isArray(v) && v.length) ? v.filter(x => typeof x === 'string' && x.trim()) : null;

function fallbackPlan(a) {
  const pet = (a && a.petName) || 'your pet';
  const warn = Array.isArray(a && a.warningSigns) ? a.warningSigns : [];
  const medical = warn.some(w => /aggress|eating|drinking|letharg|vomit|diarr/i.test(w));
  return {
    behaviorExplain: `Most behaviour changes in ${pet} come from a shift in routine, environment or an unmet need. This week focuses on observing the pattern, then gently reshaping it.`,
    assessment: `Based on what you described, this looks like a manageable behaviour pattern that responds well to consistent routines and positive reinforcement.`,
    seekProfessional: medical,
    professionalNote: medical ? `Some of the signs you selected can have a medical cause. Please have ${pet} checked by a vet alongside this plan.` : '',
    causes: ['Recent change in routine or environment', 'An unmet need (stimulation, security or comfort)', 'A learned response that gets reinforced unintentionally'],
    whatNotToDo: ['Punish after the fact - it increases anxiety', 'Change several things at once', 'Give up if progress is gradual'],
    days: [
      { title: 'Foundation', sub: 'Observe the pattern', desc: 'Watch closely and note what triggers the behaviour.', tasks: [
        { title: 'Log every incident today', detail: 'Note the time, place and what '+pet+' was doing each time the behaviour happens - patterns appear fast.' },
        { title: 'Record the trigger', detail: 'Write down what happened in the 30 seconds right before, so you can spot the real cause.' },
        { title: 'Keep the day identical', detail: 'Change nothing else today; a stable baseline makes the next changes easier to measure.' },
        { title: 'Prepare a reward '+pet+' loves', detail: 'Pick a small treat or toy you will use only for calm behaviour this week.' },
        { title: 'Set a calm zone', detail: 'Choose one quiet spot '+pet+' can retreat to, away from the main trigger.' },
        { title: 'Note energy and mood', detail: 'A quick morning and evening note on mood helps link behaviour to sleep, food or activity.' } ] },
      { title: 'Build calm', sub: 'First changes', desc: 'Introduce the first calming routine.', tasks: [
        { title: 'Fix one feeding time', detail: 'Feed '+pet+' at the same time today; predictable routines lower baseline stress.' },
        { title: 'Add a 10-minute enrichment session', detail: 'Sniffing, gentle play or a puzzle drains nervous energy that often fuels the behaviour.' },
        { title: 'Reward the first calm moment', detail: 'The instant '+pet+' settles, reward within two seconds so the link is clear.' },
        { title: 'Keep logging incidents', detail: 'Continue yesterday\u2019s log so you can compare intensity day to day.' },
        { title: 'Shorten exposure to the trigger', detail: 'Where you can, reduce how long '+pet+' faces the trigger today.' },
        { title: 'End the day with quiet time', detail: 'Ten calm minutes before sleep helps '+pet+' wind down and reset.' } ] },
      { title: 'First progress', sub: 'Reinforce', desc: 'Repeat what helped and reward generously.', tasks: [
        { title: 'Repeat the calming routine', detail: 'Do exactly what worked yesterday; repetition is what turns it into a habit.' },
        { title: 'Reward immediately after calm', detail: 'Timing matters more than size - a fast small reward beats a slow big one.' },
        { title: 'Avoid the main trigger where possible', detail: 'Give '+pet+'\u2019s nervous system a lighter day to recover.' },
        { title: 'Note any change in intensity', detail: 'Even a small drop means the plan is working - write it down.' },
        { title: 'Practise one calm cue', detail: 'Pair a soft word or hand signal with calm so you can use it later.' },
        { title: 'Keep the reward special', detail: 'Only use the chosen reward for calm behaviour so it keeps its value.' } ] },
      { title: 'Reinforce', sub: 'Make it stick', desc: 'Consistency turns change into habit.', tasks: [
        { title: 'Same routine, same times', detail: 'Consistency this week is what locks in the change - keep the timings steady.' },
        { title: 'Increase rewards for good moments', detail: 'Catch '+pet+' being calm more often today and reward each time.' },
        { title: 'Introduce the trigger briefly and calmly', detail: 'A short, low-intensity exposure while '+pet+' is relaxed builds tolerance safely.' },
        { title: 'Reward the calm response', detail: 'If '+pet+' stays settled during the trigger, reward instantly.' },
        { title: 'Note the reaction', detail: 'Record how '+pet+' handled the trigger so you can adjust tomorrow.' },
        { title: 'Protect rest and sleep', detail: 'A well-rested pet copes far better with triggers.' } ] },
      { title: 'Challenge', sub: 'Test gently', desc: 'A controlled test of the situation.', tasks: [
        { title: 'Recreate the trigger in a mild form', detail: 'Set up a gentle version you fully control, so you can stop any time.' },
        { title: 'Reward the calm response instantly', detail: 'Mark and reward the moment '+pet+' chooses calm over reacting.' },
        { title: 'Stop early if stress appears', detail: 'Ending before '+pet+' is overwhelmed keeps the progress intact.' },
        { title: 'Note how far you got', detail: 'Record the distance, duration or intensity '+pet+' handled today.' },
        { title: 'Finish on a win', detail: 'End every session with something easy so '+pet+' feels successful.' },
        { title: 'Decompress afterwards', detail: 'Give '+pet+' quiet time to settle after the challenge.' } ] },
      { title: 'Consolidate', sub: 'Lock it in', desc: 'Repeat the successful pattern.', tasks: [
        { title: 'Repeat the successful setup from day 5', detail: 'Do the version that worked, exactly the same way, to strengthen it.' },
        { title: 'Keep rewards frequent', detail: 'Don\u2019t fade rewards yet - the habit is still forming.' },
        { title: 'Let '+pet+' set the pace', detail: 'If '+pet+' seems ready for more, add a little; if not, hold steady.' },
        { title: 'Compare with day 1', detail: 'Look back at your first log - seeing the change keeps you motivated.' },
        { title: 'Reinforce the calm cue', detail: 'Use your calm word or signal and reward the response.' },
        { title: 'Note what works best', detail: 'Write down the one or two things that help '+pet+' most.' } ] },
      { title: 'New normal', sub: 'Life after', desc: 'Keep the wins and plan ahead.', tasks: [
        { title: 'Run the full new routine start to finish', detail: 'Do the whole day the new way to prove it has become normal.' },
        { title: 'Celebrate the progress', detail: 'Mark how far you and '+pet+' have come - it matters.' },
        { title: 'Write down what worked best', detail: 'Keep a short summary you can return to if the behaviour ever returns.' },
        { title: 'Decide what to keep weekly', detail: 'Choose the routines worth keeping so the change lasts.' },
        { title: 'Plan for setbacks', detail: 'Know which two steps to repeat if a hard day happens.' },
        { title: 'Keep the calm zone', detail: 'Leave '+pet+'\u2019s retreat spot in place for ongoing security.' } ] }
    ]
  };
}
