// Optional AI coach (Google Gemini, bring-your-own-key).
// The key lives only in this browser's localStorage and is sent only to Google.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
// Lite models answer fast and are rarely overloaded on the free tier; bigger ones are the backup.
const FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-flash-latest'];
const TIMEOUT_MS = 25000;

const LEARNER = `The learner is a Brazilian adult, native Portuguese speaker, around A2-B1 in English,
who wants to work with AI (AI engineering, automation, AI products), possibly abroad. He has little time.`;

async function call(model, key, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    const err = new Error(e.name === 'AbortError' ? 'A IA demorou demais para responder.' : 'Sem conexão com a IA.');
    err.status = 503;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('Resposta vazia da IA.');
  return text;
}

async function generate({ key, model, system, contents, json = false }) {
  if (!key) throw new Error('Cole sua chave grátis do Gemini em Ajustes para usar o Coach IA.');
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.7, ...(json ? { responseMimeType: 'application/json' } : {}) },
  };
  const models = [model, ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  let lastErr;
  for (const m of models) {
    try {
      return await call(m, key, body);
    } catch (e) {
      lastErr = e;
      // 404 = model retired, 429/503 = busy or slow: try the next model. Anything else (bad key) is final.
      if (![404, 429, 500, 503].includes(e.status)) break;
    }
  }
  throw lastErr;
}

export async function chatReply({ key, model, scenario, history }) {
  const system = `${scenario}
${LEARNER}
Rules:
- Speak simple, natural English (B1). Max 2 short sentences, then ONE question to keep the conversation going.
- If the learner's last message has mistakes, add a final line that starts with "✏️ " written in Brazilian Portuguese,
  showing the corrected sentence and a 1-line explanation. Only the 1-2 most important mistakes. If it was correct, no ✏️ line.
- If the learner writes in Portuguese, answer in English and show how to say it in English in the ✏️ line.
- Plain text only. You may use **bold** for corrected words, nothing else.`;
  const contents = history.map((m) => ({ role: m.role === 'ai' ? 'model' : 'user', parts: [{ text: m.text }] }));
  if (!contents.length) contents.push({ role: 'user', parts: [{ text: '(Start the conversation with a greeting and your first question.)' }] });
  return generate({ key, model, system, contents });
}

export async function feedback({ key, model, question, answer }) {
  const system = `You are an English speaking coach. ${LEARNER}
Return JSON only, with this shape:
{"corrected": "the learner's answer rewritten in natural, simple English (B1), keeping his ideas",
 "tips": ["up to 3 short tips in Brazilian Portuguese about the most important mistakes"],
 "chunks": [{"en": "a useful short sentence from the corrected answer", "pt": "tradução em português"}]}
Give at most 3 chunks. Be encouraging but direct.`;
  const contents = [{ role: 'user', parts: [{ text: `Question: ${question}\nLearner's spoken answer (speech-to-text, may have recognition errors): ${answer}` }] }];
  const raw = await generate({ key, model, system, contents, json: true });
  return parseJson(raw);
}

export async function correctText({ key, model, text }) {
  const system = `You are an English writing coach. ${LEARNER}
Return JSON only: {"corrected": "corrected text in natural English", "tips": ["up to 4 short explanations in Brazilian Portuguese"],
"chunks": [{"en": "useful sentence", "pt": "tradução"}]} with at most 3 chunks.`;
  const raw = await generate({ key, model, system, contents: [{ role: 'user', parts: [{ text }] }], json: true });
  return parseJson(raw);
}

export async function improvePitch({ key, model, text }) {
  const system = `You help a Brazilian self-taught AI builder (small-business owner, no degree) write his 45-second "Tell me about yourself" pitch.
${LEARNER}
Rewrite his text in simple, confident spoken English (B1, short sentences, easy to pronounce), 90-120 words.
Keep only true facts that he wrote. Do not invent numbers, employers or titles. Return only the pitch text.`;
  return generate({ key, model, system, contents: [{ role: 'user', parts: [{ text }] }] });
}

function parseJson(raw) {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const data = JSON.parse(cleaned);
    return {
      corrected: String(data.corrected || ''),
      tips: Array.isArray(data.tips) ? data.tips.map(String).slice(0, 4) : [],
      chunks: Array.isArray(data.chunks)
        ? data.chunks.filter((c) => c && c.en).map((c) => ({ en: String(c.en), pt: String(c.pt || '') })).slice(0, 3)
        : [],
    };
  } catch {
    return { corrected: cleaned, tips: [], chunks: [] };
  }
}
