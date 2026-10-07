/**
 * Text helpers: normalisation, tokenisation, snippets and highlighting.
 * Shared by the indexer, the embedding model and the search ranker.
 */

const STOPWORDS = new Set(`
a about above after again against all also am an and any are aren't as at be because been before being
below between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during
each few for from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers
herself him himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more
most mustn't my myself no nor not of off on once only or other ought our ours ourselves out over own same
shan't she she'd she'll she's should shouldn't so some such than that that's the their theirs them themselves
then there there's these they they'd they'll they're they've this those through to too under until up very
was wasn't we we'd we'll we're we've were weren't what what's when when's where where's which while who who's
whom why why's with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves
`.trim().split(/\s+/));

const questionWords = new Set(["what", "where", "when", "who", "why", "how", "which", "was", "did", "is", "are", "the", "a", "an", "my", "i", "that", "me", "about", "of", "for", "to", "in", "on", "with", "and"]);

export function isStopword(w) {
  return STOPWORDS.has(w);
}

/** Collapse whitespace, normalise quotes/dashes, keep the text readable. */
export function cleanText(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Lowercase, strip diacritics, split into word-ish tokens. */
export function tokenize(text) {
  const normalised = stripAccents(String(text || "").toLowerCase()).normalize("NFKC");
  const out = [];
  const re = /[a-z0-9]+(?:['-][a-z0-9]+)*/g;
  let m;
  while ((m = re.exec(normalised))) out.push(m[0]);
  return out;
}

export function contentTokens(text) {
  return tokenize(text).filter((t) => !STOPWORDS.has(t) && t.length > 1);
}

export function stem(token) {
  let t = token;
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && /(ches|shes|xes|sses|zes)$/.test(t)) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss") && !t.endsWith("us")) return t.slice(0, -1);
  if (t.length > 5 && t.endsWith("ing")) return t.slice(0, -3);
  if (t.length > 4 && t.endsWith("ed")) return t.slice(0, -2);
  return t;
}

export function stemSet(tokens) {
  return new Set(tokens.map(stem));
}

export function stripAccents(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function truncate(s, n) {
  if (!s) return "";
  const t = String(s);
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + "…";
}

export function formatBytes(b) {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
}

export function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

export function relativeDate(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.round((now - d) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/** Split text into sentences, keeping it simple and stable. */
export function sentences(text) {
  return String(text || "")
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

/**
 * Build a short display snippet around the best run of query terms.
 * Returns { text, ranges: [[start, end], ...] } for the matched terms.
 */
export function snippet(body, queryTerms, maxLen = 220) {
  const text = cleanText(body).replace(/\n+/g, " · ");
  if (!text) return { text: "", ranges: [] };
  const lower = stripAccents(text.toLowerCase());
  const terms = [...new Set(queryTerms.filter((t) => t && t.length > 1))].sort((a, b) => b.length - a.length);

  let bestStart = 0;
  let bestHits = 0;
  if (terms.length) {
    for (let i = 0; i < lower.length; i += 12) {
      const win = lower.slice(i, i + maxLen);
      let hits = 0;
      for (const t of terms) if (win.includes(t)) hits++;
      if (hits > bestHits) {
        bestHits = hits;
        bestStart = i;
      }
    }
  }
  let start = Math.max(0, bestStart === 0 ? 0 : Math.max(0, bestStart - 40));
  let end = Math.min(text.length, start + maxLen);
  if (end < text.length) {
    const nextSpace = text.indexOf(" ", end);
    if (nextSpace > -1 && nextSpace - end < 24) end = nextSpace;
  }
  let chunk = text.slice(start, end).trim();

  // locate terms inside the chunk for highlighting
  const chunkLower = stripAccents(chunk.toLowerCase());
  const ranges = [];
  for (const t of terms) {
    let idx = 0;
    while ((idx = chunkLower.indexOf(t, idx)) !== -1) {
      ranges.push([idx, idx + t.length]);
      idx += t.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }

  return { text: chunk, ranges: merged };
}

/** Percentage of query terms (stemmed) found in the document text. */
export function termCoverage(queryTerms, docTerms) {
  const q = [...new Set(queryTerms.map(stem))].filter((t) => t.length > 1);
  if (!q.length) return 0;
  const doc = stemSet(docTerms);
  let hit = 0;
  for (const t of q) if (doc.has(t)) hit++;
  return hit / q.length;
}

export { questionWords };
