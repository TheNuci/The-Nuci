// ═══════════════════════════════════════════════════════════════════
// AI PLAN GENERATION - Netlify serverless function
// ═══════════════════════════════════════════════════════════════════
//
// WHAT THIS IS:
//   A secure backend endpoint that calls the AI (Anthropic Claude) to
//   generate a personalised behaviour plan from the user's assessment
//   answers. The browser NEVER sees your API key - it lives only here
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

// System prompt for the AI - defined once, reused by the endpoint and self-test.
function buildSystemPrompt(){
  return (
    `You are a highly experienced veterinary behaviourist - the equivalent of a clinician who has ` +
    `spent many years assessing and treating animal behaviour. You combine the rigour of veterinary ` +
    `medicine with practical, force-free, evidence-based behaviour modification (positive reinforcement, ` +
    `desensitisation, counter-conditioning, environmental management). You reason about the likely ` +
    `underlying CAUSE (medical, emotional, environmental, learned), not just the surface symptom, and you ` +
    `build a plan a real behaviourist would be proud to put their name on. ` +

    `UNDERSTAND THE OWNER FIRST: read what they actually wrote and respond to THEIR specific situation. ` +
    `Build the ENTIRE plan around the ONE specific problem they described ` +
    `(e.g. "dog hates car rides", "cat scratches the sofa", "dog barks at the doorbell"). ` +
    `Every task must visibly relate to THAT exact situation - name the trigger, the place, the object, ` +
    `the context. The reader must immediately see the plan is about THEIR problem, not generic advice. ` +
    `Use the pet's name in at least one task per day. Make day 1 concrete and actionable, not just watching. ` +

    `CLEAR BOUNDARIES - CRITICAL FOR SAFETY: ` +
    `(1) You provide behavioural guidance ONLY and are NOT a substitute for an in-person veterinary exam. ` +
    `(2) If the problem may have MEDICAL causes (sudden behaviour change, new or severe aggression, ` +
    `house-soiling in a previously trained pet, excessive licking/self-harm, signs of pain, seizures, ` +
    `disorientation, appetite/weight change, lethargy), you MUST flag that a veterinary medical check is ` +
    `needed FIRST - a behaviour plan cannot fix a medical problem. ` +
    `(3) If the problem is genuinely SERIOUS or beyond safe self-help (severe aggression or bite history, ` +
    `attacks on people/animals, resource guarding with injury risk, severe separation distress with ` +
    `self-injury, any risk to a child or vulnerable person), you MUST recommend a qualified in-person ` +
    `professional and keep the plan supportive and conservative rather than trying to "treat" it remotely. ` +
    `NEVER give advice that could increase the risk of a bite or injury. ` +
    `(4) NEVER recommend aversive, painful or fear-based methods (no shock/prong/choke collars, no "alpha"/ ` +
    `dominance techniques, no punishment-based approaches) - they are outdated and harmful. ` +
    `(5) NEVER suggest medications, dosages, supplements or medical procedures - that is the vet's domain. ` +

    `WATCH INPUT QUALITY: if the owner's answers are contradictory, confusing or don't add up, gently note ` +
    `this and build a careful observation-first plan rather than guessing. If the problem is too complex, ` +
    `specialised or clinical to address responsibly with a 7-day self-help plan, say so honestly and point ` +
    `them to a professional while still giving safe supportive steps. Do not over-promise; be honest that ` +
    `behaviour change takes time and consistency. ` +

    `Use "assessment" to speak directly and warmly to the owner about what you see, honest expectations, ` +
    `and any boundary/safety note. Set "seekProfessional" to true whenever a vet or in-person professional ` +
    `should be involved, and explain why in "professionalNote". ` +

    `ALWAYS respond in English, even if the owner wrote in another language - translate their meaning. ` +
    `Be CONCISE and keep the whole response compact so it is never cut off: ` +
    `behaviorExplain max 2 sentences, assessment max 3 sentences, professionalNote max 2 sentences, ` +
    `each task a short imperative phrase (max ~10 words), subtitles max ~6 words, day desc one short sentence, ` +
    `each day has AT MOST 5 tasks. ` +
    `Generate the meta info plus ONLY the FIRST 3 DAYS (day 1 first concrete steps, day 2 builds, ` +
    `day 3 first progression). The remaining days are handled separately, so do NOT include them. ` +
    `Return ONLY valid JSON. Your entire response MUST start with { and end with } - no preamble, no "Here is", no markdown, no text before or after. Use this exact shape:\n` +
    `{\n` +
    `  "behaviorExplain": "2 sentence likely cause for THIS pet and problem, in plain language",\n` +
    `  "assessment": "2-3 warm sentences to the owner: what you see, honest expectations, any boundary/safety note",\n` +
    `  "seekProfessional": false,\n` +
    `  "professionalNote": "",\n` +
    `  "whatNotToDo": ["short mistake to avoid", "...", "...", "..."],\n` +
    `  "causes": ["cause 1", "cause 2", "cause 3"],\n` +
    `  "days": [\n` +
    `    {"title":"short title","sub":"short subtitle","desc":"one short sentence","tasks":["task1","task2","task3","task4","task5"]}\n` +
    `    // EXACTLY 3 entries (day 1, day 2, day 3)\n` +
    `  ]\n` +
    `}`
  );
}

export default async (req) => {
  const API_KEY = process.env.ANTHROPIC_API_KEY;

  // SELF-TEST: open this function in a browser with ?selftest=1 to see exactly
  // what happens with the AI call - key presence, status, and raw response.
  let selftest = false;
  try{ selftest = new URL(req.url).searchParams.get('selftest') === '1'; }catch(e){}
  if (req.method === 'GET' && selftest) {
    if (!API_KEY) {
      return new Response('SELFTEST: ANTHROPIC_API_KEY is NOT set in Netlify env vars.', { status: 200 });
    }
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 50, messages: [{ role: 'user', content: 'Reply with the single word: OK' }] })
      });
      const raw = await r.text();
      return new Response('SELFTEST status=' + r.status + '\nKEY starts: ' + API_KEY.slice(0,8) + '...\nRAW:\n' + raw, { status: 200 });
    } catch (e) {
      return new Response('SELFTEST fetch threw: ' + String(e), { status: 200 });
    }
  }

  // SELF-TEST 2: ?selftest=2 runs the FULL real plan generation (same prompt,
  // same max_tokens) and reports whether the JSON parses - the real test.
  let selftest2 = false;
  try{ selftest2 = new URL(req.url).searchParams.get('selftest') === '2'; }catch(e){}
  if (req.method === 'GET' && selftest2) {
    if (!API_KEY) return new Response('SELFTEST2: no API key', { status: 200 });
    try {
      const testAnswers = { petName:'Testko', petType:'dog', mainIssue:'dog pees in the house when left alone' };
      const sp = buildSystemPrompt();
      const up = 'Owner intake answers:\n' + JSON.stringify(testAnswers, null, 2);
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 8000, system: sp, messages: [{ role: 'user', content: up }] })
      });
      const data = await r.json();
      let text = (data.content || []).map(b => (b.type==='text'?b.text:'')).join('').replace(/```json|```/g,'').trim();
      const f=text.indexOf('{'), l=text.lastIndexOf('}'); if(f>=0&&l>f) text=text.slice(f,l+1);
      let parsed=null, perr=null;
      try{ parsed=JSON.parse(text); }catch(e){ perr=String(e); }
      return new Response(
        'SELFTEST2 status='+r.status+'\noutput_tokens='+(data.usage&&data.usage.output_tokens)+
        '\nstop_reason='+data.stop_reason+
        '\nJSON parsed: '+(parsed?'YES ✓':'NO ✗ '+perr)+
        '\ndays: '+(parsed&&parsed.days?parsed.days.length:'n/a')+
        '\nday1 title: '+(parsed&&parsed.days&&parsed.days[0]?parsed.days[0].title:'n/a')+
        '\n\nRAW (first 600):\n'+text.slice(0,600), { status: 200 });
    } catch (e) {
      return new Response('SELFTEST2 threw: '+String(e), { status: 200 });
    }
  }

  // Only allow POST for the real endpoint
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  if (!API_KEY) {
    return new Response(JSON.stringify({ error: 'AI key not configured on server' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let answers, lang;
  try {
    const body = await req.json();
    answers = body.answers || {};
    lang = body.lang === 'sl' ? 'sl' : 'en';   // default to English
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Bad request body' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const langName = 'English';   // app is English-only; always respond in English

  // The instruction we give the AI. It must return STRICT JSON only.
  const systemPrompt = buildSystemPrompt();

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
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'AI request failed', detail: data }), { status: 502, headers: { 'Content-Type': 'application/json' } });
    }

    // Extract the text content and parse the JSON the model returned
    let text = (data.content || [])
      .map(b => (b.type === 'text' ? b.text : ''))
      .join('')
      .replace(/```json|```/g, '')
      .trim();
    // If the model wrapped the JSON in any prose, grab the object itself.
    const first = text.indexOf('{'), last = text.lastIndexOf('}');
    if(first >= 0 && last > first) text = text.slice(first, last + 1);

    let plan;
    try {
      plan = JSON.parse(text);
    } catch (e) {
      // Last-resort repair: if the JSON got truncated, try closing open brackets.
      let repaired = null;
      try {
        let t = text;
        // remove a trailing incomplete line and dangling comma
        t = t.replace(/,\s*$/, '').replace(/:\s*"[^"]*$/, ': ""').replace(/,\s*"[^"]*$/, '');
        const opens = (t.match(/\{/g)||[]).length, closes = (t.match(/\}/g)||[]).length;
        const aOpens = (t.match(/\[/g)||[]).length, aCloses = (t.match(/\]/g)||[]).length;
        t += ']'.repeat(Math.max(0, aOpens - aCloses));
        t += '}'.repeat(Math.max(0, opens - closes));
        repaired = JSON.parse(t);
      } catch(_) {}
      if (repaired) {
        plan = repaired;
      } else {
        return new Response(JSON.stringify({ error: 'AI returned non-JSON', raw: text.slice(0,200) }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
    }

    return new Response(JSON.stringify(plan), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Server error', detail: String(e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};
