// The Nuci · Generate a vet communication (email or phone script)
// Uses the same Anthropic key as generate-plan. The AI writes in the user's chosen
// language, using the assessment answers. If it needs facts it doesn't have, it returns
// a list of questions instead of a draft, and the frontend asks the user.
//
// Request:  POST {
//   mode: 'email' | 'phone',
//   lang: 'English' | 'Slovenščina' | ...,
//   answers: { ...assessment... },
//   extra: { question: answer, ... }   // user-provided answers to earlier missing-info questions
// }
// Response (draft):   { text: "...", subject: "..."(email only) }
// Response (needs info): { needInfo: [ "question 1", "question 2" ] }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!ANTHROPIC_API_KEY) return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'not_configured' }) };

  let mode, lang, answers, extra;
  try {
    const b = JSON.parse(event.body || '{}');
    mode = b.mode === 'phone' ? 'phone' : 'email';
    lang = (b.lang || 'English').toString().slice(0, 40);
    answers = b.answers || {};
    extra = b.extra || {};
  } catch (e) {
    return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'bad_json' }) };
  }

  const pet = answers.petName || 'the pet';
  const known = JSON.stringify(answers, null, 2);
  const extraKnown = Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '(none)';

  const sys = `You are helping a worried pet owner communicate with a veterinarian about a behaviour or health concern.
Write in this language: ${lang}. Everything you output (including the subject line and any questions) must be in that language.

You have the owner's questionnaire answers and possibly extra details they supplied. Use ONLY facts that are present in that data. Do NOT invent specifics (no made-up dates, medications, weights, temperatures, or symptoms that are not stated).

If a genuinely important fact for a useful vet message is MISSING from the data, do not guess it. Instead return JSON: {"needInfo": ["clear question 1", "clear question 2"]}. Ask only for facts that materially improve the message (max 3 questions). Ask nothing that is already answered in the data.

If you have enough to write a good message, return JSON:
${mode === 'email'
  ? `{"subject": "<short subject line>", "text": "<the full email body>"}
The email should: greet the vet politely, clearly state ${pet}'s species and the concern, give the relevant specifics from the data (duration, frequency, what was observed, any warning signs), mention what the owner has already tried, and politely ask for an appointment or advice. Warm, concise, well-structured. No markdown, plain text with line breaks. Sign off as the owner (leave a name placeholder only if the name is unknown).`
  : `{"text": "<a short spoken script>"}
The script is what the owner will SAY on the phone to book/ask. Keep it short and natural to speak aloud (about 4-6 sentences): who they are, their pet's species and name, the concern in one or two plain sentences with the key specifics (how long, how often, any warning signs), and that they'd like to book an appointment or ask advice. No markdown.`}

Return ONLY the JSON object, nothing else.`;

  const user = `Owner's questionnaire answers (JSON):\n${known}\n\nExtra details the owner provided (JSON):\n${extraKnown}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: sys, messages: [{ role: 'user', content: user }] })
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'ai_' + resp.status, detail: t.slice(0, 200) }) };
    }
    const data = await resp.json();
    let raw = (data.content || []).map(b => b.text || '').join('').trim();
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'parse_fail', detail: raw.slice(0, 200) }) }; }

    return { statusCode: 200, headers: CORS, body: JSON.stringify(parsed) };
  } catch (e) {
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ error: 'exception', detail: String(e && e.message || e) }) };
  }
};
