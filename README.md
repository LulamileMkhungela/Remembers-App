# Remembers — your phone, searchable by meaning

> Imagine taking a screenshot of something six months ago. You don't remember where it is.
> You ask: *"What was that website with the cheap flights I found?"*
> It searches your screenshots, photos, saved pages, notes, mail, voice memos and calendar — and finds it.

This repository is a working implementation of that idea. Not a mockup: the library is a demo dataset, but
**the retrieval is real** — BM25 over a weighted on-device text index, fused with a truncated-SVD semantic
space, with kind/source/person/time gates and a confidence model. Ask it something the library cannot support
and it will tell you, instead of inventing an answer.

```
npm start        # http://localhost:5173
npm test         # 41 tests, no dependencies
```

Zero dependencies. Node 18+. No build step, no network calls at runtime, no CDN, no fonts.

---

## The two questions from the pitch

| You ask | It answers | How |
| --- | --- | --- |
| *"What was that website with the cheap flights I found?"* | **Skyscanner — from R9 420.** + the screenshot, the saved price-calendar page, the note and the voice memo that all agree | The screenshot's OCR text never contains the word "website". It matches on *meaning*, and the answer is corroborated across four sources. |
| *"What was the name of the person who recommended that mechanic?"* | **Thabo Nkosi.** + the phone number `073 630 7561` lifted from a *different* item (his email and your contact card) | The best-matching note names two people — Thabo (who sent you) and Jabu (who you ask for at the counter). The recommender wins because of *how* he is mentioned. |

Also worth trying: *"How much was the car service?"* (finds the total on a photographed invoice), *"Where is
that café with the wifi?"*, *"Show me my voice memos"*, *"What did I save about focus?"* — and the honesty
cases: *"Where did I park the car?"* (refuses to guess) and *"What did I watch on Netflix?"* (nothing matched).

## How it works

```
 screenshots ─┐
 photos ──────┤  1. extract          2. index                3. rank                   4. answer
 saved pages ─┤  OCR, captions,      weighted term bag       BM25      (words)         grounded text,
 notes ───────┤  speech-to-text,     + synonym graph         LSA/SVD   (meaning)       facts, evidence,
 mail ────────┤  EXIF, metadata      + per-item trust        fused 44/56              confidence
 voice memos ─┤                                              gates: kind, source,
 calendar ────┤                                              person, time window
 contacts ────┘
```

- **`server/nlp.js`** — tokenising, stopwords, a synonym graph (`cheap` ↔ `cheapest` ↔ `deal` ↔ `fare`),
  entity extraction (money, phone numbers, dates, names) and query understanding (intent, filters, time window).
- **`server/search.js`** — the index and the two rankers. BM25 (k₁ 1.42, b 0.72) over field-weighted terms, plus
  LSA: a truncated SVD of the term–document matrix computed with a Jacobi eigen decomposition, 14 dimensions.
  Fused 44 % lexical / 56 % semantic, then multiplied by gates (wrong kind ×0.22, wrong source ×0.30, missing
  person ×0.55, outside a stated window ×0.25), a rare-term gate, an answerability prior and a recency term.
- **`server/answer.js`** — assembles the reply *only* from what was retrieved. Picks the figure that answers the
  question (`total` beats a line item; `per night` beats the stay total), disambiguates people, borrows the
  value the top hit is missing from the item that has it (labelled), and computes confidence from match
  strength, term coverage, margin over the runner-up and extraction quality.
- **`server/simulator.js`** — the events that keep arriving on a real phone (a text with a number in it, a
  page you looked up, a price alert, a voice memo). Advance one and the index grows, live.

## What's real and what's staged

**Real:** the retrieval pipeline, the confidence model, the honest refusals, the index rebuild, the API, the UI.

**Staged, and labelled as such in the UI:** the library itself (35 items written for the demo, with dates
generated relative to today), the "extracted text" (the OCR/caption/transcript output a real device would
produce is pre-baked into each item), and the deep links (which resolve to the in-browser equivalents).

**Also staged:** the demo photos and the rendered "screenshots" under `data/views/` are AI-generated images and
hand-built HTML pages that stand in for real captures.

**What a real build would change:** OCR/captioning/transcription would run on-device (Vision / ML Kit / a local
Whisper), the index would live in a local database rebuilt incrementally, and permissions/retention would be
per-source. The privacy story is the point: this page makes no network calls at runtime.

## Layout

```
server/index.js      HTTP server + static files (binds 0.0.0.0)
server/api.js        routes: /api/ask, /api/search, /api/library, /api/item/:id, /api/simulator, /view/:id
server/store.js      the library + index, and the per-item "what was extracted" panel
server/{nlp,search,answer}.js   the engine
server/simulator.js  the phone-activity events
data/corpus.js       the 35-item demo library
data/views/*.html    eight "captured screens" re-rendered as real pages
public/              the client: index.html, styles.css, app.js (vanilla ES modules)
test/                engine + HTTP tests
```

## API

```bash
curl -s localhost:5173/api/ask -H 'content-type: application/json' \
  -d '{"q":"What was that website with the cheap flights I found?"}' | jq .answer
```

`/api/ask` returns the answer (headline, detail, facts, confidence with per-signal breakdown), the evidence
list with snippets and per-result explanations, the retrieval trace (terms, expansion, entities, timings) and
a chronological trail of the items involved. `/api/search` is the same without the answer synthesis.

## Known limits

- Speech-to-text on accents and noise is the weak link in any build of this; a garbled transcript is invisible
  later. The demo shows per-item extraction confidence so the failure mode is at least visible.
- Semantic search fails quietly. A confident sentence built from the wrong screenshot is the failure this
  design spends the most effort on — hence hedging, coverage display and a margin term in the confidence.
- The semantic space is rebuilt in memory at startup. At real phone scale (tens of thousands of items) it wants
  an incremental ANN index; the interface here (`buildIndex` → `searchIndex`) is where that would slot in.
