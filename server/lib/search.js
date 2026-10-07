/**
 * Search: meaning first, evidence always.
 *
 * 1. route()      - read the question: entities, filters, time window, intent
 * 2. score()      - hybrid rank: MiniLM semantic similarity + BM25 keywords +
 *                   literal entity matches + phrase coverage + gentle recency
 * 3. answer()     - extractive answer with citations from the actual documents
 * 4. connect()    - link documents that share the same phone number / name /
 *                   place / amount so "who recommended that mechanic?" spans
 *                   a chat, a note and a booking
 */

import { cosine } from "./embed.js";
import { cleanText, contentTokens, stem, tokenize, snippet, termCoverage, truncate, relativeDate } from "./text.js";
import { extractEntities, entityIdentity, phoneKey } from "./entities.js";

/* ------------------------------------------------------------- synonyms ---- */

const SYNONYM_GROUPS = [
  ["cheap", "affordable", "budget", "inexpensive", "low cost", "deal", "discount", "bargain", "sale"],
  ["flight", "flights", "airline", "airfare", "plane", "return ticket", "fly"],
  ["mechanic", "car repair", "garage", "auto repair", "technician", "panel beater", "workshop", "car service"],
  ["number", "phone number", "cell", "mobile", "contact details", "telephone", "dial"],
  ["website", "site", "web page", "web address", "link", "url"],
  ["screenshot", "screen grab", "capture"],
  ["wifi", "wi-fi", "wireless", "internet password", "network password"],
  ["password", "passcode", "pin", "login", "credentials"],
  ["dentist", "dental", "tooth", "teeth", "doctor", "appointment"],
  ["washing machine", "washer", "laundry", "drain pump", "error code"],
  ["recipe", "how to cook", "ingredients", "dinner", "dish"],
  ["gym", "fitness", "pilates", "spin", "workout", "studio", "classes"],
  ["hike", "hiking", "trail", "walk", "nature reserve", "park"],
  ["receipt", "till slip", "invoice", "proof of payment", "till"],
  ["insurance", "medical aid", "claim", "policy", "cover"],
  ["load shedding", "loadshedding", "power cut", "outage", "stage 4"],
  ["jacket", "coat", "clothing", "clothes", "winter wear"],
  ["parking", "bay", "parkade", "parking garage"],
  ["plumber", "geyser", "leak", "burst pipe", "drain"],
  ["series", "show", "tv show", "to watch", "series to watch"],
  ["trip", "holiday", "weekend away", "getaway", "travel"],
  ["booking", "reservation", "confirmation", "booked"],
  ["tax", "sars", "efiling", "return"],
];

const SYNONYMS = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    const list = SYNONYMS.get(term) || new Set();
    for (const other of group) if (other !== term) list.add(other);
    SYNONYMS.set(term, list);
  }
}

/* -------------------------------------------------------------- routing ---- */

const KIND_HINTS = [
  { re: /\b(screenshot|screenshots|screen shot|screen grab)\b/i, kind: "screenshot" },
  { re: /\b(photo|photos|picture|pictures|image|images|camera)\b/i, kind: "photo" },
  { re: /\b(note|notes|notepad|memo)\b/i, kind: "note" },
  { re: /\b(saved page|saved link|article|web page|how to|guide|steps)\b/i, kind: "page" },
  { re: /\b(sms|text message|messages?)\b/i, kind: "message" },
  { re: /\b(email|e-mail|mail)\b/i, kind: "email" },
];

const SOURCE_HINTS = [
  { re: /\bwhatsapp\b/i, source: "WhatsApp" },
  { re: /\binstagram|insta\b/i, source: "Instagram" },
  { re: /\b(chrome|browser|website|browsing)\b/i, source: "Chrome" },
  { re: /\bmaps|google maps\b/i, source: "Maps" },
  { re: /\bnotes app\b/i, source: "Notes" },
  { re: /\b(gmail|email|e-mail)\b/i, source: "Gmail" },
  { re: /\b(sms|messages)\b/i, source: "Messages" },
  { re: /\bcamera|photo(s)?\b/i, source: "Camera" },
];

function parseTimeWindow(q, now = new Date()) {
  const lower = q.toLowerCase();
  const mk = (from, to, label) => ({ from: from.toISOString(), to: to.toISOString(), label });
  const y = now.getFullYear();
  const m = now.getMonth();

  const yearMatch = lower.match(/\b(20\d{2})\b/);
  if (yearMatch && !/\b\d{4}\b.*\b(km|rand|r\d)\b/.test(lower)) {
    const yy = Number(yearMatch[1]);
    return mk(new Date(Date.UTC(yy, 0, 1)), new Date(Date.UTC(yy + 1, 0, 1)), `in ${yy}`);
  }
  const monthNames = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b${monthNames[i]}\\b|\\b${monthNames[i].slice(0, 3)}\\b`, "i").test(lower)) {
      const year = /last year/.test(lower) ? y - 1 : y;
      const from = new Date(year, i, 1);
      const to = new Date(year, i + 1, 1);
      if (from > now) from.setFullYear(year - 1), to.setFullYear(year - 1);
      return mk(from, to, `in ${monthNames[i]}`);
    }
  }
  if (/\b(yesterday|last night)\b/.test(lower)) {
    const from = new Date(now.getTime() - 86400000);
    return mk(new Date(from.getFullYear(), from.getMonth(), from.getDate()), new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1), "yesterday");
  }
  if (/\btoday\b/.test(lower)) {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return mk(from, new Date(from.getTime() + 86400000), "today");
  }
  if (/\b(last week|this week|past week)\b/.test(lower)) return mk(new Date(now.getTime() - 7 * 86400000), new Date(now.getTime() + 86400000), "this week");
  if (/\b(last month|past month|a month ago|one month ago)\b/.test(lower)) return mk(new Date(now.getTime() - 31 * 86400000), new Date(now.getTime() + 86400000), "the last month");
  if (/\b(last year|past year)\b/.test(lower)) return mk(new Date(y - 1, m, 1), new Date(y, m, 1), "the last year");
  if (/\b(this year)\b/.test(lower)) return mk(new Date(y, 0, 1), new Date(y + 1, 0, 1), "this year");
  const monthsAgo = lower.match(/\b(\d+|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+months? ago\b/);
  if (monthsAgo) {
    const words = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
    const n = Number(monthsAgo[1]) || words[monthsAgo[1]] || 1;
    const centre = new Date(now.getFullYear(), now.getMonth() - n, now.getDate());
    return mk(new Date(centre.getTime() - 15 * 86400000), new Date(centre.getTime() + 15 * 86400000), `${n} month${n === 1 ? "" : "s"} ago`);
  }
  return null;
}

/** Read the natural-language question. */
export function route(query, now = new Date()) {
  const raw = cleanText(query);
  const lower = raw.toLowerCase();
  const { entities } = extractEntities(raw);

  const kinds = new Set();
  for (const hint of KIND_HINTS) if (hint.re.test(lower)) kinds.add(hint.kind);

  const sources = new Set();
  for (const hint of SOURCE_HINTS) if (hint.re.test(lower)) sources.add(hint.source);

  const timeWindow = parseTimeWindow(raw, now);

  let intent = "lookup";
  if (/^(what|where|when|who|why|how|which|whose|did|do|does|can|is|are|was|were|show|find|tell)\b/.test(lower) || raw.includes("?")) intent = "question";
  if (/^(open|show me|go to|take me to)\b/.test(lower)) intent = "navigate";

  // query variants for semantic search (synonym expansion keeps recall high)
  const variants = new Set([raw]);
  const expansions = [];
  for (const token of contentTokens(raw)) {
    const syns = SYNONYMS.get(token);
    if (syns) {
      for (const s of [...syns].slice(0, 4)) expansions.push(s);
    }
  }
  const phrasesToTry = [...new Set(expansions)].slice(0, 6);
  if (phrasesToTry.length) variants.add(phrasesToTry.join(" "));

  const terms = contentTokens(raw).filter((t) => !["find", "found", "remember", "name", "called", "thing", "site", "web"].includes(t));

  const firstName = entities.find((e) => e.type === "name");
  const rewritten = firstName && intent === "question" ? truncate(raw, 120) : truncate(raw, 120);

  return {
    raw,
    intent,
    entities,
    kinds: [...kinds],
    sources: [...sources],
    timeWindow,
    terms,
    variants: [...variants],
    expansions: phrasesToTry,
    rewritten,
  };
}

/* -------------------------------------------------------------- scoring ---- */

function bm25(queryTerms, docs) {
  const N = docs.length || 1;
  const df = new Map();
  const docStems = docs.map((d) => tokenize(d.text).map(stem));
  docStems.forEach((stems) => {
    for (const t of new Set(stems)) df.set(t, (df.get(t) || 0) + 1);
  });
  const avgLen = docStems.reduce((s, t) => s + t.length, 0) / N || 1;
  const k1 = 1.4;
  const b = 0.72;
  const scored = new Map();
  docs.forEach((doc, i) => {
    const stems = docStems[i];
    const tf = new Map();
    for (const t of stems) tf.set(t, (tf.get(t) || 0) + 1);
    let score = 0;
    for (const term of new Set(queryTerms.map(stem))) {
      const f = tf.get(term);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * stems.length) / avgLen)));
    }
    scored.set(doc.id, score);
  });
  const max = Math.max(...scored.values(), 0.0001);
  for (const [id, s] of scored) scored.set(id, s / max);
  return scored;
}

/**
 * Hybrid scoring of every vectorised document against a routed query.
 * @returns {Array<{doc, score, breakdown, reasons}>}
 */
export async function score(routed, store, embedder, { limit = 12, filters = {} } = {}) {
  let docs = store.vectorised();
  if (!docs.length) return { results: [], all: [], filterNote: "nothing indexed yet" };

  // hard filters from the question
  const kindFilter = filters.kinds?.length ? filters.kinds : routed.kinds;
  const sourceFilter = filters.sources?.length ? filters.sources : routed.sources;
  let filterNote = "";
  if (kindFilter.length) {
    const subset = docs.filter((d) => kindFilter.includes(d.kind));
    if (subset.length) docs = subset;
    else filterNote = `no ${kindFilter.join("/")} memories matched, searched everything`;
  }
  if (sourceFilter.length) {
    const subset = docs.filter((d) => sourceFilter.some((s) => (d.source || "").toLowerCase() === s.toLowerCase()));
    if (subset.length) docs = subset;
    else filterNote = `${filterNote ? filterNote + "; " : ""}no ${sourceFilter.join("/")} memories matched, searched everything`;
  }
  if (routed.timeWindow) {
    const from = new Date(routed.timeWindow.from).getTime();
    const to = new Date(routed.timeWindow.to).getTime();
    const subset = docs.filter((d) => {
      const t = new Date(d.capturedAt).getTime();
      return t >= from && t < to;
    });
    if (subset.length) docs = subset;
    else filterNote = `${filterNote ? filterNote + "; " : ""}nothing in that period, searched all time`;
  }

  // semantic similarity: best across the original question and its expansions
  const queryVectors = await embedder.encodeBatch(routed.variants);
  const semantic = new Map();
  for (const doc of docs) {
    const vec = store.vectorOf(doc.id);
    let best = -1;
    let bestVariant = 0;
    queryVectors.forEach((qv, i) => {
      const sim = cosine(qv, vec);
      if (sim > best) {
        best = sim;
        bestVariant = i;
      }
    });
    semantic.set(doc.id, { sim: best, variant: bestVariant });
  }

  const keyword = bm25(routed.terms, docs);
  const normalisedQuery = routed.raw.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  const queryEntityKeys = new Set(routed.entities.map(entityIdentity));
  const queryPhones = new Set(routed.entities.filter((e) => e.type === "phone").map((e) => phoneKey(e.value)));

  const results = docs.map((doc) => {
    const sem = semantic.get(doc.id) ?? { sim: 0, variant: 0 };
    const semScore = Math.max(0, (sem.sim - 0.05) / 0.75); // rescale into a usable 0..1 band
    const kw = keyword.get(doc.id) || 0;
    const docText = cleanText(doc.text).toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
    const phraseHit = normalisedQuery.length > 12 && docText.includes(normalisedQuery) ? 1 : 0;
    const coverage = termCoverage(routed.terms, tokenize(doc.text));

    let entityHits = 0;
    const reasons = [];
    for (const entity of doc.entities || []) {
      const ident = entityIdentity(entity);
      if (queryEntityKeys.has(ident)) {
        entityHits++;
        reasons.push(`matches ${entity.type} "${entity.label}"`);
      }
      if (entity.type === "phone" && queryPhones.has(phoneKey(entity.value))) {
        entityHits += 1.5;
        if (!reasons.some((r) => r.includes(entity.label))) reasons.push(`same number as ${entity.label}`);
      }
    }
    entityHits = Math.min(entityHits, 3);

    const ageDays = Math.max(0, (Date.now() - new Date(doc.capturedAt).getTime()) / 86400000);
    const recency = 1 / (1 + ageDays / 365);

    let score =
      semScore * 0.5 +
      kw * 0.26 +
      coverage * 0.13 +
      Math.min(entityHits, 2) * 0.075 +
      phraseHit * 0.05 +
      recency * 0.03;

    // exact identifier questions ("which number did she send?") lean on entities
    if (queryPhones.size && doc.entities?.some((e) => e.type === "phone" && queryPhones.has(phoneKey(e.value)))) score += 0.25;

    if (kw > 0.4 && coverage > 0.5) reasons.push("strong keyword overlap");
    if (semScore > 0.45) reasons.push("close in meaning to your question");
    if (phraseHit) reasons.push("contains the exact phrase");
    if (coverage >= 0.999 && routed.terms.length) reasons.push("every keyword found");
    if (doc.textSource === "ocr" && doc.ocr?.confidence >= 70) reasons.push(`read from the ${doc.kind} (OCR ${doc.ocr.confidence}%)`);

    return {
      doc,
      score,
      breakdown: {
        semantic: +semScore.toFixed(3),
        keyword: +kw.toFixed(3),
        coverage: +coverage.toFixed(3),
        entity: +entityHits.toFixed(2),
        phrase: phraseHit,
        recency: +recency.toFixed(3),
      },
      reasons: [...new Set(reasons)].slice(0, 4),
      variant: sem.variant,
    };
  });

  results.sort((a, b) => b.score - a.score);

  // Second pass: pull in the memories that share a concrete detail with the
  // best match. This is what lets "who recommended that mechanic?" surface the
  // chat where the number was sent next to the note where it was saved.
  const BRIDGE_TYPES = new Set(["phone", "name", "org", "email", "website", "reference"]);
  const leader = results[0];
  if (leader) {
    const leaderIdentities = new Map();
    for (const e of leader.doc.entities || []) {
      if (BRIDGE_TYPES.has(e.type)) leaderIdentities.set(entityIdentity(e), e);
    }
    if (leaderIdentities.size) {
      for (const r of results.slice(1)) {
        const shared = [];
        for (const e of r.doc.entities || []) {
          if (leaderIdentities.has(entityIdentity(e))) shared.push(e);
        }
        if (!shared.length) continue;
        const bonus = Math.min(0.15, 0.06 + shared.length * 0.04);
        r.score += bonus;
        r.breakdown.bridge = +bonus.toFixed(3);
        const labels = shared.map((e) => e.label).slice(0, 2).join(", ");
        r.reasons = [...new Set([...r.reasons, `connected to “${leader.doc.title}” through ${labels}`])].slice(0, 4);
      }
      results.sort((a, b) => b.score - a.score);
    }
  }

  const filtered = results.filter((r) => r.score > 0.02);
  return { results: filtered.slice(0, limit), all: results, filterNote };
}

/* --------------------------------------------------------------- answers --- */

function sentenceScores(doc, terms, entities) {
  const qStems = new Set(terms.map(stem));
  const lines = cleanText(doc.body || "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8 && !/^\W+$/.test(s));
  const title = (doc.title || "").toLowerCase();
  return lines
    .filter((line) => line.toLowerCase() !== title)
    .map((line, i) => {
      const stems = tokenize(line).map(stem);
      const hits = stems.filter((s) => qStems.has(s)).length;
      const entityBonus = (doc.entities || []).some((e) => e.type !== "time" && line.includes(e.label)) ? 0.6 : 0;
      const numberBonus = /(\d{3}[\s-]?\d{4}|R\s?\d|:\d\d)/.test(line) ? 0.5 : 0;
      const lenPenalty = line.length > 220 ? 0.4 : 0;
      const stubPenalty = line.length < 24 ? 0.9 : 0;
      const firstPenalty = i === 0 ? -0.1 : 0;
      return { line, score: hits + entityBonus + numberBonus - lenPenalty - stubPenalty + firstPenalty, index: i };
    });
}

/** Look for the detail the question asked about in the other strong matches. */
function huntEntity(relevant, type) {
  for (const result of relevant.slice(0, 5)) {
    const entity = (result.doc.entities || []).find((e) => e.type === type);
    if (entity) return { doc: result.doc, entity };
  }
  return null;
}

/** Totals beat line items when someone asks what they spent. */
function findTotal(relevant) {
  const wantsBalance = /\b(balance|outstanding|still owe|owe|remaining|left to pay)\b/i.test(relevant.query || "");
  if (wantsBalance) {
    for (const result of relevant.slice(0, 4)) {
      const m = cleanText(result.doc.body || "").match(/\b(?:balance|outstanding|remaining|still owe|left to pay)\b[^A-Za-z0-9]{0,24}(R\s?[\d ,]+(?:\.\d{2})?)/i);
      if (m) return { doc: result.doc, amount: m[1].replace(/\s+/g, " ").trim() };
    }
  }
  for (const result of relevant.slice(0, 4)) {
    const body = cleanText(result.doc.body || "");
    const m = body.match(/\btotal\b[^A-Za-z0-9]{0,8}(R\s?[\d ,]+(?:\.\d{2})?)/i);
    if (m) return { doc: result.doc, amount: m[1].replace(/\s+/g, " ").trim() };
  }
  let best = null;
  for (const result of relevant.slice(0, 4)) {
    for (const entity of result.doc.entities || []) {
      if (entity.type !== "money") continue;
      const value = Number(String(entity.value).replace(/[^\d.]/g, ""));
      if (!best || value > best.value) best = { doc: result.doc, amount: entity.label, value };
    }
  }
  return best && best.value >= 50 ? best : null;
}

/** "What is the wifi password?" should read the value out of the right line. */
function findSecret(doc, terms) {
  const lines = cleanText(doc.body || "").split(/\n+/).filter(Boolean);
  const best = sentenceScores(doc, terms, []).sort((a, b) => b.score - a.score)[0];
  const ordered = [best?.line, ...lines].filter(Boolean);

  // 1. an explicit password/pin label (that is what the question asked for)
  for (const line of ordered) {
    const labelled = line.match(/(?:password|passcode|pass|pin)\s*[:=\-]?\s*([A-Za-z0-9_@!#$%^&*.-]{4,})/i);
    if (labelled) return labelled[1];
  }
  // 2. "network / password" style lines
  for (const line of ordered) {
    const afterSlash = line.split("/").pop();
    const slashToken = afterSlash && afterSlash.trim().match(/^([A-Za-z0-9_@!#$%^&*.-]{4,})/);
    if (slashToken && /[\d!@#$%^&*_]/.test(slashToken[1])) return slashToken[1];
  }
  // 3. wifi / network / code styles
  for (const line of ordered) {
    const labelled = line.match(/(?:wifi|wi-fi|network|key safe|code)\s*[:=\-]?\s*([A-Za-z0-9_@!#$%^&*.-]{4,})/i);
    if (labelled) return labelled[1];
    const afterColon = line.match(/[\w ]{3,20}:\s*([A-Za-z0-9_@!#$%^&*.-]{5,})/);
    if (afterColon && /[\d!@#$%^&*_]/.test(afterColon[1])) return afterColon[1];
  }
  return null;
}

/** "which series did he tell me to watch" -> the thing being watched / read. */
function findTitle(doc) {
  const body = cleanText(doc.body || "");
  const m = body.match(/\b(?:watch|watching|read|reading|listen to|listening to|play|playing)\s+(?:the\s+)?([A-Z][A-Za-z0-9'\-]+(?:\s+[A-Z][A-Za-z0-9'\-]+)?)/);
  if (m) return m[1];
  const quoted = body.match(/[“"]([^”"\n]{3,40})[”"]/);
  return quoted ? quoted[1] : null;
}

/** Crude guard so the contact headline prefers human names over orgs. */
function personLike(label) {
  return label.split(/\s+/).length >= 2 && !/^(chat|the|how|fix|car|note|gmail|chrome)/i.test(label);
}

/** Find the sentence elsewhere in the results where a person is actually mentioned. */
function findMention(routed, results, person) {
  const CUE = /\b(recommend(ed|s)?|cousin|friend|says|said|told me|ask for|shout|contact|works with|known as|host is|call)\b/i;
  const label = person.label.toLowerCase();
  for (const result of results.slice(0, 6)) {
    const sentences = cleanText(result.doc.body || "")
      .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9(])/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sentence of sentences) {
      if (!sentence.toLowerCase().includes(label)) continue;
      if (!CUE.test(sentence)) continue;
      const others = (result.doc.entities || []).find((e) => e.type === "name" && e.label.toLowerCase() !== label);
      return { sentence, doc: result.doc, who: others ? others.label : "" };
    }
  }
  return null;
}

function whyLine(doc) {
  const when = relativeDate(doc.capturedAt);
  const where = doc.location ? `, ${doc.location}` : "";
  return `${doc.source} • ${doc.kind} • ${when}${where}`;
}

/**
 * Compose an extractive answer with citations. Every bullet is traceable to a
 * document, which is the whole point: the answer is your own data, not a guess.
 */
export function buildAnswer(routed, results, { maxBullets = 4 } = {}) {
  if (!results.length) {
    return {
      headline: "Nothing in your phone matches that yet",
      kind: "empty",
      bullets: [],
      evidence: [],
      confidence: 0,
      notes: ["Try describing the memory differently, or add data with the Import panel."],
      followUps: ["cheap flights", "wifi password", "dentist appointment", "washing machine error"],
    };
  }

  const top = results[0];
  const best = top.score;
  const bullets = [];
  const evidence = [];
  const seenLines = new Set();
  const relevant = results.filter((r) => r.score >= Math.max(0.14, best * 0.32));

  for (const [rank, result] of relevant.slice(0, 4).entries()) {
    const scored = sentenceScores(result.doc, routed.terms, routed.entities).sort((a, b) => b.score - a.score);
    for (const s of scored.slice(0, rank === 0 ? 2 : 1)) {
      const key = s.line.toLowerCase().slice(0, 60);
      if (seenLines.has(key)) continue;
      seenLines.add(key);
      bullets.push({
        text: truncate(s.line, 240),
        docId: result.doc.id,
        docTitle: result.doc.title,
        source: result.doc.source,
        kind: result.doc.kind,
        capturedAt: result.doc.capturedAt,
        why: whyLine(result.doc),
      });
      if (bullets.length >= maxBullets) break;
    }
    if (bullets.length >= maxBullets) break;
  }

  // Direct-answer headline: prefer concrete entities the user asked for.
  const wants = routed.raw.toLowerCase();
  let topEntities = top.doc.entities || [];

  // If the question named something ("what is Thabo's number"), prefer the
  // memory that actually holds that detail rather than only the best match.
  const namedInQuery = routed.entities.filter((e) => e.type === "name" || e.type === "org").map((e) => e.label.toLowerCase());
  if (namedInQuery.length) {
    const holder = relevant.find((r) => (r.doc.entities || []).some((e) => namedInQuery.includes(e.label.toLowerCase())));
    if (holder && holder.doc.id !== top.doc.id) {
      const merged = [...holder.doc.entities];
      for (const e of topEntities) if (!merged.some((m) => m.key === e.key)) merged.push(e);
      topEntities = merged;
    } else if (holder) {
      topEntities = [...holder.doc.entities, ...topEntities.filter((e) => !holder.doc.entities.some((m) => m.key === e.key))];
    }
  }
  let headline = "";
  let kind = "answer";

  const phoneInQuery = routed.entities.some((e) => e.type === "phone");
  const phone = topEntities.find((e) => e.type === "phone");
  const name = topEntities.find((e) => e.type === "name");
  const website = topEntities.find((e) => e.type === "website");
  const reference = topEntities.find((e) => e.type === "reference");
  const money = topEntities.find((e) => e.type === "money");
  const place = top.doc.location;

  const queryNameMatch = (entity) => namedInQuery.some((n) => n.includes(entity.label.toLowerCase()) || entity.label.toLowerCase().includes(n));
  const namedPerson = topEntities.find((e) => e.type === "name" && queryNameMatch(e));
  const fullerName = (partial) => {
    if (!partial) return null;
    if (namedInQuery.length === 0 && topEntities.some((e) => e.type === "name" && e.label.length >= (partial.length || 99))) return null;
    const tokens = partial.toLowerCase().split(/\s+/);
    let best = null;
    for (const result of relevant.slice(0, 6)) {
      for (const e of result.doc.entities || []) {
        if (e.type !== "name") continue;
        const label = e.label.toLowerCase();
        if (!tokens.some((t) => label.includes(t))) continue;
        if (!best || e.label.length > best.label.length) best = e;
      }
    }
    return best;
  };
  const person = namedPerson
    || topEntities.find((e) => e.type === "name" && personLike(e.label))
    || topEntities.find((e) => e.type === "name");
  const displayName = fullerName(namedPerson?.label || person?.label) || person;
  const recommendation = person ? findMention(routed, results, person) : null;
  const askTime = /\bwhen\b|\bwhat time\b|\bhow late\b/.test(wants);
  const askAmount = /\b(how much|price|cost|cheap|fee|rand|pay|paid|spend|spent|total)\b/.test(wants);
  const askSecret = /\b(password|wifi|passcode|pin|code|login)\b/.test(wants);
  const askTitle = /\b(series|show|movie|film|book|song|album|podcast|recipe|dish)\b/.test(wants);

  const timesInBody = [...new Set((cleanText(top.doc.body || "").match(/\b([01]?\d|2[0-3]):[0-5]\d\b/g) || []))];
  const weekday = (topEntities.find((e) => e.type === "weekday") || {}).label;
  const dateLabel = (topEntities.find((e) => e.type === "date") || {}).label
    || (weekday ? weekday[0].toUpperCase() + weekday.slice(1) : "");
  const title = askTitle ? findTitle(top.doc) : null;

  if (askTitle && title) {
    headline = `${title} — ${top.doc.title}`;
    kind = "answer";
  } else if (askTime && timesInBody.length) {
    const range = cleanText(top.doc.body || "").match(/\b((?:[01]?\d|2[0-3]):[0-5]\d)\s*(?:to|until|-|–)\s*((?:[01]?\d|2[0-3]):[0-5]\d)\b/i);
    const timeClean = range ? `${range[1]} – ${range[2]}` : timesInBody[0];
    const when = [dateLabel, timeClean].filter(Boolean).join(" ");
    headline = `${when} — ${top.doc.title}`;
    kind = "answer";
  } else if (recommendation && /\b(who|recommended|recommend|said|told)\b/.test(wants) && person) {
    headline = person.label;
    if (recommendation.who) headline += ` — mentioned by ${recommendation.who}`;
    kind = "person";
    bullets.unshift({
      text: truncate(recommendation.sentence, 220),
      docId: recommendation.doc.id,
      docTitle: recommendation.doc.title,
      source: recommendation.doc.source,
      kind: recommendation.doc.kind,
      capturedAt: recommendation.doc.capturedAt,
      why: `${whyLine(recommendation.doc)} — this is where it was first mentioned`,
    });
  } else if (phoneInQuery && phone) {
    headline = `${phone.label} — ${displayName ? displayName.label : top.doc.title}`;
    kind = "contact";
  } else if (/\b(number|phone|cell|mobile|contact)\b/.test(wants) && phone) {
    headline = `${phone.label}${displayName ? ` — ${displayName.label}` : ""}`;
    kind = "contact";
  } else if (/\b(website|site|link|url|browser|web page)\b/.test(wants) && website) {
    headline = `${website.label}`;
    kind = "website";
  } else if (/\bwho\b/.test(wants) && (name || person)) {
    headline = (displayName || name || person).label;
    kind = "person";
  } else if (/\b(reference|ref|booking ref|claim ref)\b/.test(wants)) {
    const hit = reference ? { doc: top.doc, entity: reference } : huntEntity(relevant, "reference");
    if (hit) {
      headline = hit.entity.label;
      kind = "reference";
      if (hit.doc.id !== top.doc.id) {
        const sentence = sentenceScores(hit.doc, routed.terms, []).sort((a, b) => b.score - a.score)[0];
        if (sentence) {
          bullets.unshift({
            text: truncate(sentence.line, 200),
            docId: hit.doc.id,
            docTitle: hit.doc.title,
            source: hit.doc.source,
            kind: hit.doc.kind,
            capturedAt: hit.doc.capturedAt,
            why: whyLine(hit.doc),
          });
        }
      }
    }
  } else if (askAmount) {
    relevant.query = routed.raw;
    const total = findTotal(relevant);
    if (total) {
      headline = `${total.amount} — ${total.doc.title}`;
      kind = "amount";
      if (total.doc.id !== top.doc.id) {
        const sentence = sentenceScores(total.doc, routed.terms, []).sort((a, b) => b.score - a.score)[0];
        if (sentence) {
          bullets.unshift({
            text: truncate(sentence.line, 200),
            docId: total.doc.id,
            docTitle: total.doc.title,
            source: total.doc.source,
            kind: total.doc.kind,
            capturedAt: total.doc.capturedAt,
            why: whyLine(total.doc),
          });
        }
      }
    } else if (money) {
      headline = `${money.label} — ${top.doc.title}`;
      kind = "amount";
    }
  } else if (askSecret) {
    const pw = findSecret(top.doc, routed.terms);
    headline = pw ? `${pw} — ${top.doc.title}` : top.doc.title;
    kind = "secret";
  } else {
    headline = top.doc.title || truncate(bullets[0]?.text || "", 90) || "Found it";
    kind = "answer";
  }

  // Evidence trail: where this lives, and what it connects to.
  const entityTrail = [];
  const ranked = [...topEntities].sort((a, b) => {
    const weight = (e) => (e.type === "phone" ? 0 : e.type === "name" ? 1 : e.type === "money" ? 2 : e.type === "website" ? 3 : 4);
    return weight(a) - weight(b);
  });
  for (const e of ranked.slice(0, 4)) entityTrail.push(`${e.type}: ${e.label}`);

  for (const result of results.slice(0, 3)) {
    evidence.push({
      docId: result.doc.id,
      title: result.doc.title,
      kind: result.doc.kind,
      source: result.doc.source,
      capturedAt: result.doc.capturedAt,
      location: result.doc.location,
      score: +result.score.toFixed(3),
      reasons: result.reasons,
      quote: truncate((sentenceScores(result.doc, routed.terms, routed.entities).sort((a, b) => b.score - a.score)[0] || {}).line || "", 200),
    });
  }

  const confidence = Math.max(0, Math.min(1, 0.35 * top.breakdown.semantic + 0.35 * top.breakdown.keyword + 0.2 * top.breakdown.coverage + 0.1 * Math.min(top.breakdown.entity, 1)));

  const notes = [];
  if (top.breakdown.semantic >= 0.4) notes.push("Matched by meaning, not just keywords.");
  if (top.breakdown.entity > 0) notes.push("Connected through a shared detail in your data.");
  if (top.doc.textSource === "ocr") notes.push(`Read from the image with OCR (${top.doc.ocr?.confidence ?? "–"}% confidence).`);
  if (place) notes.push(`Memory is tagged ${place}.`);

  const followUps = [];
  const kw = top.doc.keywords || [];
  if (kw.length) followUps.push(`everything about ${kw[0]}`);
  if (name) followUps.push(`who is ${name.label}?`);
  if (phone) followUps.push(`show ${phone.label}`);
  if (top.doc.location) followUps.push(`${top.doc.location} memories`);
  while (followUps.length < 3) followUps.push(["cheap flights", "load shedding times", "medical aid claim"][followUps.length]);

  return {
    headline,
    kind,
    bullets: bullets.slice(0, maxBullets),
    evidence,
    entityTrail,
    confidence: +confidence.toFixed(2),
    notes,
    followUps: followUps.slice(0, 3),
  };
}

/* ----------------------------------------------------------- connections --- */

/**
 * Link documents that share concrete entities - the "connect your personal
 * information" view. Only high-signal entity types create an edge.
 */
export function connect(results, store) {
  const docs = results.length ? results.map((r) => r.doc) : store.docs;
  const byEntity = new Map();
  for (const doc of docs) {
    for (const entity of doc.entities || []) {
      if (!["phone", "name", "website", "reference", "email"].includes(entity.type)) continue;
      const ident = entityIdentity(entity);
      const list = byEntity.get(ident) || [];
      list.push({ doc, entity });
      byEntity.set(ident, list);
    }
  }
  const edges = [];
  for (const [ident, list] of byEntity) {
    if (list.length < 2) continue;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].doc;
        const b = list[j].doc;
        if (a.id === b.id) continue;
        const [first, second] = new Date(a.capturedAt) <= new Date(b.capturedAt) ? [a, b] : [b, a];
        edges.push({
          id: `${ident}::${a.id}::${b.id}`,
          entity: { type: list[i].entity.type, label: list[i].entity.label, identity: ident },
          from: { docId: first.id, title: first.title, source: first.source, kind: first.kind, capturedAt: first.capturedAt },
          to: { docId: second.id, title: second.title, source: second.source, kind: second.kind, capturedAt: second.capturedAt },
          label: labelFor(list[i].entity),
          strength: list.length,
        });
      }
    }
  }
  edges.sort((a, b) => b.strength - a.strength || a.entity.label.localeCompare(b.entity.label));
  return edges.slice(0, 40);
}

function labelFor(entity) {
  switch (entity.type) {
    case "phone": return `same phone number ${entity.label}`;
    case "name": return `same person: ${entity.label}`;
    case "website": return `same site ${entity.label}`;
    case "reference": return `same reference ${entity.label}`;
    case "email": return `same email ${entity.label}`;
    default: return `same ${entity.type} ${entity.label}`;
  }
}

export function timeline(results) {
  return results
    .map((r) => ({
      docId: r.doc.id,
      title: r.doc.title,
      kind: r.doc.kind,
      source: r.doc.source,
      capturedAt: r.doc.capturedAt,
      location: r.doc.location,
      score: +r.score.toFixed(3),
      snippet: truncate(cleanText(r.doc.body).replace(/\n+/g, " · "), 150),
    }))
    .sort((a, b) => new Date(a.capturedAt) - new Date(b.capturedAt));
}

/** A compact card shape for lists. */
export function toCard(doc, queryTerms = []) {
  const snip = snippet(doc.body || doc.caption || doc.title, queryTerms, 190);
  const deck = cleanText(doc.caption || "").replace(/\s+/g, " ").trim();
  return {
    id: doc.id,
    title: doc.title,
    kind: doc.kind,
    source: doc.source,
    album: doc.album,
    location: doc.location,
    url: doc.url || "",
    capturedAt: doc.capturedAt,
    ingestedAt: doc.ingestedAt,
    textSource: doc.textSource,
    ocr: doc.ocr || null,
    size: doc.size,
    mimeType: doc.mimeType,
    hasFile: Boolean(doc.filePath),
    fileUrl: doc.filePath ? `/api/documents/${doc.id}/file` : "",
    keywords: (doc.keywords || []).slice(0, 6),
    entities: (doc.entities || []).slice(0, 8),
    snippet: snip,
    deck: truncate(deck, 240),
    body: truncate(cleanText(doc.body || ""), 4000),
    reasons: [],
  };
}
