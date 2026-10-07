/**
 * The retrieval engine.
 *
 * Two rankers run over the same on-device text index and are fused:
 *
 *   1. BM25  — exact and stemmed term overlap. This is what makes the on-screen
 *              text of a screenshot findable ("R9 420", "Nkomo Auto Repairs").
 *   2. LSA   — latent semantic analysis over a truncated SVD (power/Jacobi
 *              eigen decomposition of the term-document matrix). This is what
 *              lets "where did I find the cheap flights" hit a screenshot whose
 *              text says "cheapest fare, Turkish Airlines, one stop".
 *
 * Both are linear-algebra-only, no model download, no network — the same shape
 * as the on-device index this app is a stand-in for.
 */

import {
  contentTokens, expand, normalise, sentences, stemMatch, tokenize, KIND_WORDS, findAmounts, findPhones
} from './nlp.js';

const K1 = 1.42;
const B = 0.72;
const SYNONYM_WEIGHT = 0.55;

/** Field weights used for the BM25 side of the index. */
const FIELD_WEIGHTS = { title: 2.6, tags: 1.9, people: 2.0, summary: 1.35, body: 1, meta: 0.85 };

/** How much we trust each kind of extracted text. */
const EXTRACTION_TRUST = {
  screenshot: { ocr: 0.55, meta: 0.45 },
  photo: { ocr: 0.28, caption: 0.47, meta: 0.25 },
  page: { ocr: 0.72, meta: 0.28 },
  note: { caption: 0.99 },
  email: { caption: 0.99 },
  voice: { speech: 0.95, meta: 0.05 },
  event: { caption: 0.99 },
  contact: { caption: 0.99 }
};

function searchableText(item) {
  return [
    item.title,
    item.summary,
    item.body,
    (item.tags || []).join(' '),
    (item.people || []).join(' '),
    item.source,
    item.app,
    item.url,
    item.location,
    item.from,
    item.duration
  ].filter(Boolean).join(' \n ');
}

function fieldTokens(item) {
  return {
    title: contentTokens(item.title || ''),
    tags: contentTokens((item.tags || []).join(' ')),
    people: contentTokens((item.people || []).join(' ') + ' ' + (item.from || '')),
    summary: contentTokens(item.summary || ''),
    body: contentTokens(item.body || ''),
    meta: contentTokens([item.source, item.app, item.url, item.location, item.duration].filter(Boolean).join(' '))
  };
}

// ── Linear algebra ───────────────────────────────────────────────────────────

/** Jacobi eigen decomposition for a small symmetric matrix. */
function jacobiEigen(Ain) {
  const n = Ain.length;
  const A = Ain.map((row) => row.slice());
  let V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-12) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-14) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = A.map((row, i) => row[i]);
  const order = values.map((v, i) => i).sort((a, b) => values[b] - values[a]);
  return {
    values: order.map((i) => values[i]),
    vectors: order.map((i) => V.map((row) => row[i])) // vectors[d] = d-th eigenvector
  };
}

// ── Index ────────────────────────────────────────────────────────────────────

export function buildIndex(items, { dimensions = 14 } = {}) {
  const docs = items.map((item) => {
    const fields = fieldTokens(item);
    const counts = new Map();
    const raw = new Map();
    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      for (const token of fields[field] || []) {
        counts.set(token, (counts.get(token) || 0) + weight);
        raw.set(token, (raw.get(token) || 0) + 1);
      }
    }
    // Synonym expansion — the same graph the query goes through, at a discount.
    for (const [token, weight] of expand([...raw.keys()])) {
      if (weight >= 1) continue;
      counts.set(token, (counts.get(token) || 0) + weight * SYNONYM_WEIGHT * 2);
    }
    const length = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
    return { item, counts, raw, length };
  });

  // Vocabulary: every token that appears in at least two documents, plus rarer
  // tokens that look specific (phone numbers, amounts, names).
  const df = new Map();
  for (const doc of docs) {
    for (const token of doc.raw.keys()) df.set(token, (df.get(token) || 0) + 1);
  }
  const vocab = [...df.entries()]
    .filter(([token, count]) => count >= 2 || /^\d/.test(token) || token.length > 6)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6000)
    .map(([token]) => token);
  const termIndex = new Map(vocab.map((t, i) => [t, i]));
  const N = docs.length;
  const idf = vocab.map((token) => Math.log(1 + (N - (df.get(token) || 1) + 0.5) / ((df.get(token) || 1) + 0.5)));
  const avgLength = docs.reduce((a, d) => a + d.length, 0) / (N || 1);

  // Term–document matrix X (rows L2-normalised, idf weighted).
  const X = docs.map((doc) => {
    const row = new Array(vocab.length).fill(0);
    for (const [token, count] of doc.counts) {
      const j = termIndex.get(token);
      if (j == null) continue;
      row[j] = (1 + Math.log(count)) * idf[j];
    }
    const norm = Math.hypot(...row) || 1;
    return row.map((v) => v / norm);
  });

  // Semantic space: X ≈ U S Vᵀ via the (tiny) n×n Gram matrix.
  const gram = Array.from({ length: N }, (_, i) =>
    Array.from({ length: N }, (_, j) => X[i].reduce((acc, v, k) => acc + v * X[j][k], 0))
  );
  const { values, vectors } = N > 0 ? jacobiEigen(gram) : { values: [], vectors: [] };
  const k = Math.max(2, Math.min(dimensions, N - 1, vocab.length - 1));
  const singular = values.slice(0, k).map((v) => Math.sqrt(Math.max(v, 0)));
  const kept = singular.filter((s) => s > 1e-9).length || 1;
  const U = Array.from({ length: N }, (_, i) => vectors.slice(0, kept).map((vec) => vec[i]));
  const S = singular.slice(0, kept);

  // Right singular vectors V = Xᵀ U S⁻¹  (k × vocab)
  const V = Array.from({ length: kept }, (_, c) => {
    const col = new Array(vocab.length).fill(0);
    for (let i = 0; i < N; i++) {
      const u = U[i][c];
      if (!u) continue;
      const row = X[i];
      for (let j = 0; j < vocab.length; j++) {
        if (row[j]) col[j] += u * row[j];
      }
    }
    const denom = S[c] || 1;
    return col.map((v) => v / denom);
  });

  // Document coordinates in the semantic space.
  const docVectors = U.map((u) => u.map((v, c) => v * S[c]));

  // Token → document postings for BM25.
  const dfMap = new Map();
  for (const [token, count] of df) if (termIndex.has(token)) dfMap.set(token, count);

  const dimensionsUsed = kept;

  function embedQuery(synonyms) {
    const q = new Map();
    for (const token of synonyms) q.set(token, Math.max(q.get(token) || 0, 1));
    const row = new Array(vocab.length).fill(0);
    for (const [token, weight] of q) {
      const j = termIndex.get(token);
      if (j == null) continue;
      row[j] += weight * idf[j];
    }
    const norm = Math.hypot(...row) || 1;
    const scaled = row.map((v) => v / norm);
    const coords = V.map((col) => scaled.reduce((acc, v, j) => acc + v * col[j], 0));
    const mag = Math.hypot(...coords) || 1;
    return coords.map((c) => c / mag);
  }

  function bm25(doc, synonymWeights) {
    let score = 0;
    for (const [token, weight] of synonymWeights) {
      const j = termIndex.get(token);
      if (j == null) continue;
      const tf = doc.counts.get(token) || 0;
      if (!tf) continue;
      const d = dfMap.get(token) || 1;
      const idfRaw = Math.log(1 + (N - d + 0.5) / (d + 0.5));
      const denom = tf + K1 * (1 - B + (B * doc.length) / avgLength);
      score += weight * idfRaw * ((tf * (K1 + 1)) / denom);
    }
    return score;
  }

  return {
    docs, vocab, termIndex, idf, docVectors, embedQuery, bm25,
    dimensions: dimensionsUsed, avgLength,
    idfMap: new Map(vocab.map((t, i) => [t, idf[i]])),
    dfMap: new Map(df)
  };
}

// ── Query ────────────────────────────────────────────────────────────────────

export function searchIndex(index, understanding, { limit = 12 } = {}) {
  const { synonyms, tokens, entities, kinds, sources, people, window } = understanding;
  const weights = new Map();
  for (const token of synonyms) weights.set(token, Math.max(weights.get(token) || 0, 1));
  for (const token of tokens) if (weights.has(token)) weights.set(token, 1.35);
  // Entities are exact anchors — "R9 420", "14 Nov", "073 630 7561".
  const anchors = [];
  for (const e of entities) {
    if (e.type === 'money' && e.value != null) anchors.push({ kind: 'money', value: e.value });
    if (e.type === 'phone') {
      const digits = String(e.value).replace(/\D/g, '').slice(-9);
      if (digits.length >= 9) anchors.push({ kind: 'phone', value: digits });
    }
    if (e.type === 'phrase') anchors.push({ kind: 'phrase', value: normalise(e.text) });
  }

  // Rare query terms are the specific ones — if the question says "dentist" and
  // a document has no dentist in it, that document should not be able to win on
  // generic words alone.
  const rareTokens = tokens.filter((t) => {
    const d = index.dfMap.get(t);
    return d != null && d <= 4;
  });

  const rawLex = [];
  const rawSem = [];
  const scored = index.docs.map((doc, i) => {
    const lexRaw = index.bm25(doc, weights);
    const semantic = dot(index.docVectors[i], index.embedQuery(synonyms));
    rawLex.push(lexRaw);
    rawSem.push(semantic);
    return { doc, i, lexRaw, semantic };
  });

  const maxLex = Math.max(...rawLex, 1e-9);

  const results = scored.map(({ doc, i, lexRaw, semantic }) => {
    const lex = lexRaw / maxLex;               // 0..1 relative to the best lexical hit
    const sem = Math.max(0, semantic);         // cosine, ~0..1
    const fieldHits = fieldBreakdown(doc.item, tokens);
    const anchorHits = anchors.filter((a) => anchorMatches(doc.item, a));

    let score = 0.44 * lex + 0.56 * semantic;
    score += 0.05 * Math.min(fieldHits.fields.title?.matchCount || 0, 3);
    score += 0.035 * Math.min(anchorHits.length, 2);

    // Filters behave as hard-ish gates: a wrong kind can't simply be out-scored.
    const kindOk = kinds.length === 0 || kinds.includes(doc.item.kind);
    const sourceOk = sources.length === 0 || sources.includes(doc.item.source);
    const peopleOk = people.length === 0 || (doc.item.people || []).some((p) => people.some((q) => p.toLowerCase().includes(q.toLowerCase())));
    if (!kindOk) score *= 0.22;
    if (!sourceOk) score *= 0.3;
    if (!peopleOk) score *= 0.55;

    // Time windows.
    const daysAgo = doc.item.daysAgo ?? null;
    if (window != null && daysAgo != null && daysAgo > window) score *= 0.25;

    // A gentle recency prior — personal search is mostly about "not long ago".
    const recency = daysAgo == null ? 0.5 : Math.exp(-daysAgo / 420);
    score += 0.045 * recency;

    // Answerability priors: if the question asks "how much", the item that
    // actually carries a rand/euro figure is the one that can answer it.
    const answerable = answerability(doc.item, understanding);
    if (answerable !== 1) score *= answerable;

    const missedRare = rareTokens.filter((t) => !doc.counts.has(t) && !doc.counts.has(t.slice(0, -1))).length;
    if (missedRare) score *= 0.75 ** missedRare;

    // Extraction confidence nudges items we read cleanly above shaky ones.
    const trust = knowledgeConfidence(doc.item);
    score *= 0.82 + 0.18 * trust;

    return {
      id: doc.item.id,
      item: doc.item,
      score: round(score, 4),
      rank: 0,
      signals: {
        lexical: round(lex, 3),
        semantic: round(sem, 3),
        senseMatch: round(semantic, 3),
        matchedWords: fieldHits.matchedWords,
        fields: fieldHits.fields,
          anchors: anchorHits.map((a) => a.text ?? a.value),
          recency: round(recency, 3),
          answerable: round(answerable, 3),
          trust
        },
      snippet: bestSnippet(doc.item, tokens),
      why: explainMatch(doc.item, fieldHits, semantic, anchors, lex),
      kindFail: !kindOk,
      sourceFail: !sourceOk
    };
  }).filter((r) => r.score > 0.06 && !(understanding.browse && (r.kindFail || r.sourceFail)));

  // An explicit period in the question is a filter, not a hint: "in the last
  // month" must not return something from seven months ago, even if that item
  // ranks higher on meaning. An empty shelf is the honest answer.
  let bounded = results;
  if (understanding.window != null && understanding.hardWindow) {
    bounded = results.filter((r) => r.item.daysAgo != null && r.item.daysAgo <= understanding.window);
  }

  // "Show me my screenshots" is browsing, not ranking: newest first, and the
  // relevance score is kept alongside so the UI can still explain the order.
  if (understanding.browse) {
    bounded.sort((a, b) => (a.item.daysAgo ?? 9e4) - (b.item.daysAgo ?? 9e4) || b.score - a.score);
  } else {
    bounded.sort((a, b) => b.score - a.score);
  }
  // Diversity: don't let one screenshot and its near-identical page note fill
  // the whole list — keep the best three per "subject cluster".
  const perCluster = new Map();
  const limited = [];
  for (const r of bounded) {
    const key = r.item.cluster || r.item.kind;
    const n = perCluster.get(key) || 0;
    if (n >= 3 && limited.length >= 6) continue;
    perCluster.set(key, n + 1);
    limited.push(r);
  }
  limited.slice(0, limit).forEach((r, i) => { r.rank = i + 1; });
  return limited.slice(0, limit);
}

function dot(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

function round(n, p = 3) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

function fieldBreakdown(item, tokens) {
  const fields = {};
  const matchedWords = new Set();
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const text = searchableText(item);
    const fieldText = {
      title: item.title,
      tags: (item.tags || []).join(' '),
      people: (item.people || []).join(' ') + ' ' + (item.from || ''),
      summary: item.summary,
      body: item.body,
      meta: [item.source, item.app, item.url, item.location].filter(Boolean).join(' ')
    }[field] || '';
    const fieldTokensList = tokenize(fieldText).filter((t) => !/^\d+$/.test(t));
    let matchCount = 0;
    for (const q of tokens) {
      const hit = fieldTokensList.find((t) => stemMatch(t, q));
      if (hit) {
        matchCount++;
        matchedWords.add(hit);
      }
    }
    if (matchCount) fields[field] = { matchCount, weight, text: fieldText };
    void text;
  }
  return { fields, matchedWords: [...matchedWords], matchCount: Object.values(fields).reduce((a, f) => a + f.matchCount, 0) };
}

/**
 * Multiplicative prior that only bites when the question has a shape the item
 * can actually satisfy: "how much" wants a figure, "who" wants a person,
 * "where" wants a place, "which website" wants something with a URL.
 */
function answerability(item, understanding) {
  let factor = 1;
  const amounts = findAmounts([item.summary, item.body].filter(Boolean).join(' '));
  const phones = findPhones([item.title, item.summary, item.body].filter(Boolean).join(' '));

  if (understanding.intent === 'how_much') factor *= amounts.length ? 1.2 : 0.8;
  if (understanding.intent === 'who') {
    // "Who recommended that mechanic" wants the item that actually names a
    // person — a statement that merely contains the word "mechanic" is not it.
    const known = understanding.knownNames || [];
    const namesInBody = known.some((n) => new RegExp(`\\b${n}\\b`, 'i').test(`${item.title || ''} ${item.body || ''}`));
    const hasPerson = (item.people || []).length || item.from || namesInBody || /\bask for\b|\bfrom:\s*[A-Z]/i.test(item.body || '');
    factor *= hasPerson ? 1.16 : 0.88;
    if (understanding.people.length && !hasPerson) factor *= 0.85;
  }
  if (understanding.intent !== 'who' && /\bnumber\b|\bphone\b/.test(understanding.normalised)) {
    factor *= phones.length ? 1.18 : 0.86;
  }
  if (understanding.intent === 'where') factor *= item.location ? 1.2 : 0.88;
  if (understanding.intent === 'which_site') factor *= item.url ? 1.24 : 0.82;
  return factor;
}

function anchorMatches(item, anchor) {
  if (anchor.kind === 'money' && anchor.value != null) {
    const amounts = findAmounts(item.body || '');
    return amounts.some((a) => a.value === anchor.value);
  }
  if (anchor.kind === 'phone') {
    const phones = findPhones(searchableText(item));
    return phones.some((p) => p.value.includes(anchor.value) || anchor.value.includes(p.value));
  }
  if (anchor.kind === 'phrase') {
    const haystack = normalise(searchableText(item));
    return anchor.value.split(' ').every((word) => haystack.includes(word));
  }
  return false;
}

// ── Snippets & explanations ──────────────────────────────────────────────────

export function bestSnippet(item, tokens) {
  const candidates = sentences(item.body || item.summary || '');
  if (!candidates.length) return item.summary || '';
  let best = null;
  let bestScore = -1;
  for (const sentence of candidates) {
    const words = tokenize(sentence);
    let score = 0;
    for (const q of tokens) if (words.some((w) => stemMatch(w, q))) score += 2;
    // Sentences carrying concrete values are better evidence than prose.
    score += Math.min(findAmounts(sentence).length, 2);
    score += Math.min(findPhones(sentence).length, 2);
    if (/\d{1,2}:\d{2}|\b\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(sentence)) score += 1;
    score -= sentence.length / 400;
    if (score > bestScore) { bestScore = score; best = sentence; }
  }
  const text = (best || candidates[0]).trim();
  return text.length > 260 ? `${text.slice(0, 257).trimEnd()}…` : text;
}

function explainMatch(item, fieldHits, semantic, anchors, lex) {
  const bits = [];
  const matched = fieldHits.matchedWords;
  if (matched.length) {
    const where = Object.keys(fieldHits.fields);
    bits.push(`matched ${matched.length === 1 ? 'the word' : 'words'} ${matched.slice(0, 4).map((w) => `“${w}”`).join(', ')} in ${where.join(' / ')}`);
  }
  if (anchors.length) bits.push(`contains ${anchors.map((a) => a.text ?? a.value).join(', ')}`);
  if (lex < 0.12 && semantic > 0.3) bits.push(`no shared wording — found by meaning (${Math.round(semantic * 100)}% sense match)`);
  else if (semantic > 0.35) bits.push(`${Math.round(semantic * 100)}% sense match`);
  if (!bits.length) bits.push('weak signal — ranked low on purpose');

  const source = {
    screenshot: 'on-screen text of a screenshot',
    photo: 'on-device caption + text in frame',
    page: 'saved page text',
    note: 'typed note',
    email: 'email body',
    voice: 'speech-to-text transcript',
    event: 'calendar entry',
    contact: 'contact card'
  }[item.kind] || item.kind;
  bits.push(`read from the ${source}`);
  return bits;
}

/** How much the phone trusts what it extracted from this item. */
export function knowledgeConfidence(item) {
  const trust = EXTRACTION_TRUST[item.kind] || { caption: 0.9 };
  const grades = { ocr: 0.92, caption: 0.9, speech: 0.95, meta: 0.96, quality: 1, ...(item.grades || {}) };
  let sum = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(trust)) {
    sum += w * (grades[key] ?? 0.9);
    weight += w;
  }
  return Math.max(0.05, Math.min(1, (sum / (weight || 1)) * (grades.quality ?? 1)));
}

export function searchAll(index, understanding, opts) {
  const results = searchIndex(index, understanding, opts);
  return { results, ...indexMeta(index, results) };
}

function indexMeta(index, results) {
  return {
    indexed: index.docs.length,
    dimensions: index.dimensions,
    vocabulary: index.vocab.length
  };
}

export { KIND_WORDS };
