// Browser speech: text-to-speech, speech recognition and voice recording.
// Everything runs on the device through standard Web APIs.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export const support = {
  tts: 'speechSynthesis' in window,
  stt: !!Recognition,
  record: !!(navigator.mediaDevices && window.MediaRecorder),
};

let cachedVoices = [];

function loadVoices() {
  if (!support.tts) return [];
  cachedVoices = window.speechSynthesis.getVoices();
  return cachedVoices;
}

if (support.tts) {
  loadVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', loadVoices);
}

export function englishVoices() {
  const voices = cachedVoices.length ? cachedVoices : loadVoices();
  return voices.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
}

function pickVoice(lang, preferredURI) {
  const voices = cachedVoices.length ? cachedVoices : loadVoices();
  if (preferredURI) {
    const v = voices.find((x) => x.voiceURI === preferredURI);
    if (v && v.lang.toLowerCase().startsWith(lang.slice(0, 2))) return v;
  }
  const exact = voices.filter((v) => v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase());
  const natural = exact.find((v) => /natural|neural|google|online/i.test(v.name));
  return natural || exact[0] || voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2))) || null;
}

export function stopSpeaking() {
  if (support.tts) window.speechSynthesis.cancel();
}

export function speak(text, { lang = 'en-US', rate = 0.95, voiceURI = null } = {}) {
  return new Promise((resolve) => {
    if (!support.tts || !text) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = rate;
    const voice = pickVoice(lang, voiceURI);
    if (voice) u.voice = voice;
    // Some engines never fire onend; a timeout keeps loops moving.
    const guard = setTimeout(resolve, 2000 + text.length * 140 / rate);
    u.onend = () => { clearTimeout(guard); resolve(); };
    u.onerror = () => { clearTimeout(guard); resolve(); };
    window.speechSynthesis.speak(u);
  });
}

// One-shot recognition. Resolves with up to 5 alternatives (best first).
export function listenOnce({ lang = 'en-US', timeoutMs = 9000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!Recognition) return reject(new Error('no-stt'));
    stopSpeaking();
    const rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    rec.continuous = false;
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { rec.stop(); } catch { /* already stopped */ }
      fn(value);
    };
    const timer = setTimeout(() => finish(resolve, []), timeoutMs);
    rec.onresult = (e) => {
      const alts = [];
      for (let i = 0; i < e.results[0].length; i += 1) alts.push(e.results[0][i].transcript);
      finish(resolve, alts);
    };
    rec.onerror = (e) => finish(e.error === 'no-speech' ? resolve : reject, e.error === 'no-speech' ? [] : new Error(e.error));
    rec.onend = () => finish(resolve, []);
    rec.start();
  });
}

// Long-form dictation for speaking answers. Returns a controller with stop().
export function dictate({ lang = 'en-US', onText } = {}) {
  if (!Recognition) throw new Error('no-stt');
  stopSpeaking();
  let finalText = '';
  let stopped = false;
  let rec;
  const start = () => {
    rec = new Recognition();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += `${t.trim()} `;
        else interim += t;
      }
      onText?.(`${finalText}${interim}`.trim());
    };
    // Mobile browsers end continuous sessions on silence: restart until stopped.
    rec.onend = () => { if (!stopped) { try { start(); } catch { /* ignore */ } } };
    rec.onerror = () => {};
    rec.start();
  };
  start();
  return {
    stop() {
      stopped = true;
      try { rec.stop(); } catch { /* ignore */ }
      return finalText.trim();
    },
    get text() { return finalText.trim(); },
  };
}

// Record the learner's voice so they can compare with the model audio.
export async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();
  return {
    stop() {
      return new Promise((resolve) => {
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })));
        };
        recorder.stop();
      });
    },
  };
}
