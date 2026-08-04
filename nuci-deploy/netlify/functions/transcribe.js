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
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
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

    const callOpenAI = async (modelName) => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: mime }), `clip.${ext}`);
      form.append('model', modelName);
      // Pass the language hint only when the client explicitly sent one; otherwise let the
      // model auto-detect. (Never guess from the phone's locale - an English phone would then
      // force English on Slovenian speech.)
      if (langHint) form.append('language', langHint);
      form.append('response_format', 'json');
      return fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
        body: form
      });
    };

    let res = await callOpenAI(MODEL);
    // If the preferred model isn't available on this account, fall back to whisper-1 so the
    // microphone keeps working instead of failing outright.
    if (!res.ok && MODEL !== 'whisper-1') {
      res = await callOpenAI('whisper-1');
    }

    if (!res.ok) {
      const detail = await res.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'Transcription failed', detail: detail.slice(0, 300) })
      };
    }

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: (data.text || '').trim() })
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', detail: (e && e.message) ? e.message : 'unknown' })
    };
  }
};
