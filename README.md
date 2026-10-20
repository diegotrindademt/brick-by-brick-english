# Brick by Brick English 🧱

**English for Brazilians who want to work with AI.**
A speaking-first trainer for busy adults: 20 minutes a day, in the order that research says works — learn, recall, repeat, speak — with the vocabulary of AI jobs and the mistakes Brazilians actually make.

**Live app:** https://diegotrindademt.github.io/brick-by-brick-english/ (installable on Android/iPhone, works offline)

The interface is in Brazilian Portuguese because the learner is a Brazilian at A2–B1 level. Code and docs are in English.

## Who it is for

Brazilian adults who build (or want to build) a career in AI — engineering, automation, AI products — and need to pass an interview in English, talk in meetings and understand native speakers. Built by a Brazilian self-taught AI builder for his own move into international AI work.

## What it combines (and where each idea comes from)

No single method is "the best". The app stacks the techniques with the strongest evidence and adapts each one to Portuguese speakers:

| Technique | Inspired by | Evidence | What is specific to Brazilians here |
|---|---|---|---|
| **Spaced repetition of short phrases** | SuperMemo SM-2 / Anki | Distributed practice beats cramming ([Cepeda et al., 2006](https://doi.org/10.1037/0033-2909.132.3.354)) | Whole sentences ("chunks"), not word lists |
| **Production-first recall**: read Portuguese, *say* the English, then check | Pimsleur, sentence mining (Glossika) | Retrieval practice ([Roediger & Karpicke, 2006](https://doi.org/10.1111/j.1467-9280.2006.01693.x)); saying aloud improves memory ([MacLeod et al., 2010](https://doi.org/10.1037/a0018785)) | Speech recognition checks what you said |
| **Contrastive error drills** ("I have 40 years" → "I'm 40") | Classic contrastive analysis, Language Transfer | Explicit focus on form works for adults ([Norris & Ortega, 2000](https://doi.org/10.1111/0023-8333.00136)) | 30 of the most common Portuguese-transfer errors |
| **Cognates and false friends** | Language Transfer | Portuguese gives thousands of words for free (-ção → -tion) | actually, pretend, push, parents, eventually… |
| **Shadowing** + record and compare | Alexander Arguelles' shadowing | Rhythm and prosody practice for intelligibility | Slow (0.7x) then natural speed |
| **Pronunciation by minimal pairs** | ELSA-style feedback | Aim for *intelligibility*, not a native accent ([Derwing & Munro, 2015](https://doi.org/10.1075/lllt.42)) | TH, final -ED, initial R, the extra "i" (big-i), ship/sheep, dark L, final M, word stress |
| **Dictation of connected speech** ("gonna", "whatcha", flap T) | Dictogloss / dictation | Bottom-up listening is the main gap for intermediate learners | 20 high-frequency reductions with tips in Portuguese |
| **AI vocabulary with pronunciation** | — | Self-relevant material is remembered better ([Rogers et al., 1977](https://doi.org/10.1037/0022-3514.35.9.677)) | data, cache, query, Python, GitHub, latency, schema… written the way a Brazilian reads them |
| **AI conversation partner** | Speak, Praktika | Interaction with feedback | Role-plays for AI job interviews, plus life abroad; corrections in Portuguese turn into new cards |
| **Fixed 20-minute session + 12-week plan** | Habit research | Implementation intentions ([Gollwitzer, 1999](https://doi.org/10.1037/0003-066X.54.7.493)) | One button: "start" |

Adults are not worse learners: older learners progress *faster* than children in the first months ([Snow & Hoefnagel-Höhle, 1978](https://doi.org/10.2307/1128953)). What they lack is time, so the app removes every decision except "start".

An honest note on speed: expect roughly 180–200 guided hours per CEFR level. Twenty focused minutes a day plus real conversations moves an A2 speaker to a confident B1 in about 3 months — enough for a structured interview.

## Features

- **Today**: 1) new bricks → 2) spaced review (speak before you reveal) → 3) shadowing → 4) one interview question per day, answered out loud with live transcript, words-per-minute and optional AI correction.
- **Listen**: hands-free audio loop (EN → pause → PT → slow EN) with screen wake lock, and **dictation** of natural-speed connected speech.
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
js/data.js          content: ~280 bricks in 9 topics, pronunciation drills, dictation, interview questions, 12-week plan
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
