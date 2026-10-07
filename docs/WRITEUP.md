# Your Phone Remembers

**A phone that can be searched by meaning, not filenames.**

Developed by **Lulamile Mkhungela**.

---

## The idea

Six months ago you took a screenshot of something useful. Today you cannot find it.
Filenames like `Screenshot_20260418-210712.png` tell you nothing, and the thing you
actually remember is a feeling: *“the website with the cheap flights”*.

Your phone, meanwhile, is full of the answer. It is sitting in a screenshot, a note,
a chat, a photographed receipt, a saved page.

**Your Phone Remembers** makes that pile searchable by meaning. You ask a question the
way you remember it, and the app finds the memory and shows you the evidence:

```
You:  What was that website with the cheap flights I found?

      cheapflights.co.za/flights/jnb-cpt
        • Cheap Flights Express – JNB to Cape Town     <screenshot, Chrome>
        • Cape Town returns from R1 289                <screenshot, Chrome>
        • Tip: Tuesday and Wednesday are the cheapest  <screenshot, Chrome>
```

```
You:  What was the name of the person who recommended that mechanic?

      Thabo Mokoena
        • “My cousin Thabo does car repairs from his place in Melville”
                                                       <WhatsApp screenshot>
        • 071 555 0199 (call after 16:00)              <Notes screenshot>
      connected through 071 555 0199 → Chat with Lerato Mokoena
      same person: Thabo Mokoena     → Cape Town trip – what to book
```

That second answer is the heart of the product: the recommender's name, the number he
sent, and the trip that number was saved for live in three different places, and the
app joins them on its own.

---

## What it does

| ask | what comes back |
| --- | --- |
| what was that website with the cheap flights I found? | the site and the fares, read off a screenshot |
| what was the name of the person who recommended that mechanic? | the name, plus the memories it connects |
| how do I fix the E20 error on my washing machine? | the saved repair page, steps quoted |
| what is the wifi password at the guest house? | `Sunset2024!`, read off a photo of the card |
| when is my dentist appointment? | `Thu 15:30`, from an SMS |
| how much did the plumber charge to fix the geyser? | `R1 850`, from a note |
| what did I spend on groceries? | `R456.90` — the total, not a line item |
| what is my medical aid claim reference? | `CLM448120`, fished out of the email |

Every answer is extractive: one line of your own data, at the top, with the memory it
came from underneath it. Nothing is invented. When the phone does not know something,
it says so instead of guessing.

---

## How it works

```
 screenshots ─┐
 photos ──────┤   1. READ              2. UNDERSTAND         3. RANK               4. ANSWER
 notes ───────┤   Tesseract OCR        entities, keywords    meaning + words       the value, with
 messages ────┤   (line boxes kept     (numbers, dates,      + entity links        citations, plus
 saved pages ─┤    for highlighting)    names, sites, refs)   + recency            a confidence score
 emails ──────┘         │                     │                    │                     │
                        └────────► all-MiniLM-L6-v2 (384-d, on-device) ◄───────────────┘
```

**Reading.** Every image goes through Tesseract OCR on the device. The recognised text
becomes the memory's body, and the line boxes are kept so the app can draw the exact
places it read on top of the screenshot.

**Understanding.** A from-scratch BERT WordPiece tokenizer feeds `all-MiniLM-L6-v2`
(quantised ONNX, 384 dimensions) through ONNX Runtime. The same pass pulls out the
concrete things: phone numbers, amounts, dates, times, websites, booking references and
the names of people and places.

**Ranking.** Results are scored on five signals — semantic similarity, BM25 keyword
overlap, query-term coverage, entity matches, exact phrase and a gentle recency bias —
and then a second pass pulls in the memories that share a concrete detail with the best
match. That is what makes “who recommended that mechanic?” span three sources.

**Answering.** The headline is the value the question asked for (a number, a site, a
time, a reference, an amount, a person). The bullets are quoted from the memories, each
labelled with where it came from, and the connections panel shows the entity graph.

Everything runs locally: the embedding model and the OCR data ship with the app, the
index lives on disk, and there is no model API, no telemetry and no network call at
runtime. **No API keys are needed.**

---

## What is real, and what is sample

It is worth being precise about this.

**Real, and provable on your machine:**

- OCR reads actual pixels. Drop a screenshot in and the text it shows was read seconds
  ago — every memory reports its own confidence and read time.
- The embeddings are real 384-dimension vectors from a real model, not a keyword table.
  `npm run verify` prints a related/unrelated similarity pair to show it captures meaning.
- The index is real: built from the data, persisted to disk, rebuilt on request.
- Answers are extracted from the documents with citations, and the ranking signals
  behind every result are shown in its score breakdown.

**Sample:** the phone library that ships with the app is *generated* phone data — 19
screenshots and photos drawn from scratch (`tools/gen-samples.py`) and 22 notes,
messages, emails and saved pages (`samples/notes.json`). It is realistic, and it is
deliberately made of clean, readable images so OCR has something honest to chew on, but
it is not anybody's real phone.

### The proof that nothing is faked

The sample library ships with its OCR text written *by the pipeline*, not by hand — but
the strongest proof is to give the app something it has never seen:

```bash
python3 -c "..."           # draw a screenshot the app has never indexed
npm run ingest -- ./that-folder --source WhatsApp
```

Doing exactly that with a freshly drawn family-chat screenshot (the file is kept as
`docs/screenshots/proof-never-indexed.png`):

| step | result |
| --- | --- |
| ask before importing | nothing about it in the index |
| import the file | **OCR 94.9% in 296 ms**, title guessed as “Family group chat” |
| text read out of the pixels | `Year end braai is at Uncle Sipho's place in Soweto on 14 December` |
| ask the same question again | top match **0.782**, reason *“read from the screenshot (OCR 94.9%)”* |

Those five lines of text existed only as pixels seconds earlier. Nothing was typed in.

To search **your** phone instead:

```bash
npm start
npm run ingest -- ~/Pictures/Screenshots        # your real screenshots
npm run ingest -- ./dump --source Camera --location "Johannesburg"
```

Or use **＋ Add memories** in the app and drag images in. Either way the pipeline is
identical: real OCR, real embeddings, real answers.

---

## Results

On the sample library (41 memories, of which 19 are images read by OCR):

- 19 images read at **84.7% average OCR confidence**, ~430 ms each on CPU
- embeddings at **~2 ms per document**, ~7 ms per query end to end
- **14 of 14** demo questions return the expected value, checked by `npm run test:queries`
- **37** interface checks pass against the live app (`npm run test:ui`)

---

## Verification

```bash
npm run verify        # model + OCR self-test on this machine
npm run check:ui      # static UI integrity (hidden elements, ids, classes, layout traps)
npm run test:queries  # 14 demo questions, asserted against the value they must return
npm run test:ui       # 37 checks driving the real DOM against the running server
node tools/capture.mjs  # renders the UI in headless Chromium and reports layout faults
```

Renders of the interface are kept in `docs/screenshots/`.

---

## Built by

**Lulamile Mkhungela** — idea, product direction and development.

Built as a working answer to a simple question: *why can I search the whole internet in
a second, but not my own phone?*
