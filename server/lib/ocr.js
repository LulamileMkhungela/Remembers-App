/**
 * OCR.
 *
 * Real text recognition (Tesseract LSTM) over every image the phone remembers.
 * The English model ships with the app, so OCR works with no network access.
 */

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { cleanText } from "./text.js";

/** Strip the bullet glyphs Tesseract sometimes reads out of list markers. */
function cleanOcrLine(line) {
  return cleanText(String(line || "").replace(/^[©®•·▪◾◽*|｜~]+\s*/, ""));
}

const require = createRequire(import.meta.url);

export class Ocr {
  constructor({ workers = 2, cachePath = path.join(process.cwd(), "data", "tessdata") } = {}) {
    this.poolSize = workers;
    this.cachePath = cachePath;
    this.workers = [];
    this.busy = [];
    this.queue = [];
    this.ready = false;
    this.stats = { jobs: 0, totalMs: 0, avgConfidence: 0, failures: 0 };
  }

  async init() {
    if (this.ready) return this;
    const { createWorker } = require("tesseract.js");
    let langPath = null;
    let gzip = true;
    try {
      const eng = require("@tesseract.js-data/eng");
      langPath = eng.langPath;
      gzip = eng.gzip;
    } catch {
      // falls back to the bundled CDN path - still works, just needs network once
    }
    fs.mkdirSync(this.cachePath, { recursive: true });
    for (let i = 0; i < this.poolSize; i++) {
      const worker = await createWorker("eng", 1, {
        langPath,
        gzip,
        cachePath: this.cachePath,
        logger: () => {},
        errorHandler: (e) => console.error("[ocr]", e?.message || e),
      });
      this.workers.push(worker);
      this.busy.push(false);
    }
    this.ready = true;
    return this;
  }

  async acquire() {
    const free = this.busy.indexOf(false);
    if (free >= 0) {
      this.busy[free] = true;
      return free;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    return this.acquire();
  }

  release(idx) {
    this.busy[idx] = false;
    const next = this.queue.shift();
    if (next) next();
  }

  /**
   * @param {Buffer|string} image  buffer or file path
   * @returns {Promise<{text, confidence, lines, words, ms}>}
   */
  async recognize(image) {
    if (!this.ready) await this.init();
    const idx = await this.acquire();
    const t0 = performance.now();
    try {
      const { data } = await this.workers[idx].recognize(image, {}, { text: true, blocks: true });
      const cleanedText = String(data.text || "").split("\n").map(cleanOcrLine).join("\n");
      const ms = performance.now() - t0;
      const lines = [];
      const words = [];
      for (const block of data.blocks || []) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            if (line.text && line.text.trim()) {
              lines.push({
                text: cleanOcrLine(line.text),
                confidence: line.confidence,
                bbox: line.bbox,
              });
            }
            for (const w of line.words || []) {
              if (w.text && w.text.trim()) {
                words.push({ text: w.text.trim(), confidence: w.confidence, bbox: w.bbox });
              }
            }
          }
        }
      }
      const good = words.filter((w) => w.confidence >= 55 && /[\w]/.test(w.text));
      const confidence = good.length
        ? good.reduce((s, w) => s + w.confidence, 0) / good.length
        : data.confidence || 0;
      this.stats.jobs++;
      this.stats.totalMs += ms;
      this.stats.avgConfidence =
        (this.stats.avgConfidence * (this.stats.jobs - 1) + confidence) / this.stats.jobs;
      return { text: cleanText(cleanedText), confidence: +confidence.toFixed(1), lines, words, ms: Math.round(ms) };
    } catch (err) {
      this.stats.failures++;
      throw err;
    } finally {
      this.release(idx);
    }
  }

  async terminate() {
    for (const w of this.workers) {
      try {
        await w.terminate();
      } catch {}
    }
    this.workers = [];
    this.busy = [];
    this.ready = false;
  }

  get summary() {
    return {
      ready: this.ready,
      workers: this.poolSize,
      jobs: this.stats.jobs,
      avgMs: this.stats.jobs ? Math.round(this.stats.totalMs / this.stats.jobs) : 0,
      avgConfidence: +this.stats.avgConfidence.toFixed(1),
      failures: this.stats.failures,
    };
  }
}
