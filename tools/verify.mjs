#!/usr/bin/env node
/**
 * Environment check: proves the on-device stack actually works on this machine.
 *
 *   npm run verify
 *
 * Checks the embedding model, the tokenizer, similarity behaviour and OCR, then
 * reports what the sample phone data contains. No server required.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Embedder } from "../server/lib/embed.js";
import { Ocr } from "../server/lib/ocr.js";
import { sampleManifest, sampleNotes } from "../server/lib/bootstrap.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const results = [];
const line = (label, ok, detail = "") => {
  results.push(ok);
  console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};

console.log("\nRemembers App — environment check\n");

// 1. node + deps
const [major] = process.versions.node.split(".").map(Number);
line(`Node ${process.versions.node}`, major >= 18, major >= 18 ? "" : "Node 18 or newer is required");

// 2. model weights
const embedder = new Embedder();
const modelDir = embedder.findModelDir();
line("all-MiniLM-L6-v2 weights present", Boolean(modelDir), modelDir || "run `npm install`");
if (!modelDir) process.exit(1);

// 3. real embeddings
const t0 = performance.now();
await embedder.init();
line("ONNX session created", embedder.ready, `${embedder.mode} in ${(performance.now() - t0).toFixed(0)} ms`);

const [a, b, c] = await embedder.encodeBatch([
  "cheap flights to Cape Town",
  "the airline fare for a return trip to CPT",
  "the plumber fixed the geyser and charged R1 850",
]);
const cos = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
const related = cos(a, b);
const unrelated = cos(a, c);
line("384-dimensional vectors", a.length === 384, `${embedder.dim} dims`);
line(
  "meaning is captured (related > unrelated)",
  related > unrelated + 0.1,
  `related ${related.toFixed(3)} vs unrelated ${unrelated.toFixed(3)}`
);
line("speed", true, `${embedder.stats.avgMs} ms per embedding on this CPU`);

// 4. OCR over a real sample screenshot
const images = sampleManifest();
const notes = sampleNotes();
if (images.length) {
  const ocr = new Ocr({ workers: 1 });
  const file = path.join(ROOT, "samples", "gallery", images[0].file);
  const out = await ocr.recognize(file);
  line(
    `OCR reads ${images[0].file}`,
    out.text.length > 20,
    `${out.confidence}% confidence, ${out.words.length} words in ${out.ms} ms`
  );
  line("OCR returns line boxes for highlighting", out.lines.some((l) => l.bbox), `${out.lines.length} lines`);
  await ocr.terminate();
}

// 5. sample data
line("sample screenshots on disk", images.length > 0, `${images.length} images in samples/gallery`);
line("sample notes / messages / pages", notes.length > 0, `${notes.length} text memories in samples/notes.json`);
const indexed = fs.existsSync(path.join(ROOT, "data", "store.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "data", "store.json"), "utf8")).documents?.length || 0
  : 0;
line("persistent index", true, indexed ? `${indexed} memories already indexed in data/` : "will be built on first run");

const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} check(s) failed.\n` : "\nEverything works. Start the app with `npm start`.\n");
process.exit(failed ? 1 : 0);
