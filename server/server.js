/**
 * Remembers App server.
 *
 * Serves the UI and the memory API: real OCR, real on-device embeddings,
 * persistent index. No external services are contacted at runtime.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { Store, DATA_DIR } from "./lib/store.js";
import { Embedder } from "./lib/embed.js";
import { Ocr } from "./lib/ocr.js";
import { Ingestor, embeddingText } from "./lib/ingest.js";
import { route, score, buildAnswer, connect, timeline, toCard } from "./lib/search.js";
import { parseMultipart, readBody } from "./lib/multipart.js";
import { seedSamples, sampleCount } from "./lib/bootstrap.js";
import { cleanText, formatBytes, sentences } from "./lib/text.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";

/* ------------------------------------------------------------------ init --- */

const store = new Store();
const embedder = new Embedder();
const ocr = new Ocr({ workers: Number(process.env.OCR_WORKERS || Math.max(1, Math.min(2, os.cpus().length - 1))) });
const ingestor = new Ingestor({ store, embedder, ocr });

const seedState = { running: false, done: 0, total: sampleCount(), stage: "idle", label: "", finished: null, error: null };

async function ensureSeeded({ force = false } = {}) {
  if (seedState.running) return seedState;
  seedState.running = true;
  seedState.stage = "starting";
  seedState.done = 0;
  seedState.error = null;
  try {
    const summary = await seedSamples({ store, ingestor, embedder }, {
      force,
      onProgress: (stage, done, total, label) => {
        seedState.stage = stage;
        seedState.done = done;
        seedState.total = total;
        seedState.label = label;
      },
    });
    seedState.finished = summary;
    seedState.stage = "done";
  } catch (err) {
    seedState.error = err.message;
    seedState.stage = "error";
    console.error("[seed] failed:", err);
  } finally {
    seedState.running = false;
  }
  return seedState;
}

/* -------------------------------------------------------------- helpers ---- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".map": "application/json",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { "Content-Type": "application/json; charset=utf-8" });
}

function serveStatic(res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  send(res, 200, body, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Cache-Control": ext === ".png" || ext === ".jpg" ? "public, max-age=3600" : "no-cache",
  });
  return true;
}

function docPayload(doc, queryTerms = []) {
  const card = toCard(doc, queryTerms);
  if (queryTerms.length) {
    card.snippet = { ...card.snippet, terms: queryTerms };
    card.sentences = sentences(doc.body || "")
      .filter((line) => line.length > 24 && line.length < 260)
      .slice(0, 6)
      .map((line) => ({
        text: line,
        score: queryTerms.reduce((n, t) => n + (line.toLowerCase().includes(t) ? 1 : 0), 0),
      }));
  }
  return {
    ...card,
    ocrLines: doc.ocrLines || [],
    width: doc.width || null,
    height: doc.height || null,
    entityIndex: doc.entityIndex || [],
    embeddingPreview: store.vectorOf(doc.id) ? Array.from(store.vectorOf(doc.id).slice(0, 12)).map((v) => +v.toFixed(3)) : null,
  };
}

/* ------------------------------------------------------------------ api ---- */

async function handleSearch(payload, res) {
  const query = cleanText(payload.query || "");
  if (!query) return sendJson(res, 400, { error: "query is required" });

  const t0 = performance.now();
  const routed = route(query);
  const tRoute = performance.now();
  const { results, filterNote } = await score(routed, store, embedder, {
    limit: payload.limit || 12,
    filters: { kinds: payload.kinds || [], sources: payload.sources || [] },
  });
  const tScore = performance.now();
  const answer = buildAnswer(routed, results);
  const connections = connect(results.slice(0, 6), store);
  const tl = timeline(results.slice(0, 8));
  const tEnd = performance.now();

  sendJson(res, 200, {
    query,
    routed: {
      intent: routed.intent,
      terms: routed.terms,
      expansions: routed.expansions,
      timeWindow: routed.timeWindow,
      kinds: routed.kinds,
      sources: routed.sources,
      entities: routed.entities.map((e) => ({ type: e.type, label: e.label })),
    },
    answer,
    results: results.map((r) => ({ ...docPayload(r.doc, routed.terms), score: +r.score.toFixed(3), breakdown: r.breakdown, reasons: r.reasons })),
    connections,
    timeline: tl,
    empty: results.length === 0,
    filterNote,
    timings: {
      route: +(tRoute - t0).toFixed(1),
      retrieve: +(tScore - tRoute).toFixed(1),
      compose: +(tEnd - tScore).toFixed(1),
      total: +(tEnd - t0).toFixed(1),
      indexed: store.size,
      embedMode: embedder.mode,
    },
  });
}

async function handleImportText(payload) {
  const body = cleanText(payload.body || payload.text || "");
  if (!body) throw new Error("text is required");
  const item = {
    title: payload.title ? cleanText(payload.title) : cleanText(body.split("\n")[0]).slice(0, 70),
    body,
    kind: payload.kind || "note",
    source: payload.source || "Notes",
    album: payload.album || "Imported",
    location: payload.location || "",
    url: payload.url || "",
    capturedAt: payload.capturedAt || new Date().toISOString(),
    caption: payload.caption || "",
  };
  const { doc, skipped } = await ingestor.ingestText(item);
  if (!skipped) store.persist();
  return { document: docPayload(doc), skipped };
}

async function handleImportImages(files, fields) {
  const created = [];
  const skipped = [];
  const errors = [];
  const items = [];
  for (const file of files) {
    if (!/^image\//.test(file.mimeType) && !/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) {
      errors.push({ name: file.name, error: "not an image" });
      items.push({ name: file.name, status: "error", error: "not an image" });
      continue;
    }
    try {
      const { doc, skipped: dup } = await ingestor.ingestImage({
        buffer: file.data,
        filePath: file.name,
        meta: {
          name: file.name,
          kind: fields.kind || "screenshot",
          source: fields.source || "Imported",
          album: fields.album || "Imported",
          title: fields.title || "",
          caption: fields.caption || "",
          location: fields.location || "",
          capturedAt: fields.capturedAt || new Date().toISOString(),
          mimeType: file.mimeType,
        },
      });
      if (dup) skipped.push(docPayload(doc));
      else created.push(docPayload(doc));
      items.push({
        name: file.name,
        status: dup ? "skipped" : "created",
        title: doc.title,
        docId: doc.id,
        ocr: doc.ocr,
        keywords: (doc.keywords || []).slice(0, 5),
      });
    } catch (err) {
      errors.push({ name: file.name, error: err.message });
      items.push({ name: file.name, status: "error", error: err.message });
    }
  }
  if (created.length) store.persist();
  return { created, skipped, errors, items };
}

/* --------------------------------------------------------------- router ---- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  try {
    if (p === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "remembers-app",
        embedder: embedder.stats,
        ocr: ocr.summary,
        store: store.summary(),
        seed: {
          running: seedState.running,
          stage: seedState.stage,
          done: seedState.done,
          total: seedState.total,
          error: seedState.error,
          failed: seedState.finished?.failed || 0,
          errors: seedState.finished?.errors || [],
        },
        dataDir: DATA_DIR,
        commit: process.env.REMEMBERS_COMMIT || null,
      });
    }

    if (p === "/api/stats") {
      const byKind = {};
      const bySource = {};
      let oldest = null;
      let newest = null;
      const ocrDocs = store.docs.filter((d) => d.textSource === "ocr");
      // OCR quality comes from the indexed documents, not the in-process worker
      // counters - those reset on every restart and made the panel read "—".
      const avgConfidence = ocrDocs.length
        ? ocrDocs.reduce((sum, d) => sum + (d.ocr?.confidence || 0), 0) / ocrDocs.length
        : 0;
      const avgOcrMs = ocrDocs.length
        ? Math.round(ocrDocs.reduce((sum, d) => sum + (d.ocr?.ms || 0), 0) / ocrDocs.length)
        : 0;
      for (const d of store.docs) {
        byKind[d.kind] = (byKind[d.kind] || 0) + 1;
        bySource[d.source] = (bySource[d.source] || 0) + 1;
        if (!oldest || d.capturedAt < oldest) oldest = d.capturedAt;
        if (!newest || d.capturedAt > newest) newest = d.capturedAt;
      }
      return sendJson(res, 200, {
        total: store.size,
        byKind,
        bySource,
        oldest,
        newest,
        ocrDocs: ocrDocs.length,
        providedDocs: store.docs.filter((d) => d.textSource === "provided").length,
        entities: store.docs.reduce((s, d) => s + (d.entities?.length || 0), 0),
        words: store.docs.reduce((s, d) => s + (d.tokens?.length || 0), 0),
        bytes: store.docs.reduce((s, d) => s + (d.size || 0), 0),
        embedder: embedder.stats,
        ocr: { ...ocr.summary, indexed: ocrDocs.length, avgConfidence: +avgConfidence.toFixed(1), avgMs: avgOcrMs },
        seed: { ...seedState, error: seedState.error },
      });
    }

    if (p === "/api/seed" && req.method === "POST") {
      const payload = req.headers["content-type"]?.includes("json") ? JSON.parse((await readBody(req)).toString() || "{}") : {};
      if (!seedState.running) ensureSeeded({ force: Boolean(payload.force) });
      return sendJson(res, 202, { started: true, state: seedState });
    }
    if (p === "/api/seed/status") return sendJson(res, 200, { ...seedState, error: seedState.error });

    if (p === "/api/search") {
      if (req.method === "POST") {
        const body = JSON.parse((await readBody(req)).toString() || "{}");
        return handleSearch(body, res);
      }
      return handleSearch({ query: url.searchParams.get("q") || "", limit: Number(url.searchParams.get("limit") || 12) }, res);
    }

    if (p === "/api/suggestions") {
      const seeds = [
        "What was that website with the cheap flights I found?",
        "What was the name of the person who recommended that mechanic?",
        "How do I fix the E20 error on my washing machine?",
        "What is the wifi password at the guest house?",
        "When is my dentist appointment?",
        "How much did the plumber charge to fix the geyser?",
        "What are my birthday gift ideas for Naledi?",
        "When is load shedding tonight?",
      ];
      return sendJson(res, 200, { suggestions: seeds.slice(0, Math.min(seeds.length, store.size ? 8 : 4)) });
    }

    if (p === "/api/documents") {
      const limit = Math.min(Number(url.searchParams.get("limit") || 60), 200);
      const offset = Number(url.searchParams.get("offset") || 0);
      const sort = url.searchParams.get("sort") || "recent";
      const docs = [...store.docs];
      docs.sort((a, b) => (sort === "recent" ? new Date(b.capturedAt) - new Date(a.capturedAt) : a.title.localeCompare(b.title)));
      return sendJson(res, 200, {
        total: docs.length,
        offset,
        documents: docs.slice(offset, offset + limit).map((d) => docPayload(d)),
      });
    }

    const docMatch = p.match(/^\/api\/documents\/([\w-]+)(?:\/(file|text|related))?$/);
    if (docMatch) {
      const doc = store.byId(docMatch[1]);
      if (!doc) return sendJson(res, 404, { error: "document not found" });
      if (docMatch[2] === "file") {
        if (!doc.filePath || !fs.existsSync(doc.filePath)) return sendJson(res, 404, { error: "no stored file" });
        const body = fs.readFileSync(doc.filePath);
        return send(res, 200, body, { "Content-Type": doc.mimeType || "image/png", "Cache-Control": "public, max-age=86400" });
      }
      if (docMatch[2] === "text") {
        return sendJson(res, 200, { text: doc.body, source: doc.textSource, ocr: doc.ocr, lines: doc.ocrLines || [] });
      }
      if (docMatch[2] === "related") {
        const related = connect([], store).filter((e) => e.from.docId === doc.id || e.to.docId === doc.id);
        return sendJson(res, 200, { edges: related });
      }
      return sendJson(res, 200, { document: docPayload(doc) });
    }

    if (p === "/api/vector" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const text = cleanText(body.text || "");
      if (!text) return sendJson(res, 400, { error: "text is required" });
      const vec = await embedder.encode(text);
      const norms = {
        norm: +Math.sqrt(vec.reduce((s, v) => s + v * v, 0)).toFixed(4),
        head: Array.from(vec.slice(0, 16)).map((v) => +v.toFixed(3)),
      };
      if (body.compareTo) {
        const other = await embedder.encode(cleanText(body.compareTo));
        norms.similarity = +vec.reduce((s, v, i) => s + v * other[i], 0).toFixed(4);
      }
      return sendJson(res, 200, { model: "all-MiniLM-L6-v2", dim: vec.length, embedding: norms, text: embeddingText({ title: "", body: text }) });
    }

    if (p === "/api/ocr" && req.method === "POST") {
      const contentType = req.headers["content-type"] || "";
      let imageBuffer = null;
      if (contentType.includes("multipart/form-data")) {
        const boundary = contentType.split("boundary=")[1];
        const body = await readBody(req);
        const { files } = parseMultipart(body, boundary);
        if (files[0]) imageBuffer = files[0].data;
      } else {
        imageBuffer = await readBody(req);
      }
      if (!imageBuffer?.length) return sendJson(res, 400, { error: "send an image body" });
      const result = await ocr.recognize(imageBuffer);
      return sendJson(res, 200, {
        text: result.text,
        confidence: result.confidence,
        ms: result.ms,
        words: result.words.length,
        preview: result.words.slice(0, 40).map((w) => ({ text: w.text, confidence: Math.round(w.confidence) })),
      });
    }

    if (p === "/api/import/text" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const out = await handleImportText(body);
      return sendJson(res, 201, out);
    }

    if (p === "/api/import/images" && req.method === "POST") {
      const contentType = req.headers["content-type"] || "";
      if (!contentType.includes("multipart/form-data")) return sendJson(res, 400, { error: "multipart/form-data required" });
      const boundary = contentType.split("boundary=")[1];
      const body = await readBody(req);
      const { fields, files } = parseMultipart(body, boundary);
      if (!files.length) return sendJson(res, 400, { error: "no files in the request" });
      const out = await handleImportImages(files, fields);
      return sendJson(res, 201, { ...out, counts: { created: out.created.length, skipped: out.skipped.length, errors: out.errors.length } });
    }

    if (p === "/api/connections") {
      const docId = url.searchParams.get("docId");
      const source = docId ? [{ doc: store.byId(docId), score: 1 }].filter((r) => r.doc) : [];
      const edges = docId
        ? connect([], store).filter((e) => e.from.docId === docId || e.to.docId === docId)
        : connect(source, store);
      const nodes = new Map();
      for (const e of edges) {
        for (const side of [e.from, e.to]) {
          if (!nodes.has(side.docId)) nodes.set(side.docId, { ...side });
        }
      }
      return sendJson(res, 200, { edges, nodes: [...nodes.values()] });
    }

    if (p === "/api/reset" && req.method === "POST") {
      await ocr.terminate();
      store.clear();
      seedState.finished = null;
      seedState.stage = "idle";
      return sendJson(res, 200, { cleared: true, total: store.size });
    }

    if (p.startsWith("/assets/gallery/")) {
      const file = path.join(ROOT, "samples", "gallery", path.basename(p));
      if (serveStatic(res, file)) return;
      return sendJson(res, 404, { error: "not found" });
    }

    // static UI
    if (p === "/" || p === "/index.html") {
      if (serveStatic(res, path.join(PUBLIC, "index.html"))) return;
    }
    const staticPath = path.join(PUBLIC, path.normalize(p).replace(/^([.]{2}[\/\\])+/, ""));
    if (staticPath.startsWith(PUBLIC) && serveStatic(res, staticPath)) return;

    return sendJson(res, 404, { error: "not found", path: p });
  } catch (err) {
    console.error("[server]", err);
    return sendJson(res, 500, { error: err.message });
  }
});

/* --------------------------------------------------------------- launch --- */

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Remembers App  —  your phone, searchable by meaning`);
  console.log(`  ${url}`);
  console.log(`  data: ${DATA_DIR}   embedder: lazy   ocr workers: ${ocr.poolSize}`);
  if (store.size === 0 && process.env.REMEMBERS_NO_SEED !== "1") {
    console.log(`  seeding ${sampleCount()} sample memories (real OCR)…`);
    ensureSeeded().then((s) => {
      if (s.error) console.log(`  seed failed: ${s.error}`);
      else console.log(`  indexed ${store.size} memories in ${((s.finished?.ms || 0) / 1000).toFixed(1)}s`);
    });
  } else if (store.size > 0) {
    console.log(`  loaded ${store.size} memories from ${path.relative(ROOT, DATA_DIR)} (${formatBytes(store.docs.reduce((s, d) => s + (d.size || 0), 0))} of source data)`);
    embedder.init()
      .then(() => console.log(`  embedding model ready (${embedder.mode}, ${embedder.dim}-d)`))
      .catch((e) => console.error(`  embedding model failed: ${e.message}`));
  }
});

process.on("SIGINT", async () => {
  console.log("\n  saving index…");
  try {
    store.persist();
    await ocr.terminate();
  } catch {}
  process.exit(0);
});
