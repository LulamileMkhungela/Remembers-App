/**
 * The library on the phone, plus the index built over it.
 * Rebuilt from scratch whenever the simulator adds an item — the whole library
 * is a few dozen documents, so a rebuild costs less than a millisecond.
 */

import { loadLibrary } from '../data/corpus.js';
import { buildIndex, searchIndex, knowledgeConfidence } from './search.js';
import { understand } from './nlp.js';
import { composeAnswer } from './answer.js';
import { deepLink, sourceSpread } from './deep-link.js';

function round(n, p = 3) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

const KIND_ICON = {
  screenshot: '🖼', photo: '📷', note: '📝', email: '✉️', voice: '🎙',
  event: '📅', contact: '👤', page: '🔖', message: '💬'
};

/** Names the NLU should recognise without being told they are names. */
function knownNames(items) {
  const names = new Set();
  for (const item of items) {
    for (const p of item.people || []) names.add(p.split(' ')[0]);
    // "Ask for Jabu", "use my guy", "from Nkomo" — the name pattern stays
    // case-sensitive (names are capitalised) while the lead-in does not, because
    // a sentence can start with it: "Ask for Jabu at the counter."
    for (const m of String(item.body || '').matchAll(/(?:ask for|Ask for|use|Use|call|Call|with|With|from|From)\s+([A-Z][a-z]{3,})/g)) names.add(m[1]);
    if (item.from) names.add(String(item.from).split(' ')[0]);
  }
  return [...names];
}

export function createStore({ now = new Date() } = {}) {
  let items = loadLibrary({ now });
  let index = buildIndex(items);
  const log = [];

  function reindex() {
    items = items.map((item, i) => ({ ...item, index: i }));
    index = buildIndex(items);
  }

  function search(question, { limit = 12, kind = null, source = null } = {}) {
    const started = Date.now();
    const understanding = understand(question, { knownNames: knownNames(items), itemCount: items.length });
    if (kind) understanding.kinds = [kind];
    if (source) understanding.sources = [source];
    const results = searchIndex(index, understanding, { limit });
    return { understanding, results, meta: meta(started, results) };
  }

  /**
   * "What did I save recently?" — a natural question with no keywords in it.
   * Rather than pretend nothing exists, answer with what actually arrived, and
   * say plainly that this is recency, not relevance.
   */
  function recencyAnswer(understanding, limit) {
    const pool = items
      .filter((i) => understanding.window == null || (i.daysAgo != null && i.daysAgo <= understanding.window))
      .sort((a, b) => (a.daysAgo ?? 9e4) - (b.daysAgo ?? 9e4))
      .slice(0, limit);
    if (!pool.length) return null;
    const results = pool.map((item, i) => publicResult({ item, score: round(0.3 - i * 0.02), rank: i + 1, signals: {}, snippet: item.summary || '', why: ['shown because it arrived recently — nothing matched the words in the question'] }));
    return {
      timing: Date.now(),
      understanding,
      results,
      answer: {
        headline: `${pool.length} item${pool.length === 1 ? '' : 's'} landed on your phone recently.`,
        detail: `Nothing in the library matches the actual words of that question, so this is simply what arrived most recently${understanding.window ? ` in the last ${understanding.window} days` : ''} — recency, not relevance.`,
        facts: [],
        confidence: { score: 0.3, label: 'Fair', signals: { match: 0.3, coverage: 0, margin: 0, senseMatch: 0, textMatch: 0, sources: 0, trust: 0.9 }, perToken: [] },
        primary: pool[0].id,
        hedged: true,
        fallback: 'recency',
        evidence: results.map((r) => ({
          ...r, isPrimary: r.id === pool[0].id, icon: KIND_ICON[r.kind] || '•',
          date: r.capturedAt, when: r.daysAgo == null ? 'always' : r.daysAgo === 0 ? 'today' : `${r.daysAgo} days ago`,
          matched: [], semantic: 0, lexical: 0
        }))
      },
      spread: [...new Set(pool.map((i) => i.source))]
    };
  }

  function ask(question, options = {}) {
    const { started, understanding, results, meta: m } = timed(() => search(question, options));
    if (!results.length && (understanding.browse || understanding.window != null)) {
      const fallback = recencyAnswer(understanding, Math.min(options.limit || 12, 6));
      if (fallback) {
        const primaryItem = items.find((i) => i.id === fallback.answer.primary) || null;
        return {
          question,
          understanding: publicUnderstanding(understanding),
          answer: {
            ...fallback.answer,
            openTarget: primaryItem ? deepLink(primaryItem) : null,
            spread: fallback.spread.map((src) => ({ source: src, count: fallback.results.filter((r) => r.source === src).length }))
          },
          results: fallback.results,
          timeline: timeline(understanding, fallback.results.map((r) => ({ item: items.find((i) => i.id === r.id), score: r.score }))),
          meta: { ...meta(started, fallback.results), tookMs: Date.now() - started, mode: 'on-device simulation', fallback: 'recency' }
        };
      }
    }
    const { answer, spread } = composeAnswer(understanding, results);
    const primaryItem = items.find((i) => i.id === answer.primary) || null;
    return {
      question,
      understanding: publicUnderstanding(understanding),
      answer: {
        ...answer,
        openTarget: primaryItem ? deepLink(primaryItem) : null,
        spread: (spread || []).map((s) => ({ source: s, count: results.filter((r) => r.item.source === s).length }))
      },
      results: results.map(publicResult),
      timeline: timeline(understanding, results),
      meta: { ...m, tookMs: Date.now() - started, mode: 'on-device simulation' }
    };
  }

  function meta(started, results) {
    return {
      indexed: items.length,
      tookMs: Date.now() - started,
      dimensions: index.dimensions,
      vocabulary: index.vocab.length,
      matches: results.length
    };
  }

  function timeline(understanding, results) {
    // Only the items that were actually drawn on for the answer are "on the
    // path" — the rest of the trail is context, and saying otherwise would be
    // the exact kind of over-claiming this app is meant to avoid.
    const used = results.slice(0, 5);
    const matched = new Map(used.map((r, i) => [r.item.id, { rank: i + 1, score: r.score }]));
    const primary = results[0]?.item;
    const related = new Set(primary?.tags || []);
    const pool = new Map();
    for (const r of results) pool.set(r.item.id, r.item);
    for (const item of items) {
      if (pool.has(item.id)) continue;
      const shared = (item.tags || []).filter((t) => related.has(t)).length;
      if (primary && shared >= 2) pool.set(item.id, item);
    }
    // Keep the trail readable: everything that was used, plus an even spread of
    // the surrounding context, capped at ten nodes.
    const all = [...pool.values()];
    let chosen = all;
    if (all.length > 10) {
      const usedItems = all.filter((i) => matched.has(i.id));
      const context = all.filter((i) => !matched.has(i.id)).sort((a, b) => (a.capturedAtMs ?? 0) - (b.capturedAtMs ?? 0));
      const step = Math.max(1, Math.floor(context.length / Math.max(1, 10 - usedItems.length)));
      const spread = context.filter((_, i) => i % step === 0).slice(0, 10 - usedItems.length);
      chosen = [...usedItems, ...spread];
    }

    return chosen
      .sort((a, b) => (a.capturedAtMs ?? 0) - (b.capturedAtMs ?? 0))
      .map((item) => ({
        id: item.id,
        title: item.title,
        kind: item.kind,
        source: item.source,
        capturedAt: item.capturedAt,
        daysAgo: item.daysAgo,
        location: item.location || null,
        onTheQuestionPath: matched.has(item.id),
        rank: matched.get(item.id)?.rank ?? null,
        score: matched.get(item.id)?.score ?? null
      }));
  }

  function publicResult(r) {
    const item = r.item;
    return {
      id: item.id,
      kind: item.kind,
      source: item.source,
      app: item.app || null,
      title: item.title,
      summary: item.summary || null,
      image: item.image || null,
      view: item.view || null,
      url: item.url || null,
      location: item.location || null,
      capturedAt: item.capturedAt,
      daysAgo: item.daysAgo ?? null,
      duration: item.duration || null,
      from: item.from || null,
      people: item.people || [],
      tags: item.tags || [],
      score: r.score,
      rank: r.rank,
      signals: r.signals,
      snippet: r.snippet,
      why: r.why,
      trust: knowledgeConfidence(item),
      openTarget: deepLink(item)
    };
  }

  function publicUnderstanding(u) {
    return {
      intent: u.intent,
      tokens: u.tokens,
      expanded: u.synonyms.filter((t) => !u.tokens.includes(t)).slice(0, 14),
      entities: u.entities,
      kinds: u.kinds,
      sources: u.sources,
      people: u.people,
      window: u.window
    };
  }

  function timed(fn) {
    const started = Date.now();
    const out = fn();
    return { started, ...out };
  }

  return {
    search,
    ask,
    stats: () => ({
      indexed: items.length,
      bySource: items.reduce((acc, i) => ({ ...acc, [i.source]: (acc[i.source] || 0) + 1 }), {}),
      dimensions: index.dimensions,
      vocabulary: index.vocab.length,
      additions: log.length
    }),
    library: () => items.map((i) => ({
      id: i.id,
      kind: i.kind,
      source: i.source,
      app: i.app || null,
      title: i.title,
      summary: i.summary || null,
      image: i.image || null,
      view: i.view || null,
      url: i.url || null,
      location: i.location || null,
      capturedAt: i.capturedAt,
      daysAgo: i.daysAgo ?? null,
      duration: i.duration || null,
      tags: i.tags || [],
      trust: knowledgeConfidence(i),
      openTarget: deepLink(i),
      addedBy: log.includes(i.id) ? 'simulator' : 'import'
    })),
    item: (id) => {
      const item = items.find((i) => i.id === id) || null;
      if (!item) return null;
      return {
        ...item,
        trust: knowledgeConfidence(item),
        extraction: extractionPanel(item),
        openTarget: deepLink(item),
        related: items
          .filter((other) => other.id !== item.id && (other.tags || []).some((t) => (item.tags || []).includes(t)))
          .slice(0, 6)
          .map((other) => ({ id: other.id, title: other.title, kind: other.kind, source: other.source, daysAgo: other.daysAgo }))
      };
    },
    extractedText: (id) => {
      const item = items.find((i) => i.id === id);
      if (!item) return null;
      return {
        id: item.id,
        title: item.title,
        kind: item.kind,
        source: item.source,
        capturedAt: item.capturedAt,
        indexedText: item.body,
        extraction: extractionPanel(item)
      };
    },
    addItem: (item, note) => {
      if (items.some((i) => i.id === item.id)) return null;
      const captured = new Date(now);
      if (item.daysAgo != null) captured.setDate(captured.getDate() - item.daysAgo);
      if (item.time) {
        const [h, m] = item.time.split(':').map(Number);
        captured.setHours(h, m, 0, 0);
      }
      const full = {
        ...item,
        capturedAt: captured.toISOString(),
        capturedAtMs: captured.getTime(),
        hasDepth: Boolean(item.view || item.image),
        addedAt: new Date().toISOString(),
        fromSimulator: true,
        note: note || null
      };
      items = [...items, full];
      log.push(item.id);
      reindex();
      return publicResult({ item: full, score: 1, rank: null, signals: {}, snippet: full.summary, why: [] });
    },
    reset: () => {
      items = loadLibrary({ now });
      log.length = 0;
      reindex();
      return { indexed: items.length };
    },
    spread: (results) => sourceSpread(results)
  };
}

function extractionPanel(item) {
  const rows = [];
  const grades = { ocr: 0.92, caption: 0.9, speech: 0.95, meta: 0.96, quality: 1, ...(item.grades || {}) };
  if (item.kind === 'screenshot') {
    rows.push({ pipeline: 'screen capture → OCR', detail: 'Text on the screen read as a block index', confidence: grades.ocr });
    rows.push({ pipeline: 'app + URL metadata', detail: `${item.app || 'app'} · ${item.url || 'no url'}`, confidence: grades.meta });
  } else if (item.kind === 'photo') {
    rows.push({ pipeline: 'on-device vision caption', detail: 'Photo described without leaving the phone', confidence: grades.caption });
    rows.push({ pipeline: 'text in frame → OCR', detail: 'Only runs when the caption sees text-like regions', confidence: grades.ocr });
    rows.push({ pipeline: 'EXIF + location', detail: item.location ? `Taken near ${item.location}` : 'No location attached', confidence: grades.meta });
  } else if (item.kind === 'voice') {
    rows.push({ pipeline: 'on-device speech-to-text', detail: 'Transcript indexed as text; audio never uploaded', confidence: grades.speech });
  } else if (item.kind === 'page') {
    rows.push({ pipeline: 'page archive → text', detail: 'Reader text kept with the URL', confidence: grades.ocr });
  } else {
    rows.push({ pipeline: 'structured record', detail: 'Text is exact — nothing was guessed', confidence: grades.caption });
  }
  rows.push({ pipeline: 'capture quality', detail: grades.quality < 0.6 ? 'Blurry or badly framed — ranked down' : 'Clean capture', confidence: grades.quality });
  rows.push({ pipeline: 'semantic embedding', detail: 'Placed in the on-device meaning space', confidence: 0.9 });
  return rows;
}
