// Text helpers: comparing what the learner said with the target sentence.
// Pure functions, testable in Node.

const CONTRACTIONS = {
  "i'm": 'i am', "you're": 'you are', "we're": 'we are', "they're": 'they are',
  "he's": 'he is', "she's": 'she is', "it's": 'it is', "that's": 'that is',
  "what's": 'what is', "how's": 'how is', "there's": 'there is', "let's": 'let us',
  "i've": 'i have', "we've": 'we have', "you've": 'you have', "i'll": 'i will',
  "we'll": 'we will', "you'll": 'you will', "i'd": 'i would', "we'd": 'we would',
  "don't": 'do not', "doesn't": 'does not', "didn't": 'did not', "isn't": 'is not',
  "aren't": 'are not', "wasn't": 'was not', "can't": 'cannot', "won't": 'will not',
  "haven't": 'have not', "hasn't": 'has not', "couldn't": 'could not', "wouldn't": 'would not',
};

const NUMBERS = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six',
  7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 12: 'twelve', 14: 'fourteen',
  16: 'sixteen', 40: 'forty', 56: 'fifty six', 90: 'ninety', 100: 'one hundred',
};

export function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\b[a-z]+'[a-z]+\b/g, (w) => CONTRACTIONS[w] || w.replace(/'/g, ''))
    .replace(/\b\d+\b/g, (n) => NUMBERS[n] || n)
    .replace(/%/g, ' percent')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

// Longest common subsequence over words: which target words were said, in order.
export function compare(target, said) {
  const t = normalize(target);
  const s = normalize(said);
  const dp = Array.from({ length: t.length + 1 }, () => new Array(s.length + 1).fill(0));
  for (let i = t.length - 1; i >= 0; i -= 1) {
    for (let j = s.length - 1; j >= 0; j -= 1) {
      dp[i][j] = t[i] === s[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const words = t.map((w) => ({ w, ok: false }));
  let i = 0;
  let j = 0;
  while (i < t.length && j < s.length) {
    if (t[i] === s[j]) {
      words[i].ok = true;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  const matched = words.filter((x) => x.ok).length;
  const score = t.length ? Math.round((matched / t.length) * 100) : 0;
  return { score, words };
}

// Best score across several recognition alternatives.
export function bestMatch(target, alternatives) {
  let best = { score: 0, words: normalize(target).map((w) => ({ w, ok: false })), said: '' };
  for (const alt of alternatives || []) {
    const r = compare(target, alt);
    if (r.score > best.score) best = { ...r, said: alt };
  }
  return best;
}

export function wordCount(text) {
  return normalize(text).length;
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Small stable hash so card ids survive content reordering.
export function hashId(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
