/**
 * Real semantic embeddings, fully on-device.
 *
 * Model: sentence-transformers/all-MiniLM-L6-v2 (384 dimensions), run through
 * ONNX Runtime. The weights ship vendored inside an npm package so the app
 * never calls out to a model API - "your phone remembers" stays on the phone.
 *
 * The tokenizer is a from-scratch BERT WordPiece implementation driven by the
 * model's own tokenizer.json, so tokenisation matches the reference model.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { stripAccents } from "./text.js";

const require = createRequire(import.meta.url);

export const EMBED_DIM = 384;
export const MAX_TOKENS = 256;

function resolveModelDir() {
  const candidates = [
    process.env.REMEMBERS_MODEL_DIR,
    path.join(process.cwd(), "node_modules/@ryanstark24/sfgraph-models/data/Xenova/all-MiniLM-L6-v2"),
    "/home/user/Remembers-App/node_modules/@ryanstark24/sfgraph-models/data/Xenova/all-MiniLM-L6-v2",
  ].filter(Boolean);
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, "onnx/model_quantized.onnx"))) return c;
  }
  return null;
}

/* ------------------------------------------------------------------ vocab -- */

class WordPiece {
  constructor(tokenizerJson) {
    this.vocab = tokenizerJson.model.vocab;
    this.ids = new Map();
    for (const [tok, id] of Object.entries(this.vocab)) this.ids.set(tok, id);
    this.unk = tokenizerJson.model.unk_token ?? "[UNK]";
    this.prefix = tokenizerJson.model.continuing_subword_prefix ?? "##";
    this.maxChars = tokenizerJson.model.max_input_chars_per_word ?? 100;
    this.maxLen = tokenizerJson.truncation?.max_length ?? MAX_TOKENS;
    this.cls = this.ids.get("[CLS]") ?? 101;
    this.sep = this.ids.get("[SEP]") ?? 102;
    this.pad = this.ids.get("[PAD]") ?? 0;
    this.unkId = this.ids.get("[UNK]") ?? 100;
  }

  isPunct(ch) {
    if (/\s/.test(ch)) return false;
    if (/[\p{P}\p{S}]/u.test(ch)) return true;
    return false;
  }

  /** BertPreTokenizer: split on whitespace, then isolate punctuation. */
  preTokenize(text) {
    const pieces = [];
    for (const chunk of text.split(/\s+/)) {
      if (!chunk) continue;
      let current = "";
      for (const ch of chunk) {
        if (this.isPunct(ch)) {
          if (current) pieces.push(current);
          current = "";
          pieces.push(ch);
        } else {
          current += ch;
        }
      }
      if (current) pieces.push(current);
    }
    return pieces;
  }

  wordPiece(token) {
    if (token.length > this.maxChars) return [this.unk];
    const out = [];
    let start = 0;
    while (start < token.length) {
      let end = token.length;
      let found = null;
      while (start < end) {
        const sub = (start > 0 ? this.prefix : "") + token.slice(start, end);
        if (this.ids.has(sub)) {
          found = sub;
          break;
        }
        end--;
      }
      if (found === null) return [this.unk];
      out.push(found);
      start = end;
    }
    return out;
  }

  encode(text) {
    const normalised = stripAccents(String(text || "").toLowerCase()).normalize("NFKC")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const ids = [this.cls];
    for (const piece of this.preTokenize(normalised)) {
      for (const sub of this.wordPiece(piece)) {
        ids.push(this.ids.get(sub) ?? this.unkId);
        if (ids.length >= this.maxLen - 1) break;
      }
      if (ids.length >= this.maxLen - 1) break;
    }
    ids.push(this.sep);
    return ids;
  }
}

/* ---------------------------------------------------------------- embedder -- */

export class Embedder {
  constructor() {
    this.ready = false;
    this.mode = "unloaded";
    this.dim = EMBED_DIM;
    this.docs = 0;
    this.totalMs = 0;
  }

  findModelDir() {
    return resolveModelDir();
  }

  async init() {
    if (this.ready) return this;
    const dir = this.findModelDir();
    if (!dir) throw new Error("Embedding model weights not found. Run `npm install` (see tools/setup.mjs).");

    const tokenizerJson = JSON.parse(fs.readFileSync(path.join(dir, "tokenizer.json"), "utf8"));
    this.tokenizer = new WordPiece(tokenizerJson);
    this.modelPath = path.join(dir, "onnx/model_quantized.onnx");

    try {
      const ort = require("onnxruntime-node");
      this.ort = ort;
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
        intraOpNumThreads: Math.max(1, Math.min(4, (require("node:os").cpus() || []).length)),
      });
      this.mode = "onnxruntime-node (cpu)";
    } catch (err) {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = path.join(process.cwd(), "node_modules/onnxruntime-web/dist") + path.sep;
      this.ort = ort;
      this.session = await ort.InferenceSession.create(this.modelPath, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      this.mode = "onnxruntime-web (wasm fallback)";
    }

    this.ready = true;
    return this;
  }

  /**
   * Mean-pooled, L2-normalised sentence embeddings (the standard
   * all-MiniLM-L6-v2 recipe: mean pooling over the attention mask).
   */
  async encodeBatch(texts, { batchSize = 8 } = {}) {
    await this.init();
    const vecs = [];
    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      const encoded = slice.map((t) => this.tokenizer.encode(t));
      const maxLen = Math.max(...encoded.map((e) => e.length));
      const B = slice.length;
      const inputIds = new BigInt64Array(B * maxLen);
      const attention = new BigInt64Array(B * maxLen);
      encoded.forEach((ids, b) => {
        for (let j = 0; j < maxLen; j++) {
          const id = j < ids.length ? ids[j] : this.tokenizer.pad;
          inputIds[b * maxLen + j] = BigInt(id);
          attention[b * maxLen + j] = BigInt(j < ids.length ? 1 : 0);
        }
      });
      const feeds = {
        input_ids: new this.ort.Tensor("int64", inputIds, [B, maxLen]),
        attention_mask: new this.ort.Tensor("int64", attention, [B, maxLen]),
        token_type_ids: new this.ort.Tensor("int64", new BigInt64Array(B * maxLen), [B, maxLen]),
      };
      const t0 = performance.now();
      const out = await this.session.run(feeds);
      const hidden = out.last_hidden_state ?? out[Object.keys(out)[0]];
      const [, L, D] = hidden.dims;
      const data = hidden.data;
      for (let b = 0; b < B; b++) {
        const vec = new Float32Array(D);
        let count = 0;
        for (let j = 0; j < L; j++) {
          const mask = Number(attention[b * maxLen + j]);
          if (!mask) continue;
          count++;
          const base = (b * L + j) * D;
          for (let d = 0; d < D; d++) vec[d] += Number(data[base + d]);
        }
        let norm = 0;
        for (let d = 0; d < D; d++) {
          vec[d] /= count || 1;
          norm += vec[d] * vec[d];
        }
        norm = Math.sqrt(norm) || 1;
        for (let d = 0; d < D; d++) vec[d] /= norm;
        vecs.push(vec);
      }
      this.docs += B;
      this.totalMs += performance.now() - t0;
    }
    return vecs;
  }

  async encode(text) {
    const [v] = await this.encodeBatch([text]);
    return v;
  }

  get stats() {
    return {
      ready: this.ready,
      mode: this.mode,
      dim: this.dim,
      encoded: this.docs,
      avgMs: this.docs ? +(this.totalMs / this.docs).toFixed(1) : 0,
    };
  }
}

export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export function toBuffer(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function fromBuffer(buf) {
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}
