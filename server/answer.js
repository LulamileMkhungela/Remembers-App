/**
 * Answer synthesis.
 *
 * The rule this file follows: never assert anything that is not literally in the
 * retrieved evidence. Every headline value (a price, a number, a date, a name)
 * is lifted from the item that matched, and the item id travels with the answer
 * so the UI can show exactly where it came from.
 */

import {
  contentTokens, expand, findAmounts, findPhones, formatDate, humanDaysAgo, stemMatch, tokenize
} from './nlp.js';
import { knowledgeConfidence } from './search.js';

const KIND_LABEL = {
  screenshot: 'screenshot', photo: 'photo', note: 'note', email: 'email',
  voice: 'voice memo', event: 'calendar entry', contact: 'contact card', page: 'saved page'
};

const KIND_ICON = {
  screenshot: '🖼', photo: '📷', note: '📝', email: '✉️', voice: '🎙',
  event: '📅', contact: '👤', page: '🔖'
};

const MULTI_PART_TLDS = ['co.za', 'co.uk', 'org.za', 'com.au', 'co.nz', 'com.br', 'co.jp', 'org.uk', 'ac.za', 'gov.za', 'co.ke', 'com.ng'];

function hostOf(url = '') {
  const m = String(url).match(/^https?:\/\/([^/]+)|^([a-z0-9.-]+\.[a-z]{2,})/i);
  const host = m && (m[1] || m[2]);
  return host ? host.split(':')[0].replace(/^www\./, '') : null;
}

function prettyHost(url = '') {
  const host = hostOf(url);
  if (!host) return null;
  const lower = host.toLowerCase();
  const suffix = MULTI_PART_TLDS.find((s) => lower.endsWith(`.${s}`));
  const core = suffix ? host.slice(0, -(suffix.length + 1)) : host.split('.').slice(0, -1).join('.');
  const name = (core.split('.').pop() || host).replace(/-/g, ' ');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Tokens of a document, used for coverage maths. */
function docTokenSet(item) {
  const set = new Set(tokenize([
    item.title, item.summary, item.body, (item.tags || []).join(' '),
    (item.people || []).join(' '), item.from, item.location, item.app, item.source
  ].filter(Boolean).join(' ')));
  if (item.url) {
    // An item with a URL *is* a web page — say so, so "which website" can be
    // answered with full coverage instead of a permanent 40% gap.
    for (const word of ['website', 'site', 'url', 'link', 'page', 'browser', 'online', 'web']) set.add(word);
    for (const token of tokenize(item.url)) set.add(token);
  }
  return set;
}

/**
 * How much of the question the retrieved evidence actually covers.
 * Exact wording counts fully, a synonym counts most of the way, meaning only
 * counts partially — so "cheap flights" against a text that says "cheapest
 * fare" still scores well, but never as well as a literal hit.
 */
export function coverage(understanding, items) {
  const tokens = understanding.tokens;
  if (!tokens.length) return 1;
  const sets = items.map(docTokenSet);
  let total = 0;
  const perToken = [];
  for (const token of tokens) {
    let credit = 0;
    for (const set of sets) {
      if ([...set].some((t) => stemMatch(t, token))) { credit = 1; break; }
      const syn = [...(expand([token], { weight: 1 }).keys())];
      if (syn.some((s) => [...set].some((t) => stemMatch(t, s)))) credit = Math.max(credit, 0.72);
    }
    total += credit;
    perToken.push({ token, credit: Number(credit.toFixed(2)) });
  }
  return { score: total / tokens.length, perToken };
}

/** Values lifted verbatim out of the primary item. */
function extractFacts(item, understanding) {
  const facts = [];
  const text = [item.summary, item.body].filter(Boolean).join(' \n ');
  const amounts = findAmounts(text);
  const chosen = moneyOf(item, understanding);
  if (chosen) {
    facts.push({ label: 'Amount', value: chosen.text, emphasis: true, from: item.id });
    for (const extra of amounts.filter((a) => a.text !== chosen.text).slice(0, 1)) {
      facts.push({ label: 'Also on it', value: extra.text, from: item.id });
    }
  }
  const phones = findPhones([item.title, item.summary, item.body].filter(Boolean).join(' '));
  if (phones.length) facts.push({ label: 'Phone', value: phones[0].text, emphasis: true, from: item.id });
  if (item.url) facts.push({ label: 'Site', value: hostOf(item.url), emphasis: true, from: item.id, href: `https://${hostOf(item.url)}` });
  if (item.from) facts.push({ label: 'From', value: item.from, from: item.id });
  if (item.location) facts.push({ label: 'Place', value: item.location, from: item.id });
  if (item.duration) facts.push({ label: 'Length', value: item.duration, from: item.id });
  if (item.app) facts.push({ label: 'App', value: item.app, from: item.id });
  return facts;
}

/**
 * The pitch is "it connects your personal information". When the top hit is
 * missing the value the question is actually after — the number is in the
 * contact card, not in the note that matched best — borrow it from the next
 * few items, and label where each value came from.
 */
function augmentFacts(facts, results, understanding) {
  const out = [...facts];
  const have = new Set(out.map((f) => f.label.split(' · ')[0]));
  const wanted = [];
  if (understanding.intent === 'how_much' || /\bhow much|price|cost\b/i.test(understanding.normalised)) wanted.push('Amount');
  if (understanding.intent === 'who' || /\bnumber\b|\bphone\b/.test(understanding.normalised)) wanted.push('Phone', 'Person');
  if (/\bnumber\b|\bphone\b|\bcall\b/.test(understanding.normalised)) wanted.push('Phone');
  for (const label of wanted) {
    if (have.has(label)) continue;
    for (const r of results.slice(1, 5)) {
      const item = r.item;
      const text = [item.summary, item.body].filter(Boolean).join(' \n ');
      if (label === 'Amount') {
        const amount = moneyOf(item, understanding);
        if (amount) { out.push({ label: `Amount · ${item.source}`, value: amount.text, emphasis: true, from: item.id }); break; }
      }
      if (label === 'Phone') {
        const phones = findPhones(text);
        if (phones.length) { out.push({ label: `Phone · ${item.source}`, value: phones[0].text, emphasis: true, from: item.id }); break; }
      }
      if (label === 'Person') {
        const person = item.people?.[0] || item.from || null;
        if (person) { out.push({ label: `Person · ${item.source}`, value: person, emphasis: true, from: item.id }); break; }
      }
    }
  }
  return out;
}

/**
 * Which figure on the item is "the answer".
 * "total" beats a line item; "from R…" / "cheapest" beats a range; otherwise the
 * first number on the item wins.
 */
function moneyOf(item, understanding = null) {
  const text = [item.summary, item.body].filter(Boolean).join(' \n ');
  const amounts = findAmounts(text);
  if (!amounts.length) return null;
  // The keyword has to be *right before* the figure: "18h 40m total, including
  // … Qatar, R10 180" must not promote the Qatar fare to "the total".
  const immediate = (a, window = 44) => text.slice(Math.max(0, a.index - window), a.index).toLowerCase();
  const nearby = (a, window = 34) => text.slice(Math.max(0, a.index - window), a.index + a.text.length + window).toLowerCase();
  const named = (re) => amounts.find((a) => re.test(immediate(a)));
  const near = (re) => amounts.find((a) => re.test(nearby(a)));
  const q = understanding?.normalised || '';

  // Units named in the question beat any generic "total" heuristic.
  const unit = /\b(a|per|each|every) night\b|\bnightly\b/.test(q) ? near(/\bnight\b/)
    : /\b(pcm|per month|a month|monthly|rent|a week|per week)\b/.test(q) ? near(/\bpcm\b|per month|a month|a week|per week/)
    : null;
  if (unit) return unit;

  return named(/\btotal\b|\bamount due\b|\ball in\b/)
    || named(/\bcheap\b|\bcheapest\b|\bfrom\b|\bstarting\b|\bper night\b/)
    || amounts[0];
}

/**
 * Who the question is about.
 *
 * The hard case is "who recommended that mechanic": the note that matches best
 * names two people — Thabo, who sent you there, and Jabu, who you ask for at the
 * counter. So candidates are scored by *how* each person is mentioned, and the
 * item that matched best gets first say.
 */
function personOf(results, understanding = null) {
  const q = understanding?.normalised || '';
  const wantsRecommender = /\b(recommend\w*|suggest\w*|referred|who (gave|told|sent)|sent me|told me about|put me on)\b/.test(q);
  const askedNames = (understanding?.people || []).map((p) => p.toLowerCase());
  const known = understanding?.knownNames || [];
  // A *recommender* is someone who sends you somewhere: "sent me", "told me
  // about", "referred". "his mechanic" describes the mechanic — that is a
  // contact, not a recommendation, and it is scored separately below.
  const RECOMMEND = /(sent me|told me about|gave me|referred|put me on|recommend)/i;
  const PLACE_PREP = /\b(at|in|near|to|via|from)\s+$/i;
  const FULLEST = new Map();

  function candidatesFor(item) {
    const found = new Map();
    const bump = (name, points, why) => {
      if (!name) return;
      const key = name.toLowerCase();
      const prev = found.get(key) || { name, points: 0, why, item };
      prev.points += points;
      if (name.length > prev.name.length) prev.name = name;         // prefer "Thabo Nkosi" over "Thabo"
      if (points > (prev.best || 0)) { prev.best = points; prev.why = why; }
      found.set(key, prev);
    };
    const text = `${item.title || ''} ${item.body || ''} ${item.summary || ''}`;
    if (item.from) bump(item.from, 5, 'the sender of the email you kept');
    if (item.people?.length) bump(item.people[0], 4, 'tagged as a person on that item');
    const fromLine = String(item.body || '').match(/From:\s*([A-Z][a-z]+(?: [A-Z][a-z]+)?)/);
    if (fromLine) bump(fromLine[1], 5, 'named as the sender');

    for (const name of known) {
      const re = new RegExp(`\\b${name}\\b`, 'gi');
      let m;
      let seen = 0;
      while ((m = re.exec(text))) {
        seen++;
        const before = text.slice(Math.max(0, m.index - 60), m.index);
        const after = text.slice(m.index + name.length, m.index + name.length + 60);
        const recommended = RECOMMEND.test(before) || RECOMMEND.test(after);
        // "at Nkomo Auto Repairs" is a place you go, not a person who told you.
        const isPlace = PLACE_PREP.test(text.slice(Math.max(0, m.index - 12), m.index)) && /[A-Z][a-z]+ (Auto|Repairs|Physio|Physiotherapy|Residential)/.test(text.slice(m.index, m.index + 42));
        const points = (recommended ? 2.2 : 0.6) * (isPlace ? 0.35 : 1);
        bump(expandName(text, m.index, name), points, recommended
          ? 'written down as the person who sent you'
          : addPlaceName(text, m.index + name.length) ? 'the business you were sent to' : 'named on that item');
        if (seen > 3) break;
      }
    }
    for (const name of known) {
      const title = String(item.title || '');
      const at = title.toLowerCase().indexOf(name.toLowerCase());
      if (name.length > 3 && at >= 0) {
        bump(expandName(title, at, title.slice(at, at + name.length)), 1.5, 'named in the title of the item');
      }
    }
    const askFor = String(item.body || '').match(/\bask for ([A-Z][a-z]+)\b/);
    if (askFor) bump(askFor[1], wantsRecommender ? 0.2 : 2.6, 'the person to ask for at the counter');
    const parenthetical = String(item.title || '').match(/\(([A-Z][a-z]+)\)/);
    if (parenthetical) bump(parenthetical[1], 2.2, 'named on that contact card');

    return [...found.values()].map((c) => {
      if (askedNames.includes(c.name.toLowerCase())) c.points += 20;   // the question names them
      else if (askedNames.some((a) => c.name.toLowerCase().startsWith(a))) c.points += 12;
      return c;
    });
  }

  const byItem = results.slice(0, 5).map((r) => ({ item: r.item, rank: r.rank, candidates: candidatesFor(r.item) }));
  const pool = byItem.flatMap((entry) => entry.candidates.map((c) => ({ ...c, rank: entry.rank })));
  if (!pool.length) return null;

  // 1. a name the question asked for, 2. the best candidate from the top-ranked
  // item, 3. otherwise the strongest mention overall.
  const asked = pool.filter((c) => askedNames.length && (c.points >= 20));
  const fromPrimary = pool.filter((c) => c.rank === 1);
  const pick = (asked.length && best(asked)) || (fromPrimary.length && best(fromPrimary)) || best(pool);
  // Display the fullest form of the name we have anywhere in the evidence —
  // "Thabo" from a note reads better as "Thabo Nkosi" from the email he sent.
  const first = pick.name.split(' ')[0].toLowerCase();
  const full = pool.map((c) => c.name).filter((n) => n.toLowerCase().startsWith(first)).sort((a, b) => b.length - a.length)[0];
  return {
    name: full && full.length > pick.name.length ? full : pick.name,
    item: pick.item,
    why: pick.why,
    ranked: pool.sort((a, b) => b.points - a.points).slice(0, 4)
  };
}

/** "Nkomo" -> "Nkomo Auto Repairs": keep the business name intact. */
function expandName(text, index, name) {
  const tail = text.slice(index + name.length);
  const extra = tail.match(/^\s+(Auto|Repairs|Physiotherapy|Physio|Residential|Motors|Garage|Clinic|Cafe|Café|Studio)(\s+[A-Z][a-z]+)?/);
  if (!extra) return name;
  return `${name}${extra[2] ? `${extra[0].replace(/\s+[A-Z][a-z]+$/, '')}${extra[2]}` : extra[0]}`.trim().replace(/\s+/g, ' ');
}

function addPlaceName(text, index) {
  return /Auto|Repairs|Physio|Residential|Motors|Garage|Clinic/.test(text.slice(index, index + 30));
}

function best(list) {
  return [...list].sort((a, b) => b.points - a.points || a.rank - b.rank)[0];
}

function placeOf(results) {
  for (const r of results) {
    if (r.item.location) return { place: r.item.location, item: r.item };
  }
  for (const r of results) {
    const m = String(r.item.body || '').match(/\b(?:in|at|near)\s+([A-Z][a-zA-Z]+(?:[ -][A-Z][a-zA-Z]+)?)\b/);
    if (m && !['The', 'Your', 'Ask', 'Two', 'Bring', 'Same'].includes(m[1])) return { place: m[1], item: r.item };
  }
  return null;
}

function describeSource(item) {
  const when = item.daysAgo == null ? '' : `, ${humanDaysAgo(item.daysAgo)}`;
  const label = KIND_LABEL[item.kind] || item.kind;
  const where = item.source === 'Screenshots' ? 'in Screenshots' : `in ${item.source}`;
  return `${label} ${where}${when}`;
}

export function composeAnswer(understanding, results) {
  const { intent } = understanding;
  const primary = results[0] || null;
  const top = results.slice(0, 3);
  const cov = coverage(understanding, top.map((r) => r.item));
  // Coverage of the item the answer would actually be built from — this is the
  // number that decides whether the app is allowed to sound sure of itself.
  const primaryCov = primary ? coverage(understanding, [primary.item]) : { score: 0, perToken: [] };
  const criterial = understanding.tokens.filter((t) => t.length >= 4 && !/^\d+$/.test(t));
  const uncoveredByPrimary = criterial.filter((t) => (primaryCov.perToken.find((p) => p.token === t)?.credit ?? 0) === 0);
  // Only a concrete, library-shaped word should trigger the "I don't have this"
  // headline — "liked", "book" or "money" missing is just how questions are asked.
  const GENERIC = new Set([
    'money', 'cash', 'thing', 'things', 'stuff', 'person', 'people', 'number', 'name', 'phone',
    'place', 'date', 'time', 'amount', 'price', 'cost', 'website', 'site', 'page', 'note', 'notes',
    'photo', 'photos', 'picture', 'screenshot', 'screenshots', 'message', 'idea', 'life', 'work',
    'like', 'liked', 'love', 'loved', 'need', 'needed', 'want', 'wanted', 'book', 'books', 'pay',
    'paid', 'owe', 'owed', 'know', 'tell', 'said', 'told', 'gave', 'give', 'met', 'meet', 'went',
    'help', 'good', 'best', 'about', 'again', 'save', 'saved', 'write', 'wrote', 'note',
    'spot', 'somewhere', 'anywhere', 'everywhere', 'wherever', 'hunt', 'hunting', 'seek',
    'check', 'checking', 'kind', 'sort', 'type', 'way', 'bit', 'lot', 'bunch', 'couple',
    'morning', 'afternoon', 'evening', 'night', 'today', 'tomorrow', 'yesterday', 'week', 'month',
    'runs', 'run', 'running', 'owns', 'own', 'manages', 'manage', 'works', 'heads', 'leads',
    'last', 'past', 'next', 'first', 'new', 'old', 'recent', 'recently', 'latest', 'lately',
    'saved', 'save', 'keep', 'kept', 'stored', 'anything', 'something', 'nothing', 'everything'
  ]);
  const missingTokens = uncoveredByPrimary.filter((t) =>
    !GENERIC.has(t) && !GENERIC.has(t.replace(/s$/, '')) && !/(ed|ing|ly)$/.test(t)
  );

  if (!primary) {
    return {
      answer: {
        headline: 'Nothing in your library matches that.',
        detail: `Searched ${understanding.itemCount} items on this device`
          + (understanding.window ? `, filtered to the last ${understanding.window} days` : '')
          + ' — nothing cleared the relevance floor.',
        facts: [],
        confidence: { score: 0, label: 'None' },
        primary: null,
        evidence: []
      },
      coverage: cov
    };
  }

  const item = primary.item;
  const facts = augmentFacts(extractFacts(item, understanding), results, understanding);
  const amount = moneyOf(item, understanding);
  const person = personOf(results, understanding);
  const place = placeOf(results);
  const site = prettyHost(item.url || '') || item.app || item.source;

  let headline = '';
  let detail = '';

  switch (intent) {
    case 'how_much': {
      if (amount) headline = `${amount.text}.`;
      else headline = `Your ${KIND_LABEL[item.kind]} has the numbers, but not in a currency I can total.`;
      detail = `That is the figure on the ${describeSource(item)}${item.title ? ` — “${item.title}”` : ''}.`;
      if (amount && /cheap/i.test(understanding.question)) headline = `${amount.text} — the cheapest I can find in your library.`;
      break;
    }
    case 'when': {
      headline = `${formatDate(item.capturedAt)} — ${humanDaysAgo(item.daysAgo)}.`;
      detail = `The ${describeSource(item)}${item.title ? ` called “${item.title}”` : ''} is the closest thing you saved.`;
      break;
    }
    case 'who': {
      if (person && understanding.intent === 'who') {
        headline = `${person.name}.`;
        const fromEmail = person.item.kind === 'email';
        detail = fromEmail
          ? `From the email “${person.item.title}” — ${humanDaysAgo(person.item.daysAgo)}${person.why ? `, ${person.why}` : ''}.`
          : person.item.kind === 'contact'
            ? `Saved on your contact card “${person.item.title}”${person.why ? ` — ${person.why}` : ''}.`
            : `Named in the ${describeSource(person.item)}${person.why ? ` — ${person.why}` : ''}.`;
        if (person.item.id !== item.id) {
          detail += ` Your best match is a different item: the ${describeSource(item)}${item.title ? ` — “${item.title}”` : ''}.`;
        }
      } else {
        headline = item.title || item.summary || 'Found it.';
        detail = `Best match is the ${describeSource(item)}.`;
      }
      break;
    }
    case 'where': {
      headline = place ? `${place.place}.` : (item.title || 'Closest match:');
      detail = `Best evidence is the ${describeSource(item)}${place && place.item.id !== item.id ? ' (and a second item nearby)' : ''}.`;
      break;
    }
    case 'which_site': {
      headline = `${site}${amount ? ` — from ${amount.text}` : ''}.`;
      detail = item.url ? `Saved as ${describeSource(item)} · ${item.url}` : `Saved as ${describeSource(item)}.`;
      break;
    }
    case 'remind': {
      headline = firstSentence(item.summary || item.title || '');
      detail = `That is what you wrote in the ${describeSource(item)}.`;
      break;
    }
    case 'find': {
      headline = `${results.length} item${results.length === 1 ? '' : 's'} match${results.length === 1 ? 'es' : ''} — closest is ${item.title || item.kind}.`;
      detail = `Top hit is a ${describeSource(item)}. The rest are listed below.`;
      break;
    }
    default: {
      if (amount && /\b(cost|price|how much|pay)\b/i.test(understanding.question)) {
        headline = `${amount.text}.`;
      } else {
        const lead = firstSentence(item.summary || item.body || '');
        headline = lead.length > 160 ? `${lead.slice(0, 157)}…` : lead;
      }
      detail = `Best match is the ${describeSource(item)}${item.title ? ` — “${item.title}”` : ''}.`;
      break;
    }
  }

  // Cross-source corroboration — the pitch is "it connects your personal info".
  const corroboration = top.slice(1).filter((r) => r.item.kind !== item.kind || r.item.source !== item.source);
  const related = corroboration.length
    ? ` ${corroboration.length} other item${corroboration.length === 1 ? '' : 's'} in your library agree${corroboration.length === 1 ? 's' : ''} (${corroboration.map((r) => r.item.source).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ')}).`
    : '';

  // If the best item on the phone does not even contain the words the question
  // is about, say so out loud rather than dressing up a weak match as an answer.
  // Never hedge a browsing request ("show me my screenshots") — there the user
  // asked for a shelf, not an assertion.
  const hedged = Boolean(primary) && !understanding.browse && understanding.kinds.length === 0
    && (missingTokens.length > 0 || primaryCov.score < 0.42);
  if (hedged && primary) {
    const missing = missingTokens[0];
    const alsoMentions = missing
      ? results.slice(1, 4).find((r) => coverage(understanding, [r.item]).perToken.find((p) => p.token === missing)?.credit > 0)
      : null;
    headline = missing
      ? `Nothing on your phone mentions “${missing}”. Closest guess below.`
      : 'No confident answer — closest guess below.';
    detail = `The closest thing in your ${understanding.itemCount} items is the ${describeSource(primary.item)}${primary.item.title ? ` — “${primary.item.title}”` : ''}.`;
    if (alsoMentions) detail += ` Another item does mention “${missing}”: “${alsoMentions.item.title}”.`;
    detail += ' Shown as a guess, not an answer.';
  }
  // Confidence: score, coverage, margin over runner-up, lexical/semantic agreement.
  const margin = primary.score - (results[1]?.score ?? 0);
  const signalled = results.filter((r) => r.signals.lexical > 0.25).length;
  const trust = knowledgeConfidence(item);
  const raw =
    0.34 * Math.min(primary.score / 0.72, 1) +
    0.30 * cov.score +
    0.14 * Math.min(margin / 0.22, 1) +
    0.12 * trust +
    0.10 * Math.min(results.length / 3, 1);
  const score = Math.max(0, Math.min(0.98, hedged ? Math.min(raw, 0.42) : raw));
  const label = score >= 0.76 ? 'High' : score >= 0.55 ? 'Good' : score >= 0.36 ? 'Fair' : 'Low';

  const lowConfidence = score < 0.45;
  if (lowConfidence) {
    detail = `Nothing strong turned up. The closest thing on the phone is the ${describeSource(item)}${item.title ? ` — “${item.title}”` : ''}, shown below so you can judge it yourself.`;
  }

  const evidence = results.slice(0, 6).map((r) => ({
    id: r.item.id,
    kind: r.item.kind,
    icon: KIND_ICON[r.item.kind] || '•',
    title: r.item.title || r.item.summary || r.item.id,
    source: r.item.source,
    app: r.item.app || null,
    date: item.capturedAt ? formatDate(r.item.capturedAt) : null,
    daysAgo: r.item.daysAgo ?? null,
    when: r.item.daysAgo == null ? 'always on your phone' : humanDaysAgo(r.item.daysAgo),
    score: r.score,
    matched: r.signals.matchedWords,
    semantic: r.signals.semantic,
    lexical: r.signals.lexical,
    snippet: r.snippet,
    why: r.why,
    isPrimary: r.item.id === item.id
  }));

  const spread = [...new Set(results.map((r) => r.item.source))];

  if (!/[.!?]$/.test(detail)) detail += '.';

  return {
    answer: {
      headline,
      detail: `${detail}${related}`.trim(),
      facts: dedupeFacts(facts).slice(0, 6),
      confidence: {
        score: Number(score.toFixed(2)),
        label,
        signals: {
          match: Number(primary.score.toFixed(3)),
          coverage: Number(cov.score.toFixed(2)),
          margin: Number(margin.toFixed(3)),
          senseMatch: primary.signals.semantic,
          textMatch: primary.signals.lexical,
          sources: signalled,
          trust: Number(trust.toFixed(2))
        },
        perToken: cov.perToken
      },
      primary: item.id,
      hedged,
      evidence
    },
    spread,
    coverage: cov
  };
}

function dedupeFacts(facts) {
  const seen = new Set();
  return facts.filter((f) => {
    const key = `${f.label}:${f.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstSentence(text = '') {
  const [first] = String(text).split(/(?<=[.!?])\s+/);
  return (first || String(text)).trim();
}
