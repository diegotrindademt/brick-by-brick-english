# Brick by Brick English 🧱

**An English trainer for busy adults (40+) who need to *speak* — fast.**
Built by a former bricklayer turned AI builder, for people like him: no time to waste, a real goal (a job interview, a move abroad), and a family to take care of.

**Live app:** https://diegotrindademt.github.io/brick-by-brick-english/ (installable on Android/iPhone, works offline)

The interface is in Brazilian Portuguese because the target learner is a Brazilian at A2–B1 level. All code and docs are in English.

---

## Why another English app?

Most apps optimize for streaks and taps. Adults with 20 minutes a day need the opposite: fewer features, the right order, and a lot of speaking out loud. Every feature here maps to a learning-science result:

| Feature | Evidence behind it |
|---|---|
| **Spaced repetition** of short phrases ("bricks"), SM-2 style scheduler | Distributed practice beats cramming ([Cepeda et al., 2006](https://doi.org/10.1037/0033-2909.132.3.354)) |
| **Production-first review**: see Portuguese, *say* the English, then check | Retrieval practice ([Roediger & Karpicke, 2006](https://doi.org/10.1111/j.1467-9280.2006.01693.x)) and the production effect — saying words aloud improves memory ([MacLeod et al., 2010](https://doi.org/10.1037/a0018785)) |
| **Chunks, not word lists** (interview, tech talk, life abroad) | Frequent multi-word expressions drive fluency; adults learn them fast because they already know the concepts |
| **Shadowing** at 0.7x and 1x + record-and-compare | Prosody and rhythm practice for intelligibility |
| **Pronunciation for Brazilians** (TH, final -ED, initial R, epenthetic "i", ship/sheep, dark L, final M, word stress) with minimal pairs and speech recognition | The goal is *intelligibility*, not a native accent ([Derwing & Munro, 2015](https://doi.org/10.1075/lllt.42)) |
| **Cognates and false friends** | Portuguese gives adults thousands of words for free (-ção → -tion, -mente → -ly) |
| **Personal pitch + "My bricks"** (phrases from your own life and AI corrections) | Self-referential material is remembered better ([Rogers et al., 1977](https://doi.org/10.1037/0022-3514.35.9.677)) |
| **Fixed 20-minute session in 4 steps** and a 12-week plan with concrete targets | Implementation intentions ("when X, I do Y") make habits stick ([Gollwitzer, 1999](https://doi.org/10.1037/0003-066X.54.7.493)) |
| **Hands-free mode** (EN → pause → PT → slow EN) | Uses dead time: commuting, construction work, chores |

Adults are not worse learners: older learners progress *faster* than children in the first months ([Snow & Hoefnagel-Höhle, 1978](https://doi.org/10.2307/1128953)). What they lack is time, so the app removes every decision except "start".

An honest note on speed: expect roughly 180–200 guided hours per CEFR level. Twenty focused minutes a day plus real conversations moves an A2 speaker to a confident B1 in about 3 months — enough to handle a structured interview.

## Features

- **Today**: 1) new bricks → 2) spaced review (speak before you reveal) → 3) shadowing → 4) one interview question per day, answered out loud with live transcript, words-per-minute and optional AI correction.
- **Listen**: hands-free audio loop for the car or the job site, with screen wake lock.
- **Pronunciation**: 8 trouble spots for Brazilian speakers, minimal pairs checked by speech recognition.
- **AI Coach** (optional, bring your own free Gemini key): role-plays (job interview, explaining your project, school enrollment, pediatrician, renting, small talk), inline corrections in Portuguese, writing correction, pitch rewriting. Corrections can be turned into new bricks with one tap.
- **Progress**: streak, minutes, bricks per topic, 12-week plan, free level test link (EF SET).
- **Privacy**: no backend, no account, no tracking. Progress lives in `localStorage`; export/import a JSON backup. The API key never leaves the browser except to call Google, and is excluded from backups.

## Architecture

```
index.html          app shell + tab bar
css/style.css       mobile-first, light/dark, 48px touch targets
js/app.js           views, router, daily session state machine
js/srs.js           spaced repetition scheduler (pure, tested)
js/text.js          transcript vs. target comparison (LCS over normalized words, pure, tested)
js/speech.js        Web Speech API (TTS + recognition) and MediaRecorder
js/ai.js            Gemini client: model fallback chain, timeouts, JSON-mode responses
js/store.js         localStorage persistence, backup/restore
js/data.js          content: ~250 bricks, pronunciation drills, interview questions, 12-week plan
sw.js               offline cache (network-first)
tests/              node:test unit tests (scheduler, scoring, content integrity)
```

Design decisions:

- **Zero build, zero dependencies.** Plain ES modules served as static files. Nothing to install, nothing to break, free hosting on GitHub Pages.
- **Pure core, thin UI.** Scheduling and scoring are pure functions with unit tests; the browser-only parts (speech, storage) are isolated behind small modules.
- **Resilient AI calls.** Free-tier models get overloaded or retired. `ai.js` tries a chain of fast "lite" models with a 25 s timeout per call and only gives up on non-retryable errors (e.g. invalid key). The app is fully usable without AI.
- **Speech scoring that forgives the recognizer.** Contractions, digits and punctuation are normalized ("40" = "forty", "I'm" = "I am") and the best of 5 recognition alternatives is scored, so learners are judged on what they said, not on recognizer quirks.

## Run locally

```bash
python -m http.server 8000
# open http://localhost:8000
```

Speech recognition works best in Chrome (desktop or Android). Safari supports text-to-speech; recognition support varies.

## Tests

```bash
node --test tests/*.test.mjs
```

CI runs the same tests on every push (GitHub Actions).

## Roadmap

- Sync between devices (optional, end-to-end encrypted)
- Listening comprehension with short real-world clips
- Interview mode that scores answers against a rubric (STAR structure, clarity, length)

## License

MIT — see [LICENSE](LICENSE).
