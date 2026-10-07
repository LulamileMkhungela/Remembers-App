#!/usr/bin/env node
/**
 * Index real screenshots and photos from a folder on this machine.
 *
 *   npm run ingest -- ~/Pictures/Screenshots
 *   npm run ingest -- ./my-phone-dump --source Camera --location "Johannesburg"
 *
 * Every image is read with Tesseract OCR and embedded with all-MiniLM-L6-v2, so
 * whatever is in the picture becomes searchable by meaning. Nothing leaves the
 * machine and no API keys are involved.
 *
 * The script talks to a running server so the index stays consistent. Start the
 * app first (`npm start`), and this tool will report each file as it is read.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.env.REMEMBERS_URL || "http://localhost:8787";
const IMAGE_RE = /\.(png|jpe?g|webp|bmp|gif)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", ".cache", "Library", "Applications", "AppData"]);

const args = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    const key = args[i].slice(2);
    const value = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "true";
    flags[key] = value;
  } else positional.push(args[i]);
}

const folder = positional[0] || path.join(os.homedir(), "Pictures", "Screenshots");
const limit = flags.limit ? Number(flags.limit) : Infinity;
const batchSize = flags.batch ? Number(flags.batch) : 4;
const source = flags.source || "Imported";

if (!fs.existsSync(folder)) {
  console.error(`\n  Folder not found: ${folder}`);
  console.error("  Point it at where your screenshots live, e.g.");
  console.error("    npm run ingest -- ~/Pictures/Screenshots\n");
  process.exit(1);
}

/* --------------------------------------------------------------- walking --- */

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (IMAGE_RE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const files = walk(folder)
  .map((file) => ({ file, mtime: fs.statSync(file).mtime }))
  .sort((a, b) => b.mtime - a.mtime) // newest first: the memories you want most
  .slice(0, limit === Infinity ? undefined : limit);

if (!files.length) {
  console.error(`\n  No images found under ${folder}\n`);
  process.exit(1);
}

console.log(`\n  ${files.length} image(s) found in ${folder}`);
console.log(`  server: ${BASE}\n`);

try {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  console.log(`  index before: ${health.store.total} memories\n`);
} catch {
  console.error("  The app server is not running.");
  console.error("  Start it with `npm start` in another terminal, then run this again.\n");
  process.exit(1);
}

/* -------------------------------------------------------------- uploading -- */

let created = 0;
let skipped = 0;
let failed = 0;

for (let i = 0; i < files.length; i += batchSize) {
  const batch = files.slice(i, i + batchSize);
  const form = new FormData();
  for (const { file, mtime } of batch) {
    const bytes = fs.readFileSync(file);
    form.append("files", new Blob([bytes]), path.basename(file));
    form.append("capturedAt", new Date(mtime).toISOString()); // last field wins, so set per batch
  }
  form.set("source", source);
  form.set("location", flags.location || "");
  form.set("kind", flags.kind || (/(screen|shot)/i.test(folder) ? "screenshot" : "photo"));

  let payload;
  try {
    const res = await fetch(`${BASE}/api/import/images`, { method: "POST", body: form });
    payload = await res.json();
    if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);
  } catch (err) {
    failed += batch.length;
    console.log(`  ✗ batch failed: ${err.message}`);
    continue;
  }

  for (const item of payload.items || []) {
    const name = item.name.length > 34 ? `${item.name.slice(0, 31)}…` : item.name;
    if (item.status === "created") {
      created++;
      console.log(`  ✓ ${name.padEnd(36)} OCR ${String(item.ocr?.confidence ?? "?").padStart(5)}%  ${(item.keywords || []).slice(0, 3).join(", ")}`);
    } else if (item.status === "skipped") {
      skipped++;
      console.log(`  · ${name.padEnd(36)} already remembered`);
    } else {
      failed++;
      console.log(`  ✗ ${name.padEnd(36)} ${item.error || "could not read"}`);
    }
  }
}

const after = await (await fetch(`${BASE}/api/health`)).json();
console.log(`\n  ${created} indexed, ${skipped} already known, ${failed} failed`);
console.log(`  index now: ${after.store.total} memories`);
console.log(`  open ${BASE} and ask for any of them in your own words.\n`);
process.exit(failed && !created ? 1 : 0);
