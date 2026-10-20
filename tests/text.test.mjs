import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, compare, bestMatch, wordCount, escapeHtml, hashId } from '../js/text.js';
import { DECKS, PRONUNCIATION, QUESTIONS, PLAN, DICTATION } from '../js/data.js';

test('normalize expands contractions and drops punctuation', () => {
  assert.deepEqual(normalize("I'm not sure I understood."), ['i', 'am', 'not', 'sure', 'i', 'understood']);
  assert.deepEqual(normalize('I’m here!'), ['i', 'am', 'here']);
  assert.deepEqual(normalize('fifty-six'), ['fifty', 'six']);
});

test('spoken reductions match the full form', () => {
  assert.equal(compare('What do you want to do?', 'what do you wanna do').score, 100);
  assert.equal(compare("I'm going to call you later.", 'im gonna call you later').score, 100);
});

test('numbers said as digits still match the written words', () => {
  const r = compare('The accuracy went from forty to fifty-six percent.', 'the accuracy went from 40 to 56%');
  assert.equal(r.score, 100);
});

test('compare marks missing words in order', () => {
  const r = compare('I agree with you', 'I agree you');
  assert.equal(r.score, 75);
  assert.deepEqual(r.words.map((w) => w.ok), [true, true, false, true]);
});

test('bestMatch picks the best recognition alternative', () => {
  const r = bestMatch('Think about it', ['sink about it', 'think about it']);
  assert.equal(r.score, 100);
  assert.equal(r.said, 'think about it');
});

test('wordCount and escapeHtml', () => {
  assert.equal(wordCount("Let's keep it simple."), 5);
  assert.equal(escapeHtml('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});

test('content is complete and ids are unique', () => {
  const ids = new Set();
  let total = 0;
  for (const deck of DECKS) {
    assert.ok(deck.items.length >= 10, deck.id);
    for (const [en, pt] of deck.items) {
      assert.ok(en && pt, `${deck.id}: ${en}`);
      const id = `${deck.id}:${hashId(en)}`;
      assert.ok(!ids.has(id), `duplicate ${id} ${en}`);
      ids.add(id);
      total += 1;
    }
  }
  assert.ok(total >= 200, `only ${total} bricks`);
  assert.equal(PLAN.length, 12);
  assert.ok(QUESTIONS.every((q) => q.q && q.pt && q.a));
  assert.ok(PRONUNCIATION.every((p) => (p.pairs || p.words).length && p.sentence));
  assert.ok(DICTATION.length >= 15 && DICTATION.every((d) => d.en && d.tip));
  // Typing exactly what was heard must score 100%.
  assert.ok(DICTATION.every((d) => compare(d.en, d.en).score === 100));
});
