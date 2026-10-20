import { DECKS, PRONUNCIATION, QUESTIONS, SCENARIOS, PLAN, DICTATION } from './data.js';
import {
  GRADES, todayStr, addDays, daysBetween, newCard, nextInterval, review, isDue, isMature,
  formatInterval, streak,
} from './srs.js';
import { bestMatch, compare, normalize, wordCount, escapeHtml as h, hashId } from './text.js';
import { support, speak, stopSpeaking, listenOnce, dictate, startRecording, englishVoices } from './speech.js';
import * as ai from './ai.js';
import * as store from './store.js';

let S = store.load();
const view = document.getElementById('view');
const today = () => todayStr();
const persist = () => store.save(S);

// ---------- catalog ----------
const CATALOG = new Map();
const DECK_BY_ID = Object.fromEntries(DECKS.map((d) => [d.id, d]));
DECK_BY_ID.custom = { id: 'custom', title: 'Meus tijolos', emoji: '⭐' };

function buildCatalog() {
  CATALOG.clear();
  for (const deck of DECKS) {
    for (const [en, pt, note] of deck.items) {
      const id = `${deck.id}:${hashId(en)}`;
      CATALOG.set(id, { id, deck: deck.id, en, pt, note: note || '' });
    }
  }
  for (const c of S.custom) CATALOG.set(c.id, { ...c, deck: 'custom' });
}
buildCatalog();

const enabledDecks = () => new Set([...S.settings.decks, 'custom']);
const voiceOpts = (extra = {}) => ({ rate: S.settings.rate, voiceURI: S.settings.voiceURI, ...extra });
const say = (text, extra) => speak(text, voiceOpts(extra));
const sayPt = (text) => speak(text, { lang: 'pt-BR', rate: 1 });

// ---------- activity time ----------
let lastAct = Date.now();
let busy = false;
['pointerdown', 'keydown'].forEach((ev) => addEventListener(ev, () => { lastAct = Date.now(); }, { passive: true }));

function bump(field, n = 1) {
  const d = today();
  S.log[d] = S.log[d] || { seconds: 0, reviews: 0, learned: 0, spoken: 0 };
  S.log[d][field] = (S.log[d][field] || 0) + n;
  if (!S.startDate) S.startDate = d;
  persist();
}

setInterval(() => {
  if (document.visibilityState === 'visible' && (busy || Date.now() - lastAct < 60000)) {
    bump('seconds', 15);
    updateHeader();
  }
}, 15000);

// ---------- ui helpers ----------
function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, ms);
}

function updateHeader() {
  const d = today();
  const st = streak(S.log, d);
  const mins = Math.floor((S.log[d]?.seconds || 0) / 60);
  document.getElementById('streak').textContent = `🔥 ${st}`;
  document.getElementById('minutes').textContent = `⏱️ ${mins} min`;
}

function renderWords(result) {
  return `<p class="words">${result.words.map((x) => `<span class="${x.ok ? 'ok' : 'miss'}">${h(x.w)}</span>`).join(' ')}</p>
    <p class="score ${result.score >= 80 ? 'good' : result.score >= 50 ? 'mid' : 'low'}">${result.score}% ${result.score >= 80 ? '— mandou bem!' : result.score >= 50 ? '— quase lá' : '— tente de novo, mais devagar'}</p>
    ${result.said ? `<p class="said">Entendi: “${h(result.said)}”</p>` : ''}`;
}

async function micCheck(target, outEl) {
  if (!support.stt) {
    outEl.innerHTML = '<p class="muted">Seu navegador não tem reconhecimento de voz. Use o Chrome (Android ou PC).</p>';
    return null;
  }
  outEl.innerHTML = '<p class="listening">🎙️ Ouvindo... fale agora</p>';
  busy = true;
  try {
    const alts = await listenOnce();
    if (!alts.length) {
      outEl.innerHTML = '<p class="muted">Não ouvi nada. Toque em 🎤 e fale logo em seguida.</p>';
      return null;
    }
    const r = bestMatch(target, alts);
    outEl.innerHTML = renderWords(r);
    bump('spoken');
    return r;
  } catch (e) {
    outEl.innerHTML = `<p class="muted">Microfone indisponível (${h(e.message)}). Libere o microfone para este site.</p>`;
    return null;
  } finally {
    busy = false;
  }
}

let actions = {};
view.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !view.contains(el)) return;
  const fn = actions[el.dataset.act];
  if (fn) fn(el, e);
});

function setView(html, acts = {}) {
  stopSpeaking();
  view.innerHTML = html;
  actions = acts;
  window.scrollTo(0, 0);
}

// ---------- router ----------
const ROUTES = { hoje: renderHome, ouvir: renderListen, pronuncia: renderPron, coach: renderCoach, progresso: renderProgress, ajustes: renderSettings };

function go(route) {
  const r = ROUTES[route] ? route : 'hoje';
  if (location.hash !== `#${r}`) history.replaceState(null, '', `#${r}`);
  document.querySelectorAll('[data-route]').forEach((b) => b.classList.toggle('active', b.dataset.route === r));
  if (r !== 'ouvir') stopPlayer();
  ROUTES[r]();
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-route]');
  if (b) { e.preventDefault(); go(b.dataset.route); }
});
addEventListener('hashchange', () => go(location.hash.slice(1)));

// ---------- daily session ----------
let session = null;

function questionOfDay(offset = 0) {
  const n = daysBetween('2026-01-01', today()) + offset;
  return QUESTIONS[((n % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length];
}

function dueIds() {
  const d = today();
  const en = enabledDecks();
  return [...CATALOG.values()]
    .filter((c) => en.has(c.deck) && S.cards[c.id] && isDue(S.cards[c.id], d))
    .sort((a, b) => S.cards[a.id].due.localeCompare(S.cards[b.id].due))
    .slice(0, 50)
    .map((c) => c.id);
}

function pickNew(n) {
  if (n <= 0) return [];
  const order = ['custom', ...S.settings.decks];
  const pools = order.map((deck) => [...CATALOG.values()].filter((c) => c.deck === deck && !S.cards[c.id]).map((c) => c.id));
  const out = [];
  while (out.length < n && pools.some((p) => p.length)) {
    for (const p of pools) {
      if (p.length && out.length < n) out.push(p.shift());
    }
  }
  return out;
}

function newLeftToday() {
  return Math.max(0, S.settings.newPerDay - (S.introduced[today()] || 0));
}

function startSession(extraNew = 0) {
  const fresh = pickNew(newLeftToday() + extraNew);
  session = {
    step: fresh.length ? 'learn' : 'review',
    fresh,
    queue: dueIds(),
    idx: 0,
    again: {},
    shadow: [],
    q: questionOfDay(),
    t0: Date.now(),
    reviewed: 0,
  };
  if (session.step === 'review' && !session.queue.length) session.step = 'shadow';
  if (session.step === 'shadow') prepShadow();
  renderSession();
}

function prepShadow() {
  const pool = [...new Set([...session.fresh, ...session.queue])];
  const picked = pool.slice(0, 3);
  if (picked.length < 3) {
    const seen = [...CATALOG.values()].filter((c) => S.cards[c.id]).map((c) => c.id);
    for (const id of seen.sort(() => Math.random() - 0.5)) if (picked.length < 3 && !picked.includes(id)) picked.push(id);
  }
  if (!picked.length) picked.push(...pickNew(3));
  session.shadow = picked;
  session.idx = 0;
}

function stepBar(step) {
  const steps = [['learn', '1 Novos'], ['review', '2 Revisar'], ['shadow', '3 Repetir'], ['speak', '4 Falar']];
  const idx = steps.findIndex(([s]) => s === step);
  return `<ol class="steps">${steps.map(([s, label], i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${label}</li>`).join('')}</ol>`;
}

function deckTag(card) {
  const d = DECK_BY_ID[card.deck] || DECK_BY_ID.custom;
  return `<span class="tag">${d.emoji} ${h(d.title)}</span>`;
}

function renderSession() {
  if (!session) return renderHome();
  const { step } = session;
  if (step === 'learn') return renderLearn();
  if (step === 'review') return renderReview();
  if (step === 'shadow') return renderShadow();
  if (step === 'speak') return renderSpeak();
  return renderDone();
}

function renderLearn() {
  const id = session.fresh[session.idx];
  const c = CATALOG.get(id);
  setView(`
    ${stepBar('learn')}
    <p class="progress-line">Tijolo novo ${session.idx + 1} de ${session.fresh.length}</p>
    <section class="card big">
      ${deckTag(c)}
      <p class="en">${h(c.en)}</p>
      <p class="pt">${h(c.pt)}</p>
      ${c.note ? `<p class="note">💡 ${h(c.note)}</p>` : ''}
      <div class="row">
        <button class="btn" data-act="play">🔊 Ouvir</button>
        <button class="btn" data-act="slow">🐢 Devagar</button>
        <button class="btn" data-act="mic">🎤 Repetir</button>
      </div>
      <div id="mic-out"></div>
      <p class="hint">Ouça, depois fale em voz alta 3 vezes. Falar em voz alta grava mais na memória do que só ler.</p>
    </section>
    <button class="btn primary wide" data-act="next">Próximo ➜</button>
  `, {
    play: () => say(c.en),
    slow: () => say(c.en, { rate: 0.7 }),
    mic: () => micCheck(c.en, document.getElementById('mic-out')),
    next: () => {
      const d = today();
      S.cards[id] = { ...newCard(), due: d };
      S.introduced[d] = (S.introduced[d] || 0) + 1;
      bump('learned');
      session.idx += 1;
      if (session.idx >= session.fresh.length) {
        session.queue = [...session.queue, ...session.fresh];
        session.idx = 0;
        session.step = 'review';
      }
      renderSession();
    },
  });
  setTimeout(() => say(c.en), 250);
}

function renderReview() {
  if (session.idx >= session.queue.length) {
    session.step = 'shadow';
    prepShadow();
    return renderSession();
  }
  const id = session.queue[session.idx];
  const c = CATALOG.get(id);
  const card = S.cards[id] || newCard();
  const grades = [
    [GRADES.AGAIN, 'Errei', 'again'],
    [GRADES.HARD, 'Difícil', 'hard'],
    [GRADES.GOOD, 'Bom', 'good'],
    [GRADES.EASY, 'Fácil', 'easy'],
  ];
  setView(`
    ${stepBar('review')}
    <p class="progress-line">Revisão ${session.idx + 1} de ${session.queue.length}</p>
    <section class="card big">
      ${deckTag(c)}
      <p class="ask">Como se diz em inglês?</p>
      <p class="pt prompt">${h(c.pt)}</p>
      <div id="answer" hidden>
        <p class="en">${h(c.en)}</p>
        ${c.note ? `<p class="note">💡 ${h(c.note)}</p>` : ''}
      </div>
      <div class="row">
        <button class="btn" data-act="mic">🎤 Falar</button>
        <button class="btn" data-act="reveal" id="reveal-btn">👀 Mostrar</button>
        <button class="btn" data-act="play" id="play-btn" hidden>🔊 Ouvir</button>
      </div>
      <div id="mic-out"></div>
    </section>
    <div class="grades" id="grades" hidden>
      ${grades.map(([g, label, cls]) => `<button class="btn grade ${cls}" data-act="grade" data-g="${g}">${label}<small>${formatInterval(nextInterval(card, g))}</small></button>`).join('')}
    </div>
    <p class="hint center">Tente falar ANTES de mostrar. Errar e conferir também ensina.</p>
  `, {
    mic: async () => {
      const r = await micCheck(c.en, document.getElementById('mic-out'));
      if (r) actions.reveal();
    },
    reveal: () => {
      document.getElementById('answer').hidden = false;
      document.getElementById('grades').hidden = false;
      document.getElementById('reveal-btn').hidden = true;
      document.getElementById('play-btn').hidden = false;
      say(c.en);
    },
    play: () => say(c.en),
    grade: (el) => {
      const g = Number(el.dataset.g);
      S.cards[id] = review(S.cards[id] || newCard(), g, today());
      bump('reviews');
      session.reviewed += 1;
      if (g === GRADES.AGAIN && (session.again[id] || 0) < 2) {
        session.again[id] = (session.again[id] || 0) + 1;
        session.queue.push(id);
      }
      session.idx += 1;
      renderSession();
    },
  });
}

let recorder = null;
function renderShadow() {
  if (session.idx >= session.shadow.length) {
    session.step = 'speak';
    return renderSession();
  }
  const c = CATALOG.get(session.shadow[session.idx]);
  setView(`
    ${stepBar('shadow')}
    <p class="progress-line">Sombra ${session.idx + 1} de ${session.shadow.length}</p>
    <section class="card big">
      ${deckTag(c)}
      <p class="en">${h(c.en)}</p>
      <p class="pt small">${h(c.pt)}</p>
      <p class="hint">Técnica da sombra: ouça devagar, depois no normal, e fale <b>junto</b> com o áudio copiando o ritmo. Depois grave sua voz e compare.</p>
      <div class="row">
        <button class="btn" data-act="slow">🐢 0,7x</button>
        <button class="btn" data-act="play">🔊 Normal</button>
        <button class="btn" data-act="rec" id="rec-btn">⏺️ Gravar</button>
        <button class="btn" data-act="mic">🎤 Checar</button>
      </div>
      <div id="rec-out"></div>
      <div id="mic-out"></div>
    </section>
    <button class="btn primary wide" data-act="next">Próximo ➜</button>
  `, {
    slow: () => say(c.en, { rate: 0.7 }),
    play: () => say(c.en),
    mic: () => micCheck(c.en, document.getElementById('mic-out')),
    rec: async (el) => {
      if (!support.record) return toast('Gravação não suportada neste navegador.');
      if (!recorder) {
        try {
          recorder = await startRecording();
          busy = true;
          el.textContent = '⏹️ Parar';
          el.classList.add('recording');
        } catch {
          toast('Libere o microfone para gravar.');
        }
      } else {
        const url = await recorder.stop();
        recorder = null;
        busy = false;
        el.textContent = '⏺️ Gravar';
        el.classList.remove('recording');
        document.getElementById('rec-out').innerHTML = `<p class="muted">Sua voz:</p><audio controls src="${url}"></audio>
          <button class="btn small" data-act="play">🔊 Ouvir o modelo de novo</button>`;
      }
    },
    next: async () => {
      if (recorder) { await recorder.stop(); recorder = null; busy = false; }
      session.idx += 1;
      renderSession();
    },
  });
  setTimeout(() => say(c.en, { rate: 0.7 }), 250);
}

function renderSpeakBlock(q, { inSession }) {
  return `
    <section class="card big">
      <span class="tag">🎙️ Pergunta do dia</span>
      <p class="en">${h(q.q)}</p>
      <p class="pt small">${h(q.pt)}</p>
      <div class="row">
        <button class="btn" data-act="playq">🔊 Ouvir pergunta</button>
        <button class="btn" data-act="model">💡 Resposta modelo</button>
      </div>
      <div id="model-out" hidden>
        <p class="model">${h(q.a)}</p>
        <button class="btn small" data-act="playa">🔊 Ouvir modelo</button>
      </div>
      <p class="hint">Responda em voz alta por até 1 minuto. Não tem problema errar: frase simples e clara vale mais que frase bonita.</p>
      <button class="btn primary wide" data-act="answer" id="answer-btn">🎤 Começar a responder</button>
      <div id="dictation"></div>
      <div id="fb-out"></div>
    </section>
    ${inSession ? '<button class="btn wide" data-act="finish">Terminar sessão ✔</button>' : ''}`;
}

function speakActions(q, extra = {}) {
  let dict = null;
  let t0 = 0;
  let lastAnswer = '';
  return {
    playq: () => say(q.q),
    model: () => { document.getElementById('model-out').hidden = false; say(q.a); },
    playa: () => say(q.a),
    answer: (el) => {
      const out = document.getElementById('dictation');
      if (!support.stt) {
        out.innerHTML = '<p class="muted">Sem reconhecimento de voz neste navegador. Use o Chrome. Você ainda pode responder em voz alta e se gravar no passo anterior.</p>';
        return;
      }
      if (!dict) {
        try {
          dict = dictate({ onText: (t) => { out.innerHTML = `<p class="transcript">${h(t)}</p>`; } });
        } catch {
          out.innerHTML = '<p class="muted">Não consegui ligar o microfone.</p>';
          return;
        }
        t0 = Date.now();
        busy = true;
        el.textContent = '⏹️ Parar';
        el.classList.add('recording');
        out.innerHTML = '<p class="listening">🎙️ Ouvindo... pode falar</p>';
      } else {
        const text = dict.stop();
        dict = null;
        busy = false;
        el.textContent = '🎤 Responder de novo';
        el.classList.remove('recording');
        const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
        const words = wordCount(text);
        lastAnswer = text;
        bump('spoken');
        out.innerHTML = text
          ? `<p class="transcript">${h(text)}</p>
             <p class="stats">${words} palavras em ${secs}s · ${Math.round((words / secs) * 60)} palavras/min ${words >= 40 ? '✅' : '— tente chegar a 40+ palavras'}</p>
             <button class="btn" data-act="fb">✨ Corrigir com IA</button>`
          : '<p class="muted">Não captei sua fala. Tente de novo, perto do microfone.</p>';
      }
    },
    fb: async () => {
      const out = document.getElementById('fb-out');
      out.innerHTML = '<p class="listening">Analisando sua resposta...</p>';
      try {
        const r = await ai.feedback({ key: S.settings.geminiKey, model: S.settings.model, question: q.q, answer: lastAnswer });
        out.innerHTML = renderFeedback(r);
      } catch (e) {
        out.innerHTML = `<p class="muted">${h(e.message)}</p>${S.settings.geminiKey ? '' : '<a class="btn small" href="#ajustes" data-route="ajustes">Ir para Ajustes</a>'}`;
      }
    },
    ...chunkActions(),
    ...extra,
  };
}

function renderFeedback(r) {
  return `
    <div class="feedback">
      <p class="label">Versão corrigida</p>
      <p class="model">${h(r.corrected)}</p>
      <button class="btn small" data-act="sayText" data-text="${h(r.corrected)}">🔊 Ouvir</button>
      ${r.tips.length ? `<p class="label">Dicas</p><ul>${r.tips.map((t) => `<li>${h(t)}</li>`).join('')}</ul>` : ''}
      ${r.chunks.length ? `<p class="label">Virar tijolo (entra nas revisões)</p>${r.chunks.map((c) => `
        <div class="chunk"><span><b>${h(c.en)}</b><br><small>${h(c.pt)}</small></span>
        <button class="btn small" data-act="addChunk" data-en="${h(c.en)}" data-pt="${h(c.pt)}">+ tijolo</button></div>`).join('')}` : ''}
    </div>`;
}

function chunkActions() {
  return {
    sayText: (el) => say(el.dataset.text),
    addChunk: (el) => {
      if (addCustom(el.dataset.en, el.dataset.pt)) {
        el.textContent = '✔ salvo';
        el.disabled = true;
      }
    },
  };
}

function addCustom(en, pt) {
  en = String(en || '').trim();
  pt = String(pt || '').trim();
  if (!en) return false;
  const id = `custom:${hashId(en)}`;
  if (CATALOG.has(id)) { toast('Esse tijolo já existe.'); return false; }
  S.custom.push({ id, en, pt, note: '' });
  buildCatalog();
  persist();
  toast('Tijolo salvo. Ele aparece nos próximos "novos".');
  return true;
}

function renderSpeak() {
  const q = session.q;
  setView(`${stepBar('speak')}${renderSpeakBlock(q, { inSession: true })}`, speakActions(q, {
    finish: () => { session.step = 'done'; renderSession(); },
  }));
  setTimeout(() => say(q.q), 250);
}

function renderDone() {
  const mins = Math.max(1, Math.round((Date.now() - session.t0) / 60000));
  const tomorrow = addDays(today(), 1);
  const dueTomorrow = [...CATALOG.values()].filter((c) => S.cards[c.id] && S.cards[c.id].due && S.cards[c.id].due <= tomorrow).length;
  const reviewed = session.reviewed;
  session = null;
  setView(`
    <section class="card big center">
      <p class="huge">🧱✅</p>
      <h2>Sessão concluída</h2>
      <p>${reviewed} revisões em ~${mins} min. Sequência: <b>🔥 ${streak(S.log, today())} dia(s)</b>.</p>
      <p class="muted">Amanhã: ~${dueTomorrow} revisões. Voltar todo dia, mesmo por 10 minutos, vale mais que 2 horas no domingo.</p>
      <div class="row center">
        <button class="btn" data-route="ouvir">🎧 Ouvir no carro/obra</button>
        <button class="btn" data-route="coach">🤖 Conversar com o Coach</button>
      </div>
    </section>`);
  updateHeader();
}

// ---------- home ----------
function renderHome() {
  if (session) return renderSession();
  const d = today();
  const due = dueIds().length;
  const fresh = Math.min(newLeftToday(), pickNew(newLeftToday()).length);
  const seen = Object.keys(S.cards).length;
  const week = S.startDate ? Math.min(12, Math.floor(daysBetween(S.startDate, d) / 7) + 1) : 1;
  const goal = PLAN[week - 1];
  const q = questionOfDay();
  const nothing = !due && !fresh;
  setView(`
    <section class="hero">
      <h1>Inglês para trabalhar com IA.</h1>
      <p>Para brasileiros: 20 minutos por dia, na ordem certa — aprender, lembrar, repetir e falar. Tijolo por tijolo.</p>
    </section>
    <section class="card">
      <h2>Sessão de hoje</h2>
      <ul class="plan-list">
        <li>🧱 <b>${fresh}</b> tijolos novos</li>
        <li>🔁 <b>${due}</b> revisões</li>
        <li>🗣️ 3 frases na técnica da sombra</li>
        <li>🎙️ 1 pergunta de entrevista: <i>${h(q.q)}</i></li>
      </ul>
      <button class="btn primary wide" data-act="start">${nothing ? '▶ Fazer sombra + fala' : '▶ Começar (~20 min)'}</button>
      ${nothing ? '<button class="btn wide" data-act="extra">+ 5 tijolos extras hoje</button>' : ''}
    </section>
    <section class="card">
      <h3>Semana ${week} de 12</h3>
      <p>${h(goal.goal)}</p>
      <p class="muted">${seen} tijolos vistos até agora.</p>
    </section>
    <section class="card tips">
      <h3>Atalhos para quem não tem tempo</h3>
      <div class="row">
        <button class="btn" data-route="ouvir">🎧 Modo mãos livres</button>
        <button class="btn" data-route="pronuncia">👄 Pronúncia</button>
        <button class="btn" data-route="coach">🤖 Coach IA</button>
      </div>
    </section>
    ${installCard()}
  `, {
    start: () => startSession(),
    extra: () => startSession(5),
    install: () => doInstall(),
  });
}

// ---------- hands-free listening ----------
const player = { running: false, token: 0, list: [], i: 0, lock: null };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function stopPlayer() {
  player.running = false;
  player.token += 1;
  stopSpeaking();
  busy = false;
  player.lock?.release?.().catch?.(() => {});
  player.lock = null;
}

function listenSource(src) {
  if (src === 'today') {
    const ids = [...new Set([...dueIds(), ...Object.keys(S.cards).filter((id) => S.cards[id].last === today() || S.cards[id].due === today())])];
    const list = ids.length ? ids : Object.keys(S.cards);
    return list.filter((id) => CATALOG.has(id)).map((id) => CATALOG.get(id));
  }
  return [...CATALOG.values()].filter((c) => c.deck === src);
}

let listenMode = 'free';

function listenTabs() {
  const tabs = [['free', '🎧 Mãos livres'], ['dict', '✍️ Ditado (ouvido nativo)']];
  return `<div class="tabs">${tabs.map(([id, l]) => `<button class="tab ${listenMode === id ? 'active' : ''}" data-act="mode" data-id="${id}">${l}</button>`).join('')}</div>`;
}

const switchMode = (el) => { stopPlayer(); listenMode = el.dataset.id; renderListen(); };

// Dictation: hear natural-speed English, type it, see what your ear missed.
let dict = { i: 0, order: [], hits: 0, done: 0 };

function renderDictation() {
  if (!dict.order.length) dict.order = DICTATION.map((_, i) => i).sort(() => Math.random() - 0.5);
  const item = DICTATION[dict.order[dict.i % dict.order.length]];
  setView(`
    ${listenTabs()}
    <section class="card">
      <h2>✍️ Ditado — ouvido nativo</h2>
      <p class="muted">Brasileiro trava mais para <b>entender</b> do que para falar: nativo junta as palavras ("gonna", "whatcha"). Ouça na velocidade real, digite o que entendeu e veja o que seu ouvido perdeu.</p>
      <div class="row">
        <button class="btn primary" data-act="play">🔊 Ouvir (normal)</button>
        <button class="btn" data-act="slow">🐢 Devagar</button>
      </div>
      <input id="typed" placeholder="Digite o que você ouviu" autocomplete="off" autocapitalize="off">
      <button class="btn wide" data-act="check">Conferir</button>
      <div id="dout"></div>
      <p class="muted">Acertos nesta rodada: ${dict.hits}/${dict.done}</p>
    </section>
  `, {
    mode: switchMode,
    play: () => say(item.en, { rate: 1.05 }),
    slow: () => say(item.en, { rate: 0.7 }),
    check: () => {
      const typed = document.getElementById('typed').value;
      const r = compare(item.en, typed);
      dict.done += 1;
      if (r.score >= 90) dict.hits += 1;
      bump('spoken');
      document.getElementById('dout').innerHTML = `
        ${renderWords({ ...r, said: '' })}
        <p class="en">${h(item.en)}</p>
        <p class="note">👂 ${h(item.tip)}</p>
        <div class="row"><button class="btn" data-act="play">🔊 De novo</button><button class="btn primary" data-act="next">Próxima ➜</button></div>`;
    },
    next: () => { dict.i += 1; renderDictation(); },
  });
  document.getElementById('typed').addEventListener('keydown', (e) => { if (e.key === 'Enter') actions.check(); });
  setTimeout(() => say(item.en, { rate: 1.05 }), 300);
}

function renderListen() {
  if (listenMode === 'dict') return renderDictation();
  const opts = [['today', '🔁 Minhas revisões + o que vi hoje'], ...DECKS.map((d) => [d.id, `${d.emoji} ${d.title}`]), ['custom', '⭐ Meus tijolos']];
  setView(`
    ${listenTabs()}
    <section class="card">
      <h2>🎧 Modo mãos livres</h2>
      <p class="muted">Para o carro, a academia ou lavando louça. O app fala em inglês, dá uma pausa para você repetir, traduz e repete devagar.</p>
      <label>O que ouvir
        <select id="src">${opts.map(([v, l]) => `<option value="${v}">${h(l)}</option>`).join('')}</select>
      </label>
      <label class="check"><input type="checkbox" id="withpt" checked> Falar a tradução em português</label>
      <label class="check"><input type="checkbox" id="shuffle"> Embaralhar</label>
      <div class="row">
        <button class="btn primary" data-act="play" id="play">▶ Tocar</button>
        <button class="btn" data-act="stop">⏸ Parar</button>
        <button class="btn" data-act="skip">⏭ Pular</button>
      </div>
    </section>
    <section class="card big center" id="now">
      <p class="muted">Aperte ▶ e deixe a tela ligada.</p>
    </section>
  `, {
    mode: switchMode,
    play: () => startPlayer(),
    stop: () => { stopPlayer(); document.getElementById('now').innerHTML = '<p class="muted">Pausado.</p>'; },
    skip: () => { if (player.running) { player.i += 1; restartPlayer(); } },
  });
}

async function startPlayer() {
  const src = document.getElementById('src').value;
  let list = listenSource(src);
  if (!list.length) {
    document.getElementById('now').innerHTML = '<p class="muted">Ainda não há frases aqui. Faça uma sessão em "Hoje" primeiro ou escolha um deck.</p>';
    return;
  }
  if (document.getElementById('shuffle').checked) list = list.sort(() => Math.random() - 0.5);
  stopPlayer();
  player.list = list;
  player.i = 0;
  try { player.lock = await navigator.wakeLock?.request('screen'); } catch { /* optional */ }
  restartPlayer();
}

function restartPlayer() {
  stopSpeaking();
  player.running = true;
  player.token += 1;
  runPlayer(player.token);
}

async function runPlayer(token) {
  const withPt = () => document.getElementById('withpt')?.checked;
  const alive = () => player.running && token === player.token;
  busy = true;
  while (alive() && player.i < player.list.length) {
    const c = player.list[player.i];
    const now = document.getElementById('now');
    if (!now) return stopPlayer();
    now.innerHTML = `<p class="muted">${player.i + 1} / ${player.list.length}</p><p class="en">${h(c.en)}</p><p class="pt small">${h(c.pt)}</p>`;
    await say(c.en);
    if (!alive()) return;
    await wait(1800);
    if (!alive()) return;
    if (withPt() && c.pt) {
      await sayPt(c.pt);
      if (!alive()) return;
      await wait(700);
    }
    await say(c.en, { rate: 0.75 });
    if (!alive()) return;
    await wait(2600);
    if (!alive()) return;
    player.i += 1;
  }
  if (alive()) {
    document.getElementById('now').innerHTML = '<p class="huge">✅</p><p>Fim da lista. Toque ▶ para repetir.</p>';
    stopPlayer();
  }
}

// ---------- pronunciation ----------
function renderPron(topicId) {
  const S_pron = S.pron || {};
  if (!topicId) {
    setView(`
      <section class="card">
        <h2>👄 Pronúncia para brasileiros</h2>
        <p class="muted">Meta: ser entendido de primeira, não ter sotaque americano. Estes são os 8 pontos que mais travam brasileiros.</p>
      </section>
      ${PRONUNCIATION.map((t) => `
        <button class="card topic" data-act="open" data-id="${t.id}">
          <span>${h(t.title)}</span>
          <small>${S_pron[t.id] ? `${S_pron[t.id].ok}/${S_pron[t.id].total} na última vez` : 'novo'}</small>
        </button>`).join('')}
    `, { open: (el) => renderPron(el.dataset.id) });
    return;
  }
  const t = PRONUNCIATION.find((x) => x.id === topicId);
  const result = {};
  const wordBtn = (w) => `
    <div class="word" id="w-${h(w)}">
      <b>${h(t.stress?.[w] || w)}</b>
      <span class="row tight">
        <button class="btn small" data-act="say" data-w="${h(w)}">🔊</button>
        ${t.stress ? '' : `<button class="btn small" data-act="test" data-w="${h(w)}">🎤</button>`}
      </span>
      <span class="res"></span>
    </div>`;
  setView(`
    <button class="btn small" data-act="back">← Voltar</button>
    <section class="card">
      <h2>${h(t.title)}</h2>
      <p>${h(t.tip)}</p>
    </section>
    <section class="card">
      ${t.pairs ? t.pairs.map(([a, b]) => `<div class="pair">${wordBtn(a)}${wordBtn(b)}</div>`).join('') : `<div class="pair wrap">${t.words.map(wordBtn).join('')}</div>`}
      <p class="hint">${t.pairs ? 'Pares mínimos: só um som muda. Fale cada palavra e veja se o reconhecedor entendeu a certa.' : 'Ouça e repita. O reconhecedor confere se entendeu a palavra.'}</p>
    </section>
    <section class="card">
      <p class="label">Frase para fechar</p>
      <p class="en">${h(t.sentence)}</p>
      <div class="row">
        <button class="btn" data-act="sent">🔊 Ouvir</button>
        <button class="btn" data-act="sentslow">🐢 Devagar</button>
        <button class="btn" data-act="senttest">🎤 Testar</button>
      </div>
      <div id="mic-out"></div>
    </section>
  `, {
    back: () => renderPron(),
    say: (el) => say(el.dataset.w, { rate: 0.8 }),
    test: async (el) => {
      const w = el.dataset.w;
      const res = document.querySelector(`#w-${CSS.escape(w)} .res`);
      if (!support.stt) { res.textContent = 'use o Chrome'; return; }
      res.textContent = '🎙️...';
      busy = true;
      try {
        const alts = await listenOnce({ timeoutMs: 6000 });
        const heard = alts.map((a) => normalize(a).join(' '));
        const ok = heard.some((a) => a.split(' ').includes(w));
        result[w] = ok;
        res.innerHTML = ok ? '✅' : `❌ <small>${h(alts[0] || 'nada')}</small>`;
        bump('spoken');
        const tested = Object.keys(result);
        S.pron = { ...(S.pron || {}), [t.id]: { ok: tested.filter((k) => result[k]).length, total: tested.length } };
        persist();
      } catch {
        res.textContent = 'sem microfone';
      } finally {
        busy = false;
      }
    },
    sent: () => say(t.sentence),
    sentslow: () => say(t.sentence, { rate: 0.7 }),
    senttest: () => micCheck(t.sentence, document.getElementById('mic-out')),
  });
}

// ---------- coach ----------
const chat = { scenario: SCENARIOS[0].id, history: [], tab: 'chat' };

function renderCoach() {
  const noKey = !S.settings.geminiKey;
  const tabs = [['chat', '💬 Conversa'], ['write', '✍️ Corrigir texto'], ['pitch', '🎯 Meu pitch']];
  const head = `
    <div class="tabs">${tabs.map(([id, l]) => `<button class="tab ${chat.tab === id ? 'active' : ''}" data-act="tab" data-id="${id}">${l}</button>`).join('')}</div>
    ${noKey && chat.tab !== 'pitch' ? `<section class="card warn">
      <p><b>O Coach IA precisa de uma chave grátis do Google Gemini.</b></p>
      <ol><li>Abra <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> e entre com sua conta Google.</li>
      <li>Clique em "Create API key" e copie.</li>
      <li>Cole em <a href="#ajustes" data-route="ajustes">Ajustes</a>. Ela fica só neste aparelho.</li></ol>
    </section>` : ''}`;
  const common = { tab: (el) => { chat.tab = el.dataset.id; renderCoach(); }, ...chunkActions() };
  if (chat.tab === 'chat') return renderChat(head, common);
  if (chat.tab === 'write') return renderWrite(head, common);
  return renderPitch(head, common);
}

// Escape first, then allow only **bold** and *italic* from the AI.
const md = (text) => h(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
const plain = (text) => String(text).replace(/\*+/g, '');

function chatBubble(m) {
  const [main, ...fix] = m.text.split(/\n+\s*✏️/);
  return `<div class="bubble ${m.role}">${md(main.trim())}${fix.length ? `<div class="fix">✏️ ${md(fix.join(' ').trim())}</div>` : ''}</div>`;
}

function renderChat(head, common) {
  setView(`
    ${head}
    <section class="card">
      <label>Cenário
        <select id="scenario">${SCENARIOS.map((s) => `<option value="${s.id}" ${s.id === chat.scenario ? 'selected' : ''}>${h(s.label)}</option>`).join('')}</select>
      </label>
      <div class="chat" id="chat">${chat.history.map(chatBubble).join('') || '<p class="muted">Toque em "Começar" e a IA puxa assunto. Responda falando (🎤) ou digitando.</p>'}</div>
      <div class="composer">
        <input id="msg" placeholder="Escreva em inglês (ou português, se travar)" autocomplete="off">
        <button class="btn" data-act="mic" title="Falar">🎤</button>
        <button class="btn primary" data-act="send">➤</button>
      </div>
      <div class="row">
        <button class="btn small" data-act="begin">${chat.history.length ? '↺ Recomeçar' : '▶ Começar'}</button>
        <label class="check small"><input type="checkbox" id="autospeak" ${S.settings.autoSpeak ? 'checked' : ''}> Ler respostas em voz alta</label>
      </div>
    </section>
  `, {
    ...common,
    begin: () => { chat.history = []; chat.scenario = document.getElementById('scenario').value; sendChat(null); },
    send: () => {
      const input = document.getElementById('msg');
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      sendChat(text);
    },
    mic: async () => {
      if (!support.stt) return toast('Use o Chrome para falar com o microfone.');
      toast('🎙️ Pode falar...');
      busy = true;
      try {
        const alts = await listenOnce({ timeoutMs: 15000 });
        if (alts[0]) sendChat(alts[0]);
        else toast('Não ouvi. Tente de novo.');
      } catch { toast('Microfone indisponível.'); } finally { busy = false; }
    },
  });
  document.getElementById('scenario').addEventListener('change', (e) => { chat.scenario = e.target.value; chat.history = []; renderCoach(); });
  document.getElementById('autospeak').addEventListener('change', (e) => { S.settings.autoSpeak = e.target.checked; persist(); });
  document.getElementById('msg').addEventListener('keydown', (e) => { if (e.key === 'Enter') actions.send(); });
  const box = document.getElementById('chat');
  box.scrollTop = box.scrollHeight;
}

async function sendChat(text) {
  if (text) { chat.history.push({ role: 'me', text }); bump('spoken'); }
  renderCoach();
  const box = document.getElementById('chat');
  box.insertAdjacentHTML('beforeend', '<div class="bubble ai typing">...</div>');
  box.scrollTop = box.scrollHeight;
  try {
    const scenario = SCENARIOS.find((s) => s.id === chat.scenario).prompt;
    const reply = await ai.chatReply({ key: S.settings.geminiKey, model: S.settings.model, scenario, history: chat.history });
    chat.history.push({ role: 'ai', text: reply.replace(/\r/g, '') });
    renderCoach();
    if (S.settings.autoSpeak) say(plain(reply.split('✏️')[0]));
  } catch (e) {
    renderCoach();
    toast(e.message, 5000);
  }
}

function renderWrite(head, common) {
  setView(`
    ${head}
    <section class="card">
      <h3>✍️ Corrigir texto</h3>
      <p class="muted">E-mail, mensagem para o senhorio, "About" do LinkedIn, resposta de entrevista.</p>
      <textarea id="wtext" rows="6" placeholder="Write here in English..."></textarea>
      <button class="btn primary wide" data-act="fix">Corrigir</button>
      <div id="wout"></div>
    </section>
  `, {
    ...common,
    fix: async () => {
      const text = document.getElementById('wtext').value.trim();
      const out = document.getElementById('wout');
      if (!text) return;
      out.innerHTML = '<p class="listening">Corrigindo...</p>';
      try {
        const r = await ai.correctText({ key: S.settings.geminiKey, model: S.settings.model, text });
        out.innerHTML = renderFeedback(r);
      } catch (e) { out.innerHTML = `<p class="muted">${h(e.message)}</p>`; }
    },
  });
}

const DEFAULT_PITCH = "Hi, I'm Diego, from Brazil. I work from home, and my wife and I run a lighting business. This year I taught myself to build AI tools: agents, automations and full apps. I built an AI platform with chat, agents and a mobile app, and I already sold a business app to a customer. I learn by building, one brick at a time. Now I want to join a team that builds real AI products.";

function renderPitch(head, common) {
  const pitch = S.pitch || DEFAULT_PITCH;
  let dict = null;
  setView(`
    ${head}
    <section class="card">
      <h3>🎯 Meu pitch — "Tell me about yourself"</h3>
      <p class="muted">A primeira pergunta de toda entrevista. Treine até falar em 45 segundos sem ler. Edite com seus fatos reais.</p>
      <textarea id="pitch" rows="8">${h(pitch)}</textarea>
      <p class="stats" id="pstats"></p>
      <div class="row">
        <button class="btn" data-act="play">🔊 Ouvir</button>
        <button class="btn" data-act="slow">🐢 Devagar</button>
        <button class="btn" data-act="train" id="train">🎤 Treinar</button>
        <button class="btn" data-act="improve">✨ Melhorar com IA</button>
      </div>
      <div id="pout"></div>
    </section>
  `, {
    ...common,
    play: () => say(document.getElementById('pitch').value),
    slow: () => say(document.getElementById('pitch').value, { rate: 0.75 }),
    train: (el) => {
      const out = document.getElementById('pout');
      if (!support.stt) { out.innerHTML = '<p class="muted">Use o Chrome para treinar com o microfone.</p>'; return; }
      if (!dict) {
        dict = dictate({ onText: (t) => { out.innerHTML = `<p class="transcript">${h(t)}</p>`; } });
        busy = true;
        el.textContent = '⏹️ Parar';
        el.classList.add('recording');
      } else {
        const said = dict.stop();
        dict = null;
        busy = false;
        el.textContent = '🎤 Treinar';
        el.classList.remove('recording');
        bump('spoken');
        out.innerHTML = said ? renderWords({ ...compare(document.getElementById('pitch').value, said), said: '' }) : '<p class="muted">Não captei. Tente de novo.</p>';
      }
    },
    improve: async () => {
      const out = document.getElementById('pout');
      out.innerHTML = '<p class="listening">Reescrevendo...</p>';
      try {
        const text = await ai.improvePitch({ key: S.settings.geminiKey, model: S.settings.model, text: document.getElementById('pitch').value });
        out.innerHTML = `<p class="label">Sugestão</p><p class="model" id="sugg">${h(text.trim())}</p>
          <div class="row"><button class="btn small" data-act="use">Usar esta versão</button><button class="btn small" data-act="sayText" data-text="${h(text.trim())}">🔊 Ouvir</button></div>`;
      } catch (e) { out.innerHTML = `<p class="muted">${h(e.message)}</p>`; }
    },
    use: () => {
      const v = document.getElementById('sugg').textContent;
      document.getElementById('pitch').value = v;
      S.pitch = v;
      persist();
      pstats();
      toast('Pitch atualizado.');
    },
  });
  const ta = document.getElementById('pitch');
  const pstats = () => {
    const words = wordCount(ta.value);
    document.getElementById('pstats').textContent = `${words} palavras · ~${Math.round(words / 2.2)} s falando no seu ritmo (meta: 90–120 palavras)`;
  };
  ta.addEventListener('input', () => { S.pitch = ta.value; persist(); pstats(); });
  pstats();
}

// ---------- progress ----------
function renderProgress() {
  const d = today();
  const days = [...Array(14)].map((_, i) => addDays(d, i - 13));
  const mins = days.map((x) => Math.round((S.log[x]?.seconds || 0) / 60));
  const max = Math.max(20, ...mins);
  const total = Math.round(Object.values(S.log).reduce((a, x) => a + (x.seconds || 0), 0) / 60);
  const seen = Object.keys(S.cards).filter((id) => CATALOG.has(id));
  const mature = seen.filter((id) => isMature(S.cards[id])).length;
  const spoken = Object.values(S.log).reduce((a, x) => a + (x.spoken || 0), 0);
  const week = S.startDate ? Math.min(12, Math.floor(daysBetween(S.startDate, d) / 7) + 1) : 1;
  setView(`
    <section class="grid4">
      <div class="stat"><b>🔥 ${streak(S.log, d)}</b><small>dias seguidos</small></div>
      <div class="stat"><b>${total}</b><small>minutos no total</small></div>
      <div class="stat"><b>${seen.length}</b><small>tijolos vistos</small></div>
      <div class="stat"><b>${mature}</b><small>firmes (21+ dias)</small></div>
    </section>
    <section class="card">
      <h3>Últimos 14 dias (minutos)</h3>
      <div class="bars">${mins.map((m, i) => `<div class="bar" title="${days[i]}: ${m} min"><span style="height:${Math.round((m / max) * 100)}%"></span><small>${days[i].slice(8)}</small></div>`).join('')}</div>
      <p class="muted">${spoken} vezes que você falou em voz alta. A meta é 20 min/dia.</p>
    </section>
    <section class="card">
      <h3>Tijolos por tema</h3>
      ${[...DECKS, DECK_BY_ID.custom].map((dk) => {
        const all = [...CATALOG.values()].filter((c) => c.deck === dk.id);
        if (!all.length) return '';
        const s = all.filter((c) => S.cards[c.id]).length;
        return `<div class="deckline"><span>${dk.emoji} ${h(dk.title)}</span><span class="meter"><i style="width:${Math.round((s / all.length) * 100)}%"></i></span><small>${s}/${all.length}</small></div>`;
      }).join('')}
    </section>
    <section class="card">
      <h3>Plano de 12 semanas</h3>
      <p class="muted">Você está na semana ${week}. Marque quando cumprir.</p>
      ${PLAN.map((p) => `<label class="check plan ${p.w === week ? 'current' : ''}"><input type="checkbox" data-w="${p.w}" ${S.plan[p.w] ? 'checked' : ''}> <span><b>Semana ${p.w}.</b> ${h(p.goal)}</span></label>`).join('')}
      <p class="muted">Meça seu nível de verdade, de graça: <a href="https://www.efset.org/" target="_blank" rel="noopener">EF SET</a> no início e no fim.</p>
    </section>
  `);
  view.querySelectorAll('input[data-w]').forEach((cb) => cb.addEventListener('change', () => { S.plan[cb.dataset.w] = cb.checked; persist(); }));
}

// ---------- settings ----------
function renderSettings() {
  const voices = englishVoices();
  setView(`
    <section class="card">
      <h2>⚙️ Ajustes</h2>
      <label>Tijolos novos por dia: <b id="npd-v">${S.settings.newPerDay}</b>
        <input type="range" id="npd" min="3" max="15" value="${S.settings.newPerDay}">
      </label>
      <p class="hint">Sem tempo? 5–6 por dia já dá ~500 frases em 3 meses. Mais que 10 vira revisão demais amanhã.</p>
      <label>Velocidade da voz: <b id="rate-v">${S.settings.rate}</b>
        <input type="range" id="rate" min="0.6" max="1.2" step="0.05" value="${S.settings.rate}">
      </label>
      <label>Voz em inglês
        <select id="voice"><option value="">Automática</option>${voices.map((v) => `<option value="${h(v.voiceURI)}" ${v.voiceURI === S.settings.voiceURI ? 'selected' : ''}>${h(v.name)} (${h(v.lang)})</option>`).join('')}</select>
      </label>
      <button class="btn small" data-act="testvoice">🔊 Testar voz</button>
    </section>
    <section class="card">
      <h3>Temas ativos</h3>
      ${DECKS.map((dk) => `<label class="check"><input type="checkbox" data-deck="${dk.id}" ${S.settings.decks.includes(dk.id) ? 'checked' : ''}> ${dk.emoji} ${h(dk.title)} <small class="muted">— ${h(dk.desc)}</small></label>`).join('')}
    </section>
    <section class="card">
      <h3>🤖 Coach IA (opcional, grátis)</h3>
      <p class="muted">Chave do Google Gemini (<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">pegar aqui</a>). Fica só neste aparelho e só é enviada para o Google. Não vai no backup.</p>
      <div class="pw">
        <input type="password" id="gkey" value="${h(S.settings.geminiKey)}" placeholder="Cole a chave aqui" autocomplete="off">
        <button class="btn small" data-act="eye" title="Mostrar/esconder">👁️</button>
      </div>
      <label>Modelo <input id="model" value="${h(S.settings.model)}"></label>
      <button class="btn small" data-act="testkey">Testar chave</button>
      <span id="keyres" class="muted"></span>
    </section>
    <section class="card">
      <h3>⭐ Meus tijolos</h3>
      <p class="muted">Frases que VOCÊ precisa (do seu trabalho, da sua vida). As mais pessoais são as que mais grudam.</p>
      <input id="cen" placeholder="Frase em inglês">
      <input id="cpt" placeholder="Tradução em português">
      <button class="btn small" data-act="addc">+ Adicionar</button>
      <ul class="custom">${S.custom.map((c) => `<li><span><b>${h(c.en)}</b> — ${h(c.pt)}</span><button class="btn small" data-act="delc" data-id="${h(c.id)}">✕</button></li>`).join('') || '<li class="muted">Nenhum ainda.</li>'}</ul>
    </section>
    <section class="card">
      <h3>Backup</h3>
      <p class="muted">Seu progresso fica só neste navegador. Exporte de vez em quando ou para trocar de celular.</p>
      <div class="row">
        <button class="btn small" data-act="export">⬇️ Exportar</button>
        <label class="btn small file">⬆️ Importar<input type="file" id="import" accept="application/json" hidden></label>
        <button class="btn small danger" data-act="reset">Apagar tudo</button>
      </div>
    </section>
    <p class="muted center">Brick by Brick English · código aberto · <a href="https://github.com/diegotrindademt/brick-by-brick-english" target="_blank" rel="noopener">GitHub</a></p>
  `, {
    testvoice: () => say('Hi! This is the voice you will hear every day.'),
    eye: () => { const i = document.getElementById('gkey'); i.type = i.type === 'password' ? 'text' : 'password'; },
    testkey: async () => {
      const res = document.getElementById('keyres');
      res.textContent = 'testando...';
      try {
        await ai.chatReply({ key: S.settings.geminiKey, model: S.settings.model, scenario: 'Reply with: OK', history: [{ role: 'me', text: 'Say OK.' }] });
        res.textContent = '✅ funcionando';
      } catch (e) { res.textContent = `❌ ${e.message}`; }
    },
    addc: () => {
      if (addCustom(document.getElementById('cen').value, document.getElementById('cpt').value)) renderSettings();
    },
    delc: (el) => {
      S.custom = S.custom.filter((c) => c.id !== el.dataset.id);
      delete S.cards[el.dataset.id];
      buildCatalog();
      persist();
      renderSettings();
    },
    export: () => {
      const blob = new Blob([store.exportJson(S)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `brick-by-brick-backup-${today()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    reset: () => {
      if (!confirm('Apagar TODO o progresso deste aparelho?')) return;
      if (!confirm('Tem certeza? Não dá para desfazer (a não ser que você tenha um backup).')) return;
      S = store.reset();
      session = null;
      buildCatalog();
      renderSettings();
      updateHeader();
      toast('Progresso apagado.');
    },
  });
  const bind = (id, fn, ev = 'input') => document.getElementById(id).addEventListener(ev, fn);
  bind('npd', (e) => { S.settings.newPerDay = Number(e.target.value); document.getElementById('npd-v').textContent = e.target.value; persist(); });
  bind('rate', (e) => { S.settings.rate = Number(e.target.value); document.getElementById('rate-v').textContent = e.target.value; persist(); });
  bind('voice', (e) => { S.settings.voiceURI = e.target.value; persist(); }, 'change');
  bind('gkey', (e) => { S.settings.geminiKey = e.target.value.trim(); persist(); });
  bind('model', (e) => { S.settings.model = e.target.value.trim() || 'gemini-flash-lite-latest'; persist(); });
  view.querySelectorAll('input[data-deck]').forEach((cb) => cb.addEventListener('change', () => {
    const set = new Set(S.settings.decks);
    if (cb.checked) set.add(cb.dataset.deck); else set.delete(cb.dataset.deck);
    S.settings.decks = DECKS.map((d) => d.id).filter((id) => set.has(id));
    persist();
  }));
  bind('import', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      S = store.importJson(await file.text(), S);
      persist();
      buildCatalog();
      toast('Backup importado.');
      renderSettings();
      updateHeader();
    } catch { toast('Arquivo de backup inválido.'); }
  }, 'change');
  if (!voices.length) setTimeout(() => { if (englishVoices().length && location.hash === '#ajustes') renderSettings(); }, 800);
}

// ---------- install (PWA) ----------
let installEvt = null;
addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (location.hash === '#hoje' && !session) renderHome(); });

function installCard() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return '';
  if (installEvt) return '<section class="card"><button class="btn wide" data-act="install">📲 Instalar o app no celular</button></section>';
  if (/iphone|ipad/i.test(navigator.userAgent)) return '<section class="card muted">📲 Para instalar no iPhone: Compartilhar → "Adicionar à Tela de Início".</section>';
  return '';
}

async function doInstall() {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => {});
  installEvt = null;
  renderHome();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

updateHeader();
go(location.hash.slice(1) || 'hoje');
