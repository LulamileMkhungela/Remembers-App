/**
 * First-run bootstrap: index the phone data that ships with the app.
 *
 * Every screenshot goes through real OCR; every note / saved page / message is
 * ingested as-is. Nothing here is hard-coded into the search results - the
 * index is built from the pixels and the text, then persisted to data/.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GALLERY = path.join(ROOT, "samples", "gallery");
const NOTES = path.join(ROOT, "samples", "notes.json");

export function sampleManifest() {
  const manifestPath = path.join(GALLERY, "manifest.json");
  if (!fs.existsSync(manifestPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(manifestPath, "utf8")).items || [];
  } catch {
    return [];
  }
}

export function sampleNotes() {
  if (!fs.existsSync(NOTES)) return [];
  try {
    return JSON.parse(fs.readFileSync(NOTES, "utf8")).items || [];
  } catch {
    return [];
  }
}

export function sampleCount() {
  return sampleManifest().length + sampleNotes().length;
}

/**
 * @param {object} deps { store, ingestor, embedder, ocr }
 * @param {object} opts { onProgress(stage, done, total, label), force }
 */
export async function seedSamples({ store, ingestor, embedder }, { onProgress = () => {}, force = false } = {}) {
  const images = sampleManifest();
  const notes = sampleNotes();
  const total = images.length + notes.length;
  const result = { images: 0, notes: 0, skipped: 0, total, ocrMs: 0, startedAt: Date.now() };

  if (!force && store.size > 0) {
    onProgress("done", total, total, "already indexed");
    return { ...result, alreadyIndexed: true, indexed: store.size };
  }
  if (force) store.clear();

  let done = 0;
  for (const item of images) {
    const file = path.join(GALLERY, item.file);
    if (!fs.existsSync(file)) {
      done++;
      continue;
    }
    try {
      const { doc, skipped } = await ingestor.ingestImage({
        filePath: file,
        meta: { ...item, name: item.file, mimeType: "image/png" },
      });
      if (skipped) result.skipped++;
      else {
        result.images++;
        result.ocrMs += doc.ocr?.ms || 0;
      }
      onProgress("ocr", ++done, total, item.file);
    } catch (err) {
      onProgress("error", ++done, total, `${item.file}: ${err.message}`);
    }
  }

  for (const item of notes) {
    try {
      const { skipped } = await ingestor.ingestText(item);
      if (skipped) result.skipped++;
      else result.notes++;
      onProgress("notes", ++done, total, item.title);
    } catch (err) {
      onProgress("error", ++done, total, `${item.title}: ${err.message}`);
    }
  }

  store.persist();
  const finished = { ...result, indexed: store.size, finishedAt: Date.now(), ms: Date.now() - result.startedAt };
  onProgress("done", total, total, `${store.size} memories indexed`);
  return finished;
}
