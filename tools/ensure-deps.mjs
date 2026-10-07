#!/usr/bin/env node
/**
 * Dependency guard.
 *
 * The sandbox/CI snapshot does not keep node_modules, so `npm start` runs this
 * first: it checks the four packages the pipeline cannot work without and
 * installs them once if any are missing. If the install cannot run (no network),
 * it says exactly what is missing instead of letting OCR fail quietly later.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED = [
  ["onnxruntime-node", "runs the embedding model"],
  ["tesseract.js", "reads text out of images"],
  ["@ryanstark24/sfgraph-models", "ships the MiniLM weights"],
  ["@tesseract.js-data/eng", "ships the English OCR model"],
];

const missing = REQUIRED.filter(([pkg]) => !fs.existsSync(path.join(ROOT, "node_modules", pkg)));

if (!missing.length) process.exit(0);

console.log(`\n  ${missing.length} package(s) missing from node_modules:`);
for (const [pkg, why] of missing) console.log(`    · ${pkg} — ${why}`);
console.log("  running `npm install`…\n");

const install = spawnSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: ROOT, stdio: "inherit" });
if (install.status !== 0) {
  console.error("\n  npm install failed. Without it the app cannot run OCR or embed text.");
  console.error("  Run `npm install` manually (needs network access), then start again.\n");
  process.exit(1);
}
console.log("");
