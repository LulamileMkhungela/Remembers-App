/**
 * Persistent memory store.
 *
 * Documents + their embeddings are kept on disk under data/ so what the app
 * "remembers" survives a restart. Vectors live in a flat binary file; the JSON
 * file holds everything else.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EMBED_DIM } from "./embed.js";

const ROOT = process.cwd();
export const DATA_DIR = path.join(ROOT, "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const STORE_FILE = path.join(DATA_DIR, "store.json");
const VECTOR_FILE = path.join(DATA_DIR, "vectors.bin");

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

export class Store {
  constructor() {
    ensureDirs();
    this.docs = [];
    this.vectors = new Map(); // id -> Float32Array
    this.meta = { created: new Date().toISOString(), version: 1 };
    this.dirty = false;
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(STORE_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
        this.docs = parsed.documents || [];
        this.meta = parsed.meta || this.meta;
        if (fs.existsSync(VECTOR_FILE)) {
          const buf = fs.readFileSync(VECTOR_FILE);
          const stride = EMBED_DIM * 4;
          this.docs.forEach((doc, i) => {
            const off = i * stride;
            if (off + stride <= buf.length) {
              this.vectors.set(doc.id, new Float32Array(buf.buffer.slice(buf.byteOffset + off, buf.byteOffset + off + stride)));
            }
          });
        }
      }
    } catch (err) {
      console.error("[store] could not load previous index:", err.message);
      this.docs = [];
      this.vectors = new Map();
    }
  }

  persist() {
    const stride = EMBED_DIM * 4;
    const bin = Buffer.alloc(this.docs.length * stride);
    this.docs.forEach((doc, i) => {
      const vec = this.vectors.get(doc.id);
      if (vec) Buffer.from(vec.buffer, vec.byteOffset, stride).copy(bin, i * stride);
    });
    fs.writeFileSync(VECTOR_FILE, bin);
    fs.writeFileSync(STORE_FILE, JSON.stringify({
      meta: { ...this.meta, savedAt: new Date().toISOString() },
      documents: this.docs,
    }, null, 2));
    this.dirty = false;
  }

  get size() {
    return this.docs.length;
  }

  byId(id) {
    return this.docs.find((d) => d.id === id) || null;
  }

  hasHash(hash) {
    return this.docs.some((d) => d.hash === hash);
  }

  add(doc, vector) {
    const idx = this.docs.findIndex((d) => d.id === doc.id);
    if (idx >= 0) this.docs[idx] = doc;
    else this.docs.push(doc);
    if (vector) this.vectors.set(doc.id, vector);
    this.dirty = true;
    return doc;
  }

  remove(id) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => d.id !== id);
    this.vectors.delete(id);
    this.dirty = this.docs.length !== before;
    return before !== this.docs.length;
  }

  clear() {
    this.docs = [];
    this.vectors = new Map();
    this.persist();
  }

  vectorOf(id) {
    return this.vectors.get(id) || null;
  }

  /** All docs that have a vector, ready for scoring. */
  vectorised() {
    return this.docs.filter((d) => this.vectors.has(d.id));
  }

  summary() {
    const byKind = {};
    const bySource = {};
    let ocrDocs = 0;
    let entities = 0;
    for (const d of this.docs) {
      byKind[d.kind] = (byKind[d.kind] || 0) + 1;
      bySource[d.source] = (bySource[d.source] || 0) + 1;
      if (d.textSource === "ocr") ocrDocs++;
      entities += (d.entities || []).length;
    }
    return { total: this.docs.length, byKind, bySource, ocrDocs, entities };
  }
}
