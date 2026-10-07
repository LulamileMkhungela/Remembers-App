# Demo script

A five-minute run-through. Every beat below works from a fresh server (`npm start`).

## 0. Frame it (10 s)

Open the page. Point at the left column: a phone. Point at the right: the index — **35 items, 14 meaning
dimensions, ~460 terms**, and a query time in single-digit milliseconds. Say the line: *the library is fake,
the search is not — ask it anything, it will tell you when it doesn't know.*

## 1. The screenshot you can't find (60 s)

Type (or tap the chip): **"What was that website with the cheap flights I found?"**

- Headline: **Skyscanner — from R9 420.** Facts: `R9 420`, `skyscanner.co.za`, `Safari`.
- "Why this answer" → shows the question was read as *which site*, three search terms, and that the words
  `site/page/url/link` were added by the synonym graph. **The screenshot's text never contains the word
  "website"** — that is the whole point.
- Evidence list: the Skyscanner screenshot, the saved price-calendar page, a note, a voice memo. Four sources,
  one answer.
- Tap the screenshot card → the drawer shows the captured screen, the extraction pipeline (screen → OCR,
  app + URL metadata, semantic embedding) *with confidence per stage*, and the items it connects to.
- The trail at the bottom: twelve items across seven months, five of which were used.

## 2. The person whose name you forgot (60 s)

**"What was the name of the person who recommended that mechanic?"**

- Headline: **Thabo Nkosi.** Detail: from the email he sent six months ago.
- Facts include `Phone · Contacts: 073 630 7561` — a value pulled from a *different* item than the one that
  matched best. That is the "it connects your personal information" moment.
- Then ask **"Who is Jabu?"** — and it answers **Jabu**, from the contact card, without confusing him with
  Thabo. Same library, different question, correctly disambiguated.
- Then **"How much was the car service?"** → **R3 182.90** — the *total* from the photographed invoice, not the
  R2 767.74 subtotal or the R415.16 VAT line above it.

## 3. The honesty beat — do not skip this (45 s)

**"Where did I park the car?"**

- It refuses: *"Nothing on your phone mentions 'park'. Closest guess below."* Confidence is capped, and the
  detail says the closest item is a guess, not an answer.
- Compare with **"What did I watch on Netflix?"** → *"Nothing in your library matches that."*

This is the difference between a demo and a product: a search box that always answers is a search box you
stop trusting after one confident mistake.

## 4. Meaning, not keywords (30 s)

**"the place with the pastries and the good wifi"** → the matcha café photo (screenshot-level precision, zero
exact keywords in the question beyond "wifi").

**"somewhere quiet to work in the morning"** → the same photo, because the caption mentions long tables, plug
points and quiet-before-noon. The evidence card shows the split: text match vs meaning match.

## 5. The phone keeps learning (60 s)

Right-hand panel → **Phone activity**. Four events are waiting: a text from Thabo with the garage number in it,
a Sintra train page, a price-alert screenshot, a voice memo about the wine.

- Advance the **text from Thabo** one. The toast reports the index going 35 → 36 and re-answers
  *"what is the mechanic's number?"* with the new evidence.
- Ask **"When did the flight price drop?"** *before* advancing the price alert → it hedges ("nothing mentions
  'drop'"). Advance it → the same question now answers from the new screenshot. The index is not a one-off
  import; it is the phone getting better at remembering.
- **Reset library** puts it back.

## 6. Close (30 s)

- **How it works** tab: the five-step pipeline, and the three things it deliberately does not do.
- **Privacy** tab: what's real, what's staged, and the failure modes a page like this normally hides
  (garbled transcripts, confident answers from the wrong screenshot, indexes that don't survive a reinstall).
- The kicker: open dev tools → Network. Nothing leaves the page. Search, ranking, answer synthesis, all local.

## Questions to have answers for

- **"Why not just show a list?"** A list is what you already have — the screenshot is in Photos somewhere. The
  answer, the confidence and the evidence are the product.
- **"What if the OCR is wrong?"** Then the item is ranked down (`trust`) and the drawer shows which stage was
  weak. You can see the blurry sunset photo score lower than the receipt.
- **"Does it scale?"** The fusion and gating scale; `buildIndex` is written so the semantic space can be swapped
  for an incremental ANN index without touching the API.
