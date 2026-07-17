// POST /.netlify/functions/ask-followup  { question, answers, plan, lang }
// returns { answer, refused }
// Strictly scoped: only factual companion-animal behaviour & care. Refuses anything else.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
const CORS = { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json' };

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode:204, headers:CORS, body:'' };
  if (event.httpMethod !== 'POST') return { statusCode:405, headers:CORS, body:JSON.stringify({error:'Method not allowed'}) };
  let b={}; try{ b=JSON.parse(event.body||'{}'); }catch(e){ return {statusCode:400,headers:CORS,body:JSON.stringify({error:'Bad JSON'})}; }
  const { question='', answers={}, plan='', lang='en' } = b;
  if (!question.trim()) return { statusCode:400, headers:CORS, body:JSON.stringify({error:'No question'}) };

  const OFF_TOPIC = "I can only help with questions about your pet's behaviour, training, and care. Try asking me something about that.";

  if (!ANTHROPIC_API_KEY) {
    return { statusCode:200, headers:CORS, body:JSON.stringify({ answer:'This feature is not configured yet. In the meantime: keep the routine consistent, reward calm behaviour quickly, and avoid the main trigger where you can.' }) };
  }

  const pet = answers.petName || 'the pet';
  const species = answers.petType || 'pet';

  // Strict system prompt: factual animal-behaviour/care ONLY, grounded, no fabrication, refuse off-topic.
  const sys = `You are the in-app assistant for "The Nuci", a companion-animal (pet) behaviour app. You answer ONE follow-up question from the owner of ${pet} (a ${species}).

STRICT SCOPE — you may ONLY answer questions about:
- companion-animal (dog, cat, rabbit, and other common pet) behaviour, training, socialisation, enrichment, and body language
- general pet care, routine, environment, feeding logistics, and welfare as they relate to behaviour
- interpreting or applying this behaviour plan

HARD RULES:
1. If the question is NOT about pet behaviour or pet care (e.g. human topics, medical advice for people, coding, politics, general knowledge, anything unrelated), do NOT answer it. Reply with EXACTLY this sentence and nothing else: "${OFF_TOPIC}"
2. Answer ONLY with established, factual, mainstream animal-behaviour knowledge. Do not speculate, invent studies, cite fake sources, or state uncertain claims as fact. If something is genuinely not known or depends on the individual animal, say so plainly.
3. You are NOT a veterinarian. This is educational behavioural guidance, not veterinary diagnosis or treatment. If the question suggests a medical problem, injury, pain, sudden behaviour change, or safety risk, briefly advise seeing a vet.
4. Never recommend medication, dosages, or medical procedures.
5. Keep it to 2–4 short, practical sentences. Be specific to a ${species} where relevant. Plain text only, no markdown. Language: ${lang}.`;

  const user = `Pet profile: ${JSON.stringify(answers)}
Plan context: ${plan || '(none)'}
Owner's question: ${question}`;

  try{
    const resp = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},
      body:JSON.stringify({ model:MODEL, max_tokens:400, temperature:0.2, system:sys, messages:[{role:'user',content:user}] })});
    if(!resp.ok){ console.error('Anthropic',resp.status,await resp.text()); return {statusCode:200,headers:CORS,body:JSON.stringify({answer:'I could not answer just now. Please try again shortly.'})}; }
    const data=await resp.json();
    const text=(data.content||[]).map(x=>x.text||'').join('').trim();
    const refused = text === OFF_TOPIC;
    return { statusCode:200, headers:CORS, body:JSON.stringify({ answer:text||'Please try rephrasing your question about your pet.', refused }) };
  }catch(e){ console.error('ask-followup failed',e); return {statusCode:200,headers:CORS,body:JSON.stringify({answer:'Could not answer right now.'})}; }
};
