/**
 * Text, language and entity utilities.
 *
 * Everything in here is deliberately dependency-free and small enough to run
 * on a phone: tokenising, stopwords, a synonym graph for query expansion,
 * entity extraction (money, phone numbers, dates, times, names) and the
 * query understanding step that decides what kind of question was asked.
 */

const STOPWORDS = new Set(
  `a an the and or but if then than that this these those there here is are was were be been being am do does did doing done
   have has had having i me my mine we us our you your yours he him his she her hers it its they them their theirs
   of in on at to for from by with about into over after before between under above again further once
   what which who whom whose when where why how all any both each few more most other some such no nor not only own same so
   too very can will just should now s t don don't didnt didn't im i'm ive i've me my myself
   please find show tell give look looking looked get got goes went say said says
   found remember remembers remembered recall forgot forgotten memory much many lot
   thing things stuff`
    .split(/\s+/)
    .filter(Boolean)
);

/** Query-side concept expansion. Symmetric — applied to documents too, at a discount. */
const SYNONYMS = {
  cheap: ['cheapest', 'cheaper', 'deal', 'deals', 'bargain', 'budget', 'savings', 'affordable', 'low', 'price', 'fare'],
  flight: ['flights', 'fly', 'airline', 'airlines', 'fare', 'fares', 'booking', 'skyscanner', 'airport', 'cpt', 'lhr'],
  website: ['site', 'page', 'url', 'link', 'browser', 'web', 'online', 'saved'],
  recommend: ['recommended', 'recommendation', 'suggested', 'referred', 'sent', 'told'],
  mechanic: ['garage', 'workshop', 'repairs', 'service', 'serviced', 'car', 'auto'],
  car: ['vehicle', 'motor', 'golf', 'polo', 'service', 'serviced', 'mechanic', 'garage', 'tyres', 'wipers'],
  cafe: ['coffee', 'cafe', 'cafes', 'espresso', 'latte', 'matcha', 'breakfast', 'wifi', 'plug', 'plugpoints'],
  work: ['office', 'meeting', 'project', 'team', 'deadline', 'migration', 'kickoff'],
  rent: ['rental', 'flat', 'apartment', 'housing', 'lease', 'tenancy', 'pcm', 'deposit', 'landlord'],
  trip: ['holiday', 'travel', 'break', 'flights', 'hotel', 'stay', 'visit'],
  wine: ['red', 'bottle', 'blend', 'drink', 'glass', 'restaurant'],
  book: ['novel', 'reading', 'read', 'chapter', 'paperback', 'author'],
  physio: ['physiotherapy', 'physiotherapist', 'hip', 'exercises', 'therapy', 'appointment'],
  focus: ['concentrate', 'productivity', 'attention', 'deep', 'blocks'],
  screenshot: ['screenshots', 'screengrab', 'screen', 'capture'],
  photo: ['photos', 'picture', 'pictures', 'image', 'camera', 'shot', 'snap'],
  note: ['notes', 'jot', 'jotted', 'memo', 'reminder', 'list'],
  email: ['emails', 'mail', 'inbox', 'sent', 'message'],
  voice: ['memo', 'memos', 'recording', 'recorded', 'transcript', 'spoken', 'audio'],
  event: ['calendar', 'appointment', 'booking', 'diary', 'schedule', 'entry'],
  contact: ['contacts', 'person', 'number', 'phone', 'card'],
  number: ['phone', 'tel', 'telephone', 'contact', 'call', 'mobile', 'cell'],
  birthday: ['birthdays', 'born', 'cake', 'party'],
  mum: ['mom', 'mother', 'moms'],
  build: ['built', 'building', 'make', 'made', 'code', 'implement'],
  idea: ['ideas', 'concept', 'invention', 'brainwave'],
  london: ['uk', 'england', 'britain', 'heathrow', 'camden'],
  lisbon: ['portugal', 'portuguese', 'alfama', 'sintra', 'portugese'],
  flights: ['cheap', 'deals', 'booking', 'airline'],
  cost: ['price', 'paid', 'pay', 'amount', 'total', 'spent', 'charge', 'invoice', 'bill'],
  booked: ['booking', 'reserved', 'reservation', 'scheduled'],
  watched: ['watching', 'watched', 'watch', 'series', 'series'],
  ate: ['eat', 'eating', 'food', 'meal', 'restaurant', 'dinner']
};

/** Reverse map so document tokens can be expanded through the same graph. */
const SYNONYM_LOOKUP = (() => {
  const out = new Map();
  for (const [canonical, list] of Object.entries(SYNONYMS)) {
    const group = [canonical, ...list];
    for (const term of group) {
      if (!out.has(term)) out.set(term, new Set());
      for (const other of group) if (other !== term) out.get(term).add(other);
    }
  }
  return out;
})();

export function normalise(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9€£$#%+\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text = '') {
  return normalise(text)
    .split(/[\s.]+/)
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ''))
    .filter((t) => t.length > 1 || /^[0-9]$/.test(t));
}

/** Content tokens: stopwords and bare numbers stripped. */
export function contentTokens(text = '') {
  return tokenize(text).filter((t) => !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/** Expand a token list with synonyms. Returns Map<token, weight>. */
export function expand(tokens, { weight = 0.62 } = {}) {
  const out = new Map();
  for (const token of tokens) {
    out.set(token, Math.max(out.get(token) ?? 0, 1));
    const related = SYNONYM_LOOKUP.get(token) ?? SYNONYM_LOOKUP.get(singular(token));
    if (related) {
      for (const rel of related) out.set(rel, Math.max(out.get(rel) ?? 0, weight));
    }
  }
  return out;
}

/** Crude but useful: "flights" -> "flight", "photos" -> "photo". */
export function singular(token) {
  if (token.length <= 3) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ses') || token.endsWith('xes') || token.endsWith('hes')) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}

export function stemMatch(a, b) {
  if (a === b) return true;
  const sa = singular(a);
  const sb = singular(b);
  if (sa === sb) return true;
  return sa.length >= 4 && sb.length >= 4 && (sa.startsWith(sb) || sb.startsWith(sa));
}

// ── Entity extraction ────────────────────────────────────────────────────────

const MONTHS = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8,
  october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11
};

export const KIND_WORDS = {
  screenshot: ['screenshot', 'screenshots', 'screengrab', 'screen'],
  photo: ['photo', 'photos', 'picture', 'pictures', 'image', 'images', 'camera'],
  note: ['note', 'notes', 'memo'],
  email: ['email', 'emails', 'mail', 'inbox'],
  voice: ['voice', 'memo', 'recording', 'transcript', 'audio'],
  event: ['calendar', 'event', 'events', 'appointment', 'diary'],
  contact: ['contact', 'contacts', 'card'],
  page: ['page', 'pages', 'article', 'articles', 'reading', 'list', 'tab', 'tabs']
};

export function extractEntities(question = '') {
  const raw = String(question);
  const lower = raw.toLowerCase();
  const entities = [];

  for (const m of raw.matchAll(/[R$€£]\s?\d[\d\s.,]*\d|[R$€£]\s?\d/g)) {
    entities.push({ type: 'money', text: m[0].trim(), value: parseAmount(m[0]) });
  }
  for (const m of lower.matchAll(/\b(0\d{2}[\s-]?\d{3}[\s-]?\d{4}|\+?\d{2}\s?\d{3}\s?\d{3}\s?\d{3,4}|0\d[\s-]?\d{3}\s?\d{4})\b/g)) {
    entities.push({ type: 'phone', text: m[0].trim(), value: m[0].replace(/[\s-]/g, '') });
  }
  for (const m of lower.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\b/g)) {
    if (MONTHS[m[2]] != null) entities.push({ type: 'date', text: m[0], day: Number(m[1]), month: MONTHS[m[2]] });
  }
  for (const m of lower.matchAll(/\b([a-z]{3,9})\s+(\d{4})\b/g)) {
    if (MONTHS[m[1]] != null) entities.push({ type: 'date', text: m[0], month: MONTHS[m[1]], year: Number(m[2]) });
  }
  for (const m of lower.matchAll(/\b(19|20)\d{2}\b/g)) {
    entities.push({ type: 'year', text: m[0], value: Number(m[0]) });
  }
  for (const m of raw.matchAll(/"([^"]{2,60})"|“([^”]{2,60})”/g)) {
    entities.push({ type: 'phrase', text: (m[1] || m[2]).trim() });
  }
  // Proper nouns: capitalised words that are not simply the sentence opener.
  const sentenceStarters = new Set(['what', 'when', 'where', 'who', 'which', 'how', 'was', 'did', 'do', 'is', 'the', 'my', 'i', 'can', 'show', 'find', 'tell', 'remind']);
  raw.split(/[^A-Za-z'’-]+/).forEach((word, i) => {
    if (!/^[A-Z][a-z]{2,}/.test(word)) return;
    if (i === 0 && sentenceStarters.has(word.toLowerCase())) return;
    if (STOPWORDS.has(word.toLowerCase())) return;
    entities.push({ type: 'name', text: word });
  });

  const seen = new Set();
  return entities.filter((e) => {
    const key = `${e.type}:${e.text.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseAmount(text) {
  const digits = String(text).replace(/[^\d.,]/g, '');
  if (!digits) return null;
  // R9 420 / €1 925 / £1,925.00 / R3 182.90
  const cleaned = digits.replace(/\s/g, '');
  const hasDecimals = /[.,]\d{2}$/.test(cleaned);
  const intPart = hasDecimals ? cleaned.slice(0, -3) : cleaned;
  const decPart = hasDecimals ? cleaned.slice(-3) : '';
  const normalisedInt = intPart.replace(/[.,]/g, '');
  if (!normalisedInt) return null;
  return Number(normalisedInt + decPart.replace(',', '.'));
}

/** All money amounts that appear in a body of text. */
export function findAmounts(text = '') {
  const out = [];
  const src = String(text);
  // Two careful rules, both learned the hard way:
  //  • the symbol class is case-sensitive on purpose — an insensitive `r` turns
  //    "number 8842" into "r 8842", i.e. a rand amount;
  //  • a bare digit group is only money when a currency word follows, otherwise
  //    phone numbers ("073 630 7561") get read as amounts.
  const symbol = /(?:^|[^\w])([$€£])\s?(\d{1,3}(?:[ .,]\d{3})*(?:[.,]\d{2})?)(?![\d\s.,]?\d)/g;
  const rand = /(?:^|[^\w])(R)\s?(\d{1,3}(?:[ .,]\d{3})*(?:[.,]\d{2})?)(?![\d\s.,]?\d)/g;
  const spelled = /(?:^|[^\w])(\d{1,3}(?:[ .,]\d{3})*(?:[.,]\d{2})?)\s?(?:rand|euro|euros|pounds|dollars)\b/gi;
  for (const re of [symbol, rand, spelled]) {
    for (const m of src.matchAll(re)) {
      const raw = m[2] != null && m[1] && /[A-Za-z]/.test(m[1]) ? `${m[1]}${m[2]}` : m[0];
      const value = parseAmount(raw);
      if (value == null || value < 5) continue;
      out.push({ text: raw.trim(), value, index: m.index + (m[0].length - raw.length) });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

export function findPhones(text = '') {
  const out = [];
  for (const m of String(text).matchAll(/(?:^|[^\d])0\d{2}[\s-]?\d{3}[\s-]?\d{4}|\+\d{2}[\s-]?\d{2,3}[\s-]?\d{3}[\s-]?\d{3,4}/g)) {
    out.push({ text: m[0].trim(), value: m[0].replace(/[\s-]/g, '') });
  }
  return out;
}

/** Names that appear in the text as "From: X" or "at the counter: X". */
export function findPeople(text = '') {
  const out = new Set();
  for (const m of String(text).matchAll(/(?:from|by|with|ask for|speak to|contact)\s*:?\s*([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)/g)) {
    out.add(m[1]);
  }
  return [...out];
}

// ── Query understanding ──────────────────────────────────────────────────────

const INTENT_RULES = [
  { intent: 'when', re: /^(when|what time|what day|which date|how long ago|what date)\b/ },
  { intent: 'when', re: /\b(what date|which day|how old)\b/ },
  { intent: 'who', re: /^(who|whose)\b/ },
  { intent: 'who', re: /\bwho (was|is|gave|sent|told|recommended)\b/ },
  { intent: 'how_much', re: /^(how much|what did .* cost|what was the price|price of|how expensive)\b/ },
  { intent: 'how_much', re: /\b(how much|cost|price|what did .* pay|how expensive)\b/ },
  { intent: 'where', re: /^(where|which (place|city|cafe|restaurant|shop|street|area))\b/ },
  { intent: 'which_site', re: /\b(website|site|url|link|page|app)\b/ },
  { intent: 'remind', re: /^(remind me|what did i (write|note|say|save)|what was i)\b/ },
  { intent: 'find', re: /^(show me|find|list|search|give me)\b/ }
];

export function understand(question = '', { knownNames = [], itemCount = 0 } = {}) {
  const q = String(question).trim();
  const lower = q.toLowerCase();
  const entities = extractEntities(q);
  const tokens = contentTokens(q);
  const synonyms = expand(tokens);

  let intent = 'what';
  for (const rule of INTENT_RULES) {
    if (rule.re.test(lower)) { intent = rule.intent; break; }
  }
  if (intent === 'what' && /\b(what|which)\b/.test(lower)) intent = 'what';
  if (intent === 'which_site' && /\b(what was that|which one|where did i save)\b/.test(lower)) intent = 'which_site';

  // Explicit "show me my screenshots" style filters.
  const kinds = [];
  for (const [kind, words] of Object.entries(KIND_WORDS)) {
    for (const w of words) {
      if (new RegExp(`\\b${w}\\b`).test(lower)) { kinds.push(kind); break; }
    }
  }
  // "memo" is both a note word and a voice word — prefer voice when "voice" present.
  const kindsSet = new Set(kinds);
  if (/voice/.test(lower)) kindsSet.delete('note');

  const sources = [];
  if (/\bphotos?\b/.test(lower)) sources.push('Photos');
  if (/\bscreenshots?\b/.test(lower)) sources.push('Screenshots');
  if (/\bmails?\b|\bemails?\b|\binbox\b/.test(lower)) sources.push('Mail');
  if (/\bcalendar\b|\bevents?\b/.test(lower)) sources.push('Calendar');
  if (/\bcontacts?\b/.test(lower)) sources.push('Contacts');
  if (/\bvoice\b/.test(lower)) sources.push('Voice Memos');

  const people = knownNames.filter((name) => lower.includes(name.toLowerCase()));
  for (const e of entities) {
    if (e.type === 'name' && knownNames.some((n) => n.toLowerCase() === e.text.toLowerCase())) people.push(e.text);
  }

  // Time window hints. A stated period ("in the last month") is a filter; a
  // vague one ("recently") only tilts the ranking.
  let window = null;
  let hardWindow = false;
  if (/\b(last|past) (week|7 days)\b/.test(lower)) { window = 7; hardWindow = true; }
  if (/\b(last|past) month\b|\b30 days\b/.test(lower)) { window = 30; hardWindow = true; }
  if (/\b(last|past) (year|12 months)\b/.test(lower)) { window = 365; hardWindow = true; }
  if (/\bthis (week|month)\b/.test(lower)) { window = /week/.test(lower) ? 7 : 30; hardWindow = true; }
  if (/\b(recently|lately|the other day)\b/.test(lower)) window = 21;

  const wantsList = /\b(all|every|list|show me|everything)\b/.test(lower) || /\bwhat else\b/.test(lower);
  // Browsing: the only content words left after stopwords are source/kind words.
  const kindVocabulary = new Set(Object.values(KIND_WORDS).flat());
  const browse = kindsSet.size > 0 && tokens.every((t) => kindVocabulary.has(t) || kindVocabulary.has(singular(t)));

  return {
    question: q,
    normalised: normalise(q),
    knownNames,
    intent,
    tokens,
    synonyms: [...synonyms.keys()],
    entities,
    kinds: [...kindsSet],
    sources,
    people: [...new Set(people)],
    window,
    hardWindow,
    wantsList,
    browse,
    itemCount
  };
}

/** Split into sentences, keeping it cheap. */
export function sentences(text = '') {
  return String(text)
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function humanDaysAgo(days) {
  if (days == null) return null;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 35) return `${Math.round(days / 7)} weeks ago`;
  if (days < 60) return 'last month';
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const years = (days / 365).toFixed(1).replace(/\.0$/, '');
  return `${years} ${years === '1' ? 'year' : 'years'} ago`;
}

export function formatDate(iso, { withYear = true, withTime = false } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opts = { day: 'numeric', month: 'long' };
  if (withYear) opts.year = 'numeric';
  if (withTime) { opts.hour = '2-digit'; opts.minute = '2-digit'; }
  return d.toLocaleDateString('en-GB', opts);
}

export const ALL_STOPWORDS = STOPWORDS;
