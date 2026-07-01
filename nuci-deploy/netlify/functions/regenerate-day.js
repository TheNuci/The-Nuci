// ═══════════════════════════════════════════════════════════════════
// AI DAILY ADAPTATION - Netlify serverless function
// ═══════════════════════════════════════════════════════════════════
//
// WHAT THIS IS:
//   After each daily check-in, this adapts the NEXT day of the plan based
//   on how the pet is actually progressing (did the behaviour occur, how
//   often, triggers, severity, notes). It rewrites the next day's tasks and
//   adds a short personalised insight for the owner.
//
//   The browser never sees the API key - it lives only here as an
//   environment variable on Netlify (ANTHROPIC_API_KEY).
//
// ENDPOINT (after deploy):
//   https://thenuci.com/.netlify/functions/regenerate-day
// ═══════════════════════════════════════════════════════════════════

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return new Response(JSON.stringify({ error: 'AI key not configured on server' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let answers, checkins, nextDay, planLength, lang, nextDayPlan, notes, tasksDone;
  try {
    const body = await req.json();
    answers      = body.answers || {};
    checkins     = Array.isArray(body.checkins) ? body.checkins : [];
    notes        = body.notes || {};           // per-day owner observations
    tasksDone    = body.tasksDone || {};        // per-day completed vs skipped tasks
    nextDay      = body.nextDay || 2;
    planLength   = body.planLength || 7;
    nextDayPlan  = body.nextDayPlan || null;   // current (template/AI) plan for that day
    lang         = body.lang === 'sl' ? 'sl' : 'en';   // default to English
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Bad request body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const langName = 'English';   // app is English-only; always respond in English

  const systemPrompt =
    `You are a highly experienced veterinary behaviourist adjusting an ongoing ${planLength}-day ` +
    `behaviour plan, with the rigour of a clinician and force-free, evidence-based methods. ` +
    `The owner just completed a daily check-in. Based on the check-in history (whether the behaviour ` +
    `occurred, how often, severity, triggers, location, notes) and which tasks they completed vs skipped, ` +
    `adapt DAY ${nextDay} to the pet's actual progress. If things are improving, build on what works and ` +
    `progress faster. If not, adjust the approach and address the persistent trigger; if tasks were ` +
    `skipped, make the next day easier to follow through on. Keep tasks small, concrete, doable in one day. ` +
    `SAFETY BOUNDARIES (critical): if the check-ins show the problem is WORSENING, escalating in severity, ` +
    `involves aggression/biting/injury risk, possible pain or a medical sign, or anything beyond safe ` +
    `self-help, do NOT push harder - keep the day supportive and conservative and use the insight to ` +
    `recommend the owner consult a vet or in-person professional. NEVER recommend aversive, painful or ` +
    `fear-based methods, and NEVER suggest medications, dosages or medical procedures. ` +
    `ALWAYS respond in English, even if the owner's notes are in another language - translate their meaning. ` +
    `Return ONLY valid JSON (no markdown, no prose) with this exact shape:\n` +
    `{\n` +
    `  "insight": "1-2 sentence personalised note to the owner about today's progress and what tomorrow focuses on",\n` +
    `  "day": {"title":"short title","sub":"one-line subtitle","desc":"1-2 sentence focus","tasks":["task1","task2","task3","task4","task5"]}\n` +
    `}`;

  const userPrompt =
    `Owner intake answers:\n${JSON.stringify(answers, null, 2)}\n\n` +
    `Check-in history so far (most recent last):\n${JSON.stringify(checkins, null, 2)}\n\n` +
    `Owner's free-text daily notes/observations (keyed by plan day):\n${JSON.stringify(notes, null, 2)}\n\n` +
    `Which tasks the owner actually completed vs skipped, per day:\n${JSON.stringify(tasksDone, null, 2)}\n\n` +
    `Current planned Day ${nextDay} (may be a generic template):\n${JSON.stringify(nextDayPlan, null, 2)}\n\n` +
    `Adapt Day ${nextDay} to the pet's real progress. Use all three signals together: the check-in history, the owner's daily notes (what actually happened), and which tasks they completed vs skipped. If they skipped tasks, make Day ${nextDay} easier to follow through on or rephrase those tasks; if they completed everything and things improved, progress faster. The notes and completed tasks should directly shape the focus and tasks for Day ${nextDay}.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1200,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'AI request failed', detail: data }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    const text = (data.content || [])
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'AI returned non-JSON', raw: text }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error', detail: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
