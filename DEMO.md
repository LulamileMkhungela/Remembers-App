# Demo script

A five-minute run-through. Everything below works from a fresh server
(`npm install && npm start`) — the numbers are what this build actually prints.

## 0. Frame it (10 s)

Open <http://localhost:8787>. The header shows the two things that matter: the
embedding model running **on-device** (`MiniLM-L6 · 384-d · ~2 ms/embed`) and the
index size. In the footer: how many images went through OCR and the data size.

Say the line: *the library is sample phone data — the pipeline is real. Tesseract
reads the actual pixels, MiniLM embeds the meaning, and the index lives on disk.*

The first run indexes 19 screenshots/photos and 22 notes, messages, emails and saved
pages in about **9 seconds** — watch the label in the header (`indexing 12/41`).

## 1. The screenshot you can't find (60 s)

Type (or tap the chip): **“What was that website with the cheap flights I found?”**

- Headline: **cheapflights.co.za/flights/jnb-cpt** — kind `website`, confidence ~0.65.
- Facts strip: the site, the R1 289 return fare, the flight date.
- Bullets are quoted from the screenshot: *Cheap Flights Express – JNB to Cape Town*,
  the three fares, the Tuesday/Wednesday tip — each with its source memory.
- The note on the answer: **“Matched by meaning, not just keywords.”** The words
  *website* and *cheap* are not in the OCR text of that screenshot; the synonym
  expansion (`site`, `link`, `url` ↔ `cheap`, `deal`, `bargain`, `sale`) plus the
  embedding got it there.
- Click the result → the drawer shows the real screenshot with **OCR boxes** drawn
  over the text it read (toggle them), the extracted text, and the score breakdown:
  semantic / keyword / coverage / entity / phrase.
- **How it connects** (left column) already links it to the note *Cape Town trip –
  what to book*: same website, same R1 289.

## 2. The person whose name you forgot (60 s)

**“What was the name of the person who recommended that mechanic?”**

- Headline: **Thabo Mokoena** — kind `person`.
- The answer pulls the sentence from the WhatsApp screenshot where he was
  recommended (*“My cousin Thabo does car repairs from his place in Melville”*,
  *“Give him a shout on 071 555 0199”*) and cites the memory it came from.
- Open **How it connects**: `same phone number 071 555 0199 → Chat with Lerato
  Mokoena` and `same person: Thabo Mokoena → Car service notes → Cape Town trip`.
  That is three different sources (a screenshot, a note, a planning note) joined by
  the phone number and the name — the “connect your personal information” promise.
- Change the question to **“who gave me the mechanic's details?”** → the answer
  switches to **Lerato Mokoena**, because that is who sent the number. The ranker
  reads *who* differently from *what was the name of the person who recommended*.

## 3. Things a phone actually knows (60 s)

Rapid fire — each headline is a value lifted out of the data, with the memory under it:

| ask | headline |
| --- | --- |
| how do I fix the E20 error on my washing machine? | the saved repair page, steps quoted (OCR 95%) |
| what is the wifi password at the guest house? | `Sunset2024!` — read off the photo of the wifi card |
| when is my dentist appointment? | `Thu 15:30` — the SMS |
| how much did the plumber charge to fix the geyser? | `R1 850` — notes |
| when is load shedding tonight? | `17:00 – 19:30` — the EskomSePush screenshot |
| what did I spend on groceries? | `R456.90` — the photographed receipt's **total** |
| what is my medical aid claim reference? | `CLM448120` — the email, not the saved page |

Note the last two: the grocery answer picks the total over the line items, and the
claim reference is fished out of a different memory than the top-ranked one, then
labelled with where it came from.

## 4. Prove it is not staged (90 s)

Click **＋ Add memories**.

- Drag in a screenshot of your own (or a photo of a card, a receipt, a poster).
  Watch the row: `reading with OCR…` → `indexed · OCR 94.6% · battery, install`.
  That text was read from your image seconds ago, then embedded.
- Paste any text — a note, a message, a policy number — and index it.
- Ask for it in your own words, then open it and switch to the **Analysis** tab:
  the extraction details (confidence, ms, line count), the first dimensions of its
  384-d embedding, and the connected details the app pulled out of it.
- Try the honesty check: ask something the phone cannot know
  (*“where did I park the car?”*). You get “Nothing in your phone matches that yet”
  and a few follow-ups — no invented answer.

Then **Rebuild from scratch** to drop the imports and re-run OCR over the sample
library from zero.

## 5. If a dev asks (30 s)

```bash
npm run verify        # model + tokenizer + similarity + OCR self-test
npm run check:ui      # static UI integrity (hidden elements, ids, classes, layout traps)
npm run test:queries  # the 14 demo questions, each asserted against the value it must return
npm run test:ui       # 37 checks driving the real DOM against the running server
```

`npm run verify` prints the model directory, a related/unrelated similarity pair,
per-embedding milliseconds, and OCR confidence over a sample screenshot. `test:ui`
boots the page, asks a question, opens a memory, walks the drawer tabs, filters by
kind and imports a note — 25 checks, all against the live server.
