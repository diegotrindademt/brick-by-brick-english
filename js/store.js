// Local persistence. Everything stays in this browser; export/import makes backups.

const KEY = 'bbe.v1';

const DEFAULTS = {
  cards: {},
  custom: [],
  log: {},
  pitch: '',
  plan: {},
  introduced: {},
  settings: {
    newPerDay: 6,
    rate: 0.95,
    voiceURI: '',
    decks: ['base', 'interview', 'errors', 'aiterms', 'story', 'tech', 'life', 'work', 'friends'],
    geminiKey: '',
    model: 'gemini-flash-lite-latest',
    autoSpeak: true,
  },
};

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const data = JSON.parse(raw);
    const state = { ...structuredClone(DEFAULTS), ...data, settings: { ...DEFAULTS.settings, ...(data.settings || {}) } };
    // v2 added two decks: switch them on once for people who installed v1.
    if (!state.v2) {
      for (const d of ['errors', 'aiterms']) if (!state.settings.decks.includes(d)) state.settings.decks.push(d);
      state.v2 = true;
    }
    return state;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function exportJson(state) {
  // Never put the API key in a backup file.
  const copy = { ...state, settings: { ...state.settings, geminiKey: '' } };
  return JSON.stringify(copy, null, 2);
}

export function importJson(text, current) {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.cards) throw new Error('Arquivo inválido');
  return {
    ...structuredClone(DEFAULTS),
    ...data,
    settings: { ...DEFAULTS.settings, ...(data.settings || {}), geminiKey: current.settings.geminiKey },
  };
}

export function reset() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return structuredClone(DEFAULTS);
}
