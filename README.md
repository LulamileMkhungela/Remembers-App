# Your Phone Remembers

**Search your phone by meaning, not filenames.** Developed by **Lulamile Mkhungela**.

> A full write-up of the project — the idea, how it works, and what is real versus
> sample data — is in [`docs/WRITEUP.md`](docs/WRITEUP.md).

You took a screenshot six months ago. You don't remember where it is. You ask:

> “What was that website with the cheap flights I found?”

The app searches your screenshots, photos, saved pages, notes and messages — reads
them with OCR, embeds the meaning of every one of them on the device — and answers
with the memory itself and the evidence behind it:

```
cheapflights.co.za/flights/jnb-cpt                       [website · 0.65]
  • Cheap Flights Express - JNB to Cape Town              <Cheap Flights Express>
  • cheapflights.co.za/flights/jnb-cpt                     <Cheap Flights Express>
  • Cape Town returns from R1 289                          <Cheap Flights Express>
```

Or:

> “What was the name of the person who recommended that mechanic?”

```
Thabo Mokoena                                            [person · 0.50]
  • Thabo Mokoena - mobile mechanic, Melville              <Car service notes>
  • 071 555 0199 (call after 16:00)                        <Car service notes>
  connected through 071 555 0199 → Chat with Lerato Mokoena
  same person: Thabo Mokoena   → Cape Town trip - what to book
```

The chat where the number was sent, the note where it was saved and the trip it was
saved for are linked automatically because they share a phone number and a name.

Nothing is a mock-up: Tesseract reads the pixels, all-MiniLM-L6-v2 produces real
384-dimension embeddings through ONNX Runtime, the index is persisted to disk, and
the answer is extracted from your documents with citations.

---

## Quick start

```bash
npm install      # pulls the ONNX runtime, Tesseract and the vendored MiniLM weights
npm start        # http://localhost:8787
```

On the first run the app indexes the sample phone data that ships with it
(19 screenshots/photos + 22 notes, messages, emails and saved pages) — real OCR over
the images, real embeddings for everything. It takes about nine seconds and the
index is then stored under `data/`.

Then ask the two questions above, or any of these:

| Ask | What it finds |
| --- | --- |
| how do I fix the E20 error on my washing machine? | the saved repair page, steps quoted |
| what is the wifi password at the guest house? | `Sunset2024!` read from the photo of the wifi card |
| when is my dentist appointment? | `Thu 15:30` — from the SMS |
| how much did the plumber charge to fix the geyser? | `R1 850` — notes |
| when is load shedding tonight? | `17:00 – 19:30` — EskomSePush screenshot |
| which series did Sipho tell me to watch? | `Shogun` — WhatsApp chat |
| what did I spend on groceries? | `R456.90` — the receipt photo's total |
| what is my medical aid claim reference? | `CLM448120` — the email |

Check everything at any time:

```bash
npm run verify        # model + OCR self-test on this machine
npm run check:ui      # static UI integrity: hidden elements, ids, classes, tags
npm run test:queries  # 14 demo questions, against a running server
npm run test:ui       # 37 checks driving the real DOM in a running server
```

---

## What it does

**Semantic search over your own data.** Every memory — screenshot, photo, note,
message, email, saved page — becomes a document with OCR text, extracted entities
and a MiniLM embedding. Queries are routed (`route()`), scored (`score()`) and
answered (`buildAnswer()`).

**Reading, not filenames.** Screenshots are read with Tesseract (LSTM) on the
machine. Line boxes are kept so the UI can highlight where text sits inside the
image, and OCR confidence is shown per memory.

**Hybrid ranking.** Each document is scored on five signals:

| signal | weight | what it means |
| --- | --- | --- |
| semantic | 0.50 | cosine similarity to the question (plus a synonym-expanded variant) |
| keyword | 0.26 | BM25 over the document text |
| coverage | 0.13 | share of your query terms present |
| entities | 0.075 × hits | same phone number, name, place, amount, reference |
| phrase + recency | 0.08 | exact phrase match, gently biased to recent memories |

Then a second pass pulls in memories that share a concrete detail with the best
match — that is what lets "who recommended that mechanic?" span a chat, a note and
a trip plan. Every score shows its breakdown, and every result says *why* it matched
("same number as Thabo Mokoena", "every keyword found", "read from the photo (OCR 91%)").

**Answers with citations.** The headline is the actual value from your data (a
number, a site, a time, a reference, an amount, a person), and every bullet carries
the memory it came from. The **How it connects** panel shows the entity graph, and
**When it happened** shows the matches on a timeline.

**Real ingestion.** Add your own data in the UI (drop screenshots, paste notes), from
the command line, or over the API. Images go through OCR; text is embedded directly.
The same content imported twice is remembered once.

```bash
npm start
npm run ingest -- ~/Pictures/Screenshots     # read your real screenshots
npm run ingest -- ./phone-dump --source Camera --location "Johannesburg"
```

### What is real here, and what is sample

Worth stating plainly:

- **Real:** OCR reads actual pixels (every memory reports its own confidence and read
  time), the embeddings are real 384-d vectors from a real model, the index is built
  from the data and persisted, and every answer is extracted from your documents with
  citations. `npm run verify` proves the model and OCR work on the machine you are on.
- **Sample:** the phone library that ships with the app is *generated* — 19 screenshots
  and photos drawn from scratch by `tools/gen-samples.py`, plus 22 notes, messages,
  emails and saved pages in `samples/notes.json`. It is realistic and deliberately
  clean so OCR has something honest to read, but it is not a real phone.

Point `npm run ingest` at your own screenshots, or drag them into **＋ Add memories**,
and the same pipeline runs on your real data. No API keys are involved anywhere.

---

## How it works

```
public/            the app: index.html, styles.css, app.js (no build step, no CDN)
server/
  server.js        HTTP API + static hosting
  lib/embed.js     MiniLM + a from-scratch BERT WordPiece tokenizer, ONNX Runtime
  lib/ocr.js       Tesseract worker pool, bundled English model
  lib/ingest.js    images/text -> searchable documents (OCR, entities, keywords)
  lib/entities.js  phone numbers, money, dates, times, sites, references, names
  lib/search.js    routing, hybrid scoring, answer composition, connection graph
  lib/store.js     persistent index: data/store.json + data/vectors.bin
  lib/text.js      tokenising, stemming, snippets, highlights
  lib/multipart.js dependency-free multipart parser for uploads
samples/
  gallery/         19 generated screenshots/photos (real PNGs, really OCR'd)
  notes.json       22 notes, messages, emails and saved pages
tools/
  capture.mjs        renders the real page in headless Chromium and writes
                     screenshots/ (dev aid; see "Reviewing the UI" below)
  gen-samples.py     regenerates the sample phone data with Pillow
  verify.mjs         environment + model self-test
  check-ui.mjs       static UI integrity checks (see below)
  test-queries.mjs   question -> expected value regression test
  ui-test.mjs        headless DOM test against a running server
  ingest-folder.mjs  index real screenshots/photos from a folder on this machine
  ensure-deps.mjs    runs on `npm start`; installs packages if node_modules is gone
  dev-reload.sh      restart the server / rebuild the index (dev helper)
```

The embedding model is `Xenova/all-MiniLM-L6-v2` (quantised ONNX, 384 dims), vendored
inside the `@ryanstark24/sfgraph-models` package so it is available offline. ONNX
Runtime runs on the CPU (`onnxruntime-node`, ~2 ms per embedding here) with an
`onnxruntime-web` WASM fallback. The tokenizer, mean pooling and L2 normalisation are
implemented in `server/lib/embed.js` and match the reference model.

### API

| method | path | purpose |
| --- | --- | --- |
| `POST` | `/api/search` | `{query, kinds?, sources?, limit?}` → answer, results, connections, timeline, timings |
| `GET` | `/api/search?q=` | same, shareable |
| `GET` | `/api/suggestions` | example questions |
| `GET` | `/api/documents?limit&offset&sort` | everything that is remembered |
| `GET` | `/api/documents/:id` | one memory (`/file`, `/text`, `/related` too) |
| `POST` | `/api/import/text` | index a note, message, email or saved page |
| `POST` | `/api/import/images` | multipart upload → OCR → embed |
| `POST` | `/api/ocr` | raw OCR of an image body |
| `POST` | `/api/vector` | embed text, optionally compare two texts |
| `GET` | `/api/connections?docId=` | the entity graph |
| `GET` | `/api/stats`, `/api/health` | index, model and OCR stats |
| `POST` | `/api/seed`, `/api/reset` | index the sample phone data / clear it |

### Privacy

Everything happens locally: the model and OCR data ship with the app, embeddings are
computed in-process, and the index lives in `data/` (git-ignored). There is no model
API, no telemetry and no network call at runtime.

---

## Reviewing the UI

Because layout bugs do not show up in a DOM test, the app ships a browser harness:

```bash
# once (outside the repo, ~110 MB of browser):
mkdir -p /tmp/ss && cd /tmp/ss && npm init -y
npm i puppeteer-core@23 @sparticuz/chromium@153

npm start                 # in the repo
node tools/capture.mjs    # writes screenshots/*.png at 1440/1280/900/390 px
```

It drives the real page — home, a search, the drawer with the OCR overlay, the
import panel — and reports what a human would notice: horizontal overflow, elements
wider than the viewport, text below 3.2:1 contrast, and panels with dead space. The
renders it produced are checked in under `docs/screenshots/`:

| view | file |
| --- | --- |
| answer + evidence | `docs/screenshots/desktop-search.jpg` |
| first load | `docs/screenshots/desktop-home.jpg` |
| the drawer, with OCR boxes on the wifi card | `docs/screenshots/desktop-drawer-ocr.jpg` |
| phone width | `docs/screenshots/mobile-home.jpg` |

## Why there is a `check:ui` script

Two bugs shipped in the first UI pass and neither showed up in a DOM test, because a
DOM test has no layout engine:

- `.drawer` and `.pipeline` set `display: flex`. An author `display` declaration beats
  the user-agent `[hidden] { display: none }` rule, so **both drawers and the pipeline
  strip were on screen before any interaction** — the import panel sat over the right
  half of the page.
- `.drawer-body` had `overflow: auto` but no `flex: 1; min-height: 0` inside the
  fixed-height flex drawer, so a long memory was cut off instead of scrolling.
- the brand logo in the header was written with `%5eead4`-style colours, which are
  only valid inside a `data:` URI — in the document the SVG rendered as a dark blob.

`tools/check-ui.mjs` now fails the build on that whole class of mistake: it parses
`index.html`, `styles.css` and `app.js` and checks that

1. every element carrying `hidden` has a `[hidden]` rule that actually wins the
   cascade (and reports exactly which rule would defeat it),
2. every id `app.js` looks for exists in the markup,
3. every class used anywhere has a rule,
4. every `position: fixed` panel can be hidden,
5. the HTML tags balance and grid tracks are shrinkable (`minmax(0, …)`).

`tools/ui-test.mjs` then checks the same behaviour at runtime — the drawers start
hidden, only one overlay opens at a time, the page scroll-locks while one is open and
releases it on close.

## Notes

- Node 18+ (developed on Node 22). `npm install` needs the network once, to fetch
  packages; after that the app runs offline.
- The sample phone data is generated, not scraped: `python3 tools/gen-samples.py`
  (needs Pillow) redraws all 19 images deterministically.
- `./tools/dev-reload.sh --reset` restarts the server and rebuilds the index with
  fresh OCR — handy after changing the server code, which is cached at import time.

---

Developed by **Lulamile Mkhungela**. See [`docs/WRITEUP.md`](docs/WRITEUP.md).
