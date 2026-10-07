/**
 * Ingestion pipeline: turn a phone artefact (image, note, message, saved page)
 * into a searchable memory: OCR text, entities, keywords and a vector.
 */

import fs from "node:fs";
import path from "node:path";
import { cleanText, contentTokens, tokenize, truncate } from "./text.js";
import { extractEntities } from "./entities.js";
import { UPLOAD_DIR, sha1 } from "./store.js";

const IMAGE_MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".bmp": "image/bmp", ".gif": "image/gif" };

export function mimeOf(file) {
  return IMAGE_MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function topKeywords(text, limit = 12) {
  const counts = new Map();
  for (const tok of contentTokens(text)) {
    if (tok.length < 3) continue;
    counts.set(tok, (counts.get(tok) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t]) => t);
}

/** Text the embedder sees: the things a human would say this memory is about. */
export function embeddingText(doc) {
  const parts = [
    doc.title,
    doc.caption,
    doc.source && doc.kind ? `${doc.kind} from ${doc.source}` : "",
    doc.location,
    doc.body,
  ].filter(Boolean);
  return truncate(cleanText(parts.join("\n")), 1500);
}

/**
 * Tesseract returns visual lines, so a wrapped sentence arrives in pieces.
 * Join pieces back together before the text is embedded and indexed.
 */
const CONTINUES = new Set(["on", "the", "a", "an", "to", "and", "with", "for", "of", "in", "at", "my",
  "his", "her", "their", "our", "your", "is", "was", "are", "were", "that", "this", "from", "by", "as",
  "or", "but", "so", "if", "when", "while", "after", "before", "then", "than", "into", "over", "under",
  "not", "no", "it", "we", "they", "he", "she", "up", "out", "about", "because"]);

export function joinWrappedLines(text) {
  const lines = cleanText(text).split("\n");
  const out = [];
  for (const line of lines) {
    const last = out[out.length - 1];
    const prevWords = last ? last.trim().split(/\s+/) : [];
    const prevTail = (prevWords[prevWords.length - 1] || "").toLowerCase().replace(/[^a-z]/g, "");
    const unfinished = last && !/[.!?:;)\]"'”]$/.test(last.trim());
    const continues = unfinished && (CONTINUES.has(prevTail) || last.trim().length > 34);
    const startsLower = /^[a-z(]/.test(line.trim());
    if (last && (continues || (startsLower && unfinished))) out[out.length - 1] = `${last.trim()} ${line.trim()}`;
    else out.push(line);
  }
  return cleanText(out.join("\n"));
}

/** Guess a human title for an image from the text OCR just read out of it. */
export function titleFromOcr(body, fallback) {
  const lines = cleanText(body).split("\n").map((l) => l.trim()).filter(Boolean);
  const scored = [];
  for (const [index, line] of lines.entries()) {
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    const digits = (line.match(/\d/g) || []).length;
    const words = line.split(/\s+/).length;
    if (letters < 4 || words < 2 || words > 12) continue;
    if (/^\d{1,2}:\d{2}/.test(line)) continue;      // status bar clock
    if (/^(\d+%|5g|4g|lte|wifi)$/i.test(line)) continue;
    if (digits > letters) continue;                   // codes, phone numbers, prices
    if (/^(page|menu|search|login|sign in|home)$/i.test(line)) continue;
    let score = words * 1.2 + Math.min(letters, 40) / 10;
    if (/[A-Z][a-z]+ [A-Z][a-z]+/.test(line)) score += 1.5;
    score -= digits * 0.5;                    // phone numbers, prices, codes
    score += Math.max(0, 3 - index * 0.4);    // titles usually sit near the top
    scored.push({ line, score });
  }
  if (!scored.length) return fallback;
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0].line.replace(/[|•·]+$/g, "").trim();
  return best.length > 60 ? best.slice(0, 57).trimEnd() + "…" : best;
}

export function buildSearchText(doc) {
  return cleanText([
    doc.title,
    doc.source,
    doc.kind,
    doc.location,
    doc.album,
    doc.caption,
    doc.url,
    doc.body,
  ].filter(Boolean).join("\n"));
}

export class Ingestor {
  constructor({ store, embedder, ocr }) {
    this.store = store;
    this.embedder = embedder;
    this.ocr = ocr;
  }

  /**
   * Ingest an image file (screenshot / photo) - runs OCR for real.
   * @param {object} opts
   * @param {string} [opts.filePath]  existing file to keep + read
   * @param {Buffer} [opts.buffer]    uploaded bytes (stored into data/uploads)
   */
  async ingestImage({ filePath, buffer, meta = {}, copy = true }) {
    const bytes = buffer ?? fs.readFileSync(filePath);
    const hash = sha1(bytes);
    const ext = (filePath ? path.extname(filePath) : ".png").toLowerCase();
    const id = "doc_" + hash.slice(0, 12);

    if (this.store.hasHash(hash) && this.store.byId(id)) {
      const existing = this.store.byId(id);
      return { doc: existing, skipped: true };
    }

    // keep a copy inside data/uploads so previews keep working
    let storedPath = filePath;
    if (copy || !filePath) {
      const name = `${id}${ext}`;
      storedPath = path.join(UPLOAD_DIR, name);
      fs.writeFileSync(storedPath, bytes);
    }

    const ocrResult = await this.ocr.recognize(storedPath);

    const doc = {
      id,
      hash,
      name: meta.name || (filePath ? path.basename(filePath) : `upload${ext}`),
      title: meta.title || "",
      kind: meta.kind || "screenshot",
      source: meta.source || meta.app || "Imported",
      album: meta.album || "Screenshots",
      caption: meta.caption || "",
      location: meta.location || "",
      url: meta.url || "",
      capturedAt: meta.capturedAt || new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      mimeType: meta.mimeType || mimeOf(storedPath),
      size: bytes.length,
      width: meta.width || null,
      height: meta.height || null,
      filePath: storedPath,
      body: joinWrappedLines(ocrResult.text),
      textSource: "ocr",
      ocr: {
        confidence: ocrResult.confidence,
        ms: ocrResult.ms,
        lines: ocrResult.lines.length,
        words: ocrResult.words.length,
      },
      ocrLines: ocrResult.lines.map((l) => ({
        t: l.text,
        b: l.bbox ? [Math.round(l.bbox.x0), Math.round(l.bbox.y0), Math.round(l.bbox.x1), Math.round(l.bbox.y1)] : null,
        c: Math.round(l.confidence || 0),
      })),
    };
    if (!doc.title) {
      const fromFile = doc.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
      doc.title = titleFromOcr(doc.body, fromFile) || fromFile;
    }

    this.finish(doc);
    const vector = await this.embedder.encode(embeddingText(doc));
    this.store.add(doc, vector);
    return { doc, skipped: false };
  }

  /**
   * Ingest a text memory: a note, a saved page, an SMS/WhatsApp message, email.
   */
  async ingestText(meta) {
    const body = cleanText(meta.body || meta.text || "");
    // Identity is the content itself, so saving the same note twice is a no-op
    // (the phone should not "remember" the same thing four times).
    const hash = sha1(Buffer.from(`${(meta.title || "").trim().toLowerCase()}|${body}`));
    const id = "doc_" + hash.slice(0, 12);
    const existing = this.store.byId(id) || this.store.docs.find((d) => d.hash === hash);
    if (existing) return { doc: existing, skipped: true };

    const doc = {
      id,
      hash,
      name: meta.name || `${(meta.title || "memory").slice(0, 40)}`,
      title: meta.title || truncate(body.split("\n")[0], 60),
      kind: meta.kind || "note",
      source: meta.source || "Notes",
      album: meta.album || "Notes",
      caption: meta.caption || "",
      location: meta.location || "",
      url: meta.url || "",
      capturedAt: meta.capturedAt || new Date().toISOString(),
      ingestedAt: new Date().toISOString(),
      mimeType: "text/plain",
      size: Buffer.byteLength(body),
      filePath: null,
      body,
      textSource: "provided",
      ocr: null,
    };
    this.finish(doc);
    const vector = await this.embedder.encode(embeddingText(doc));
    this.store.add(doc, vector);
    return { doc, skipped: false };
  }

  /** Shared post-processing: entity extraction, keywords, search text. */
  finish(doc) {
    doc.text = buildSearchText(doc);
    doc.tokens = tokenize(doc.text);
    doc.keywords = topKeywords(`${doc.title} ${doc.caption} ${doc.body}`);
    const { entities } = extractEntities(`${doc.title}\n${doc.caption}\n${doc.body}\n${doc.url}`);
    doc.entities = entities;
    doc.entityIndex = [...new Set(entities.map((e) => e.key))];
    return doc;
  }
}
