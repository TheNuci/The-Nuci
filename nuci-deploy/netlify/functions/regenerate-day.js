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

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'AI key not configured on server' }) };
  }

  let answers, checkins, nextDay, planLength, lang, nextDayPlan, notes;
  try {
    const body = JSON.parse(event.body || '{}');
    answers      = body.answers || {};
    checkins     = Array.isArray(body.checkins) ? body.checkins : [];
    notes        = body.notes || {};           // per-day owner observations
    nextDay      = body.nextDay || 2;
    planLength   = body.planLength || 7;
    nextDayPlan  = body.nextDayPlan || null;   // current (template/AI) plan for that day
    lang         = body.lang === 'sl' ? 'sl' : 'en';   // default to English
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request body' }) };
  }

  const langName = lang === 'en' ? 'English' : 'Slovenian';

  const systemPrompt =
    `You are an expert animal behaviourist adjusting an ongoing ${planLength}-day ` +
    `behaviour plan. The owner just completed a daily check-in. Based on the ` +
    `check-in history (whether the behaviour occurred, how often, severity, ` +
    `triggers, location, notes), adapt DAY ${nextDay} so it responds to the ` +
    `pet's actual progress. If things are improving, build on what works and ` +
    `progress faster. If not, adjust the approach and address the persistent ` +
    `trigger. Keep tasks small, concrete, and doable in one day. ` +
    `Respond in ${langName}. ` +
    `Return ONLY valid JSON (no markdown, no prose) with this exact shape:\n` +
    `{\n` +
    `  "insight": "1-2 sentence personalised note to the owner about today's progress and what tomorrow focuses on",\n` +
    `  "day": {"title":"short title","sub":"one-line subtitle","desc":"1-2 sentence focus","tasks":["task1","task2","task3","task4","task5"]}\n` +
    `}`;

  const userPrompt =
    `Owner intake answers:\n${JSON.stringify(answers, null, 2)}\n\n` +
    `Check-in history so far (most recent last):\n${JSON.stringify(checkins, null, 2)}\n\n` +
    `Owner's free-text daily notes/observations (keyed by plan day):\n${JSON.stringify(notes, null, 2)}\n\n` +
    `Current planned Day ${nextDay} (may be a generic template):\n${JSON.stringify(nextDayPlan, null, 2)}\n\n` +
    `Adapt Day ${nextDay} to the pet's real progress. Pay close attention to the owner's daily notes - they describe what actually happened and should directly shape the tasks and focus for Day ${nextDay}.`;

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
      return { statusCode: 502, body: JSON.stringify({ error: 'AI request failed', detail: data }) };
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
      return { statusCode: 502, body: JSON.stringify({ error: 'AI returned non-JSON', raw: text }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error', detail: String(e) }) };
  }
};
