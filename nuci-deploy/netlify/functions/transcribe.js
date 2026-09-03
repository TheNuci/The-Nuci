// The Nuci · Speech-to-text (any language, auto-detected)
//
// Receives a short audio clip from the app and returns the transcript.
// Uses OpenAI's transcription API, which supports 99+ languages INCLUDING Slovenian
// and detects the spoken language automatically - the user just talks.
//
// Required environment variable (Netlify > Site settings > Environment):
//   OPENAI_API_KEY   your OpenAI API key (sk-...)
//
// Optional:
//   TRANSCRIBE_MODEL  defaults to 'gpt-4o-mini-transcribe' (cheapest, ~$0.003/min)
//                     alternatives: 'gpt-4o-transcribe', 'whisper-1'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.TRANSCRIBE_MODEL || 'gpt-4o-transcribe';

// Keep clips small - this is short-form voice input, not podcast transcription.
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB - roughly a minute of speech, plenty for one answer

const { rateLimit } = require('./_ratelimit');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  // This is the most expensive endpoint per call (OpenAI audio) and previously the ONLY paid
  // one with no rate limit at all - an easy way for someone to run up the bill.
  const rl = rateLimit(event, { max: 6, windowMs: 60000 });
  if (!rl.ok) return { statusCode: 429, body: JSON.stringify({ error: 'rate_limited' }) };
  // DELIBERATELY OPEN, unlike the other paid endpoints.
  //
  // The microphone is offered inside the questionnaire, which happens BEFORE anyone has an
  // account, so requiring a session here simply broke it ("sign_in_required" on question 3).
  // Since it cannot be closed, it is made small instead: a tighter rate limit and a much
  // lower size cap than the AI endpoints, which between them bound what a script can spend.
  // This is also the cheapest call in the whole app, a fraction of a cent per clip.
  if (!OPENAI_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Transcription is not configured' }) };
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const b64 = payload.audio || '';
    const mime = payload.mime || 'audio/webm';
    // Optional ISO-639-1 language hint (e.g. 'sl', 'en') from the client. Passing it stops the
    // model from confusing similar languages (Slovenian vs Croatian/Serbian, etc). If absent,
    // the model auto-detects.
    const langHint = (typeof payload.language === 'string' && /^[a-z]{2}$/i.test(payload.language))
      ? payload.language.toLowerCase() : '';
    // A softer hint (the caller's device locale). It is NOT forced on the first attempt - it is
    // only used to re-run the transcription if auto-detect returns the wrong script.
    const retryHint = (typeof payload.hint === 'string' && /^[a-z]{2}$/i.test(payload.hint))
      ? payload.hint.toLowerCase() : '';
    if (!b64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No audio provided' }) };
    }

    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > MAX_BYTES) {
      return { statusCode: 413, body: JSON.stringify({ error: 'Recording too long' }) };
    }

    // Pick a sensible filename extension so the API can read the container format
    let ext = 'webm';
    if (mime.includes('mp4')) ext = 'mp4';
    else if (mime.includes('mpeg')) ext = 'mp3';
    else if (mime.includes('wav')) ext = 'wav';
    else if (mime.includes('ogg')) ext = 'ogg';

    const callOpenAI = async (modelName, forceLang) => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mime }), `clip.${ext}`);
      form.append('model', modelName);
      if (forceLang) form.append('language', forceLang);
      form.append('response_format', 'json');
      return fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: form
      });
    };

    let res = await callOpenAI(MODEL, langHint);
    // If the preferred model isn't available on this account, fall back to whisper-1 so the
    // microphone keeps working instead of failing outright.
    if (!res.ok && MODEL !== 'whisper-1') {
      res = await callOpenAI('whisper-1', langHint);
    }

    if (!res.ok) {
      const detail = await res.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Transcription failed', detail: detail.slice(0, 300) })
      };
    }

    let data = await res.json();
    let text = (data.text || '').trim();

    // Auto-detect sometimes mistakes Slovenian for Serbian on short clips, which comes back in
    // Cyrillic. If we got Cyrillic (or Greek) and the caller told us their locale, redo the
    // transcription with that language forced - this reliably brings back Latin script.
    const wrongScript = /[\u0400-\u04FF\u0370-\u03FF]/.test(text);
    if (wrongScript && retryHint && retryHint !== langHint) {
      const res2 = await callOpenAI(MODEL, retryHint);
      if (res2.ok) {
        const d2 = await res2.json();
        const t2 = (d2.text || '').trim();
        if (t2) text = t2;
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', detail: (e && e.message) ? e.message : 'unknown' })
    };
  }
};
