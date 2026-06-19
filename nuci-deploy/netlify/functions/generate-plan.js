// ═══════════════════════════════════════════════════════════════════
// AI PLAN GENERATION — Netlify serverless function
// ═══════════════════════════════════════════════════════════════════
//
// WHAT THIS IS:
//   A secure backend endpoint that calls the AI (Anthropic Claude) to
//   generate a personalised behaviour plan from the user's assessment
//   answers. The browser NEVER sees your API key — it lives only here
//   as an environment variable on Netlify.
//
// HOW TO ACTIVATE (one-time setup):
//   1. Get an Anthropic API key at https://console.anthropic.com
//   2. In Netlify → Site settings → Environment variables, add:
//          ANTHROPIC_API_KEY = sk-ant-...
//   3. Deploy. This file auto-becomes the endpoint:
//          https://thenuci.com/.netlify/functions/generate-plan
//   4. In the app (pawsense.html), set:
//          const AI_ENDPOINT = '/.netlify/functions/generate-plan';
//      and the app will call this instead of the local template.
//
// COST NOTE: each call costs a fraction of a cent. You pay Anthropic
// directly based on usage. Set usage limits in the Anthropic console.
// ═══════════════════════════════════════════════════════════════════

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'AI key not configured on server' }) };
  }

  let answers, lang;
  try {
    const body = JSON.parse(event.body || '{}');
    answers = body.answers || {};
    lang = body.lang === 'sl' ? 'sl' : 'en';   // default to English
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad request body' }) };
  }

  const langName = lang === 'en' ? 'English' : 'Slovenian';

  // The instruction we give the AI. It must return STRICT JSON only.
  const systemPrompt =
    `You are an expert animal behaviourist creating the START of a personalised ` +
    `7-day behaviour-improvement plan. ` +
    `CRITICAL: Build the ENTIRE plan around the ONE specific problem the owner described ` +
    `(e.g. "dog hates car rides", "cat scratches the sofa", "dog barks at the doorbell"). ` +
    `Every task must visibly relate to THAT exact situation - name the trigger, the place, ` +
    `the object, the context. A reader must immediately see the plan is about THEIR problem, ` +
    `not generic pet advice. If the problem is car travel, tasks involve the car, the route, ` +
    `the crate, short drives, positive associations with the vehicle - never vague "observe your pet". ` +
    `Use the pet's name in at least one task per day. Make day 1 concrete and actionable, not just watching. ` +
    `Address the exact problem described, its triggers and context. No generic filler. Respond in ${langName}. ` +
    `Be CONCISE: tasks are short imperative phrases (max ~10 words each), ` +
    `subtitles max ~6 words, day desc one short sentence. ` +
    `Generate the meta info plus ONLY the FIRST 3 DAYS (day 1 first concrete steps on the problem, ` +
    `day 2 build on it, day 3 first progression). The remaining days are handled ` +
    `separately, so do NOT include them. ` +
    `Return ONLY valid JSON (no markdown, no prose) with this exact shape:\n` +
    `{\n` +
    `  "behaviorExplain": "2 sentence cause for THIS pet and problem",\n` +
    `  "whatNotToDo": ["short mistake to avoid", "...", "...", "..."],\n` +
    `  "causes": ["cause 1", "cause 2", "cause 3"],\n` +
    `  "days": [\n` +
    `    {"title":"short title","sub":"short subtitle","desc":"one short sentence","tasks":["task1","task2","task3","task4","task5"]}\n` +
    `    // EXACTLY 3 entries (day 1, day 2, day 3)\n` +
    `  ]\n` +
    `}`;

  const userPrompt = `Owner intake answers (JSON):\n${JSON.stringify(answers, null, 2)}\n\nCreate the plan that best helps THIS specific pet resolve THIS specific problem.`;

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
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: 'AI request failed', detail: data }) };
    }

    // Extract the text content and parse the JSON the model returned
    const text = (data.content || [])
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    let plan;
    try {
      plan = JSON.parse(text);
    } catch (e) {
      return { statusCode: 502, body: JSON.stringify({ error: 'AI returned non-JSON', raw: text }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan)
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error', detail: String(e) }) };
  }
};
