/* Remembers App - UI.
   Talks to the local server: real OCR, real on-device embeddings. */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const state = {
  query: "",
  last: null,
  kind: "",
  busy: false,
  documents: [],
  stats: null,
  searchable: true,
  drawer: { doc: null, tab: "image", boxes: true },
};

/* --------------------------------------------------------------- helpers --- */

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function relativeDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function absoluteDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso || "";
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function highlightSnippet(snippet) {
  if (!snippet) return "";
  const { text, ranges } = snippet;
  if (!ranges || !ranges.length) return esc(text);
  let out = "";
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    out += esc(text.slice(cursor, start));
    out += `<mark>${esc(text.slice(start, end))}</mark>`;
    cursor = end;
  }
  out += esc(text.slice(cursor));
  return out;
}

const KIND_GLYPH = { photo: "▣", screenshot: "▤", note: "✎", page: "❐", message: "✉", email: "✉" };

/* ------------------------------------------------------------ status loop --- */

async function refreshStatus() {
  try {
    const health = await api("/api/health");
    const embed = health.embedder || {};
    const embedLabel = $("#embedLabel");
    const embedDot = $("#embedDot");
    if (embed.ready) {
      embedLabel.textContent = `MiniLM-L6 · 384-d · ${embed.avgMs || 0} ms/embed`;
      embedDot.className = "dot dot-good";
    } else {
      embedLabel.textContent = "loading model…";
      embedDot.className = "dot dot-live";
    }
    const seed = health.seed || {};
    const indexDot = $("#indexDot");
    const indexLabel = $("#indexLabel");
    if (seed.running) {
      indexLabel.textContent = `indexing ${seed.done}/${seed.total}`;
      indexDot.className = "dot dot-live";
    } else {
      indexLabel.textContent = `${health.store.total} memories in index`;
      indexDot.className = "dot dot-good";
    }
    showIndexWarning(health);
    await refreshStats();
    return !seed.running;
  } catch (err) {
    $("#indexLabel").textContent = "server unavailable";
    $("#indexDot").className = "dot dot-warn";
    return true;
  }
}

/* If nothing could be read, say why - a silent empty index looks like a broken app. */
function showIndexWarning(health) {
  const seed = health.seed || {};
  const failures = (seed.failed || 0) + (seed.errors?.length ? 0 : 0);
  const banner = $("#indexWarning");
  const total = health.store?.total || 0;
  const detail = seed.error || seed.errors?.[0] || "";

  if (!seed.running && total === 0 && (failures > 0 || detail)) {
    banner.hidden = false;
    banner.innerHTML = `<b>Nothing could be indexed.</b> ${esc(
      detail || "OCR or the embedding model failed to start."
    )} — run <span class="mono">npm install</span> then reload, or check the server log.`;
    return;
  }
  if (!seed.running && failures > 0) {
    banner.hidden = false;
    banner.innerHTML = `<b>${failures} item(s) could not be read.</b> ${esc(detail)}`;
    return;
  }
  banner.hidden = true;
}

async function refreshStats() {
  const stats = await api("/api/stats");
  state.stats = stats;
  const grid = $("#statsGrid");
  const stats_rows = [
    ["Memories", stats.total, `${Object.keys(stats.byKind).length} kinds · ${Object.keys(stats.bySource).length} sources`],
    ["Read by OCR", stats.ocrDocs, stats.ocr.avgConfidence ? `${stats.ocr.avgConfidence}% avg confidence` : "—"],
    ["Words indexed", stats.words.toLocaleString("en-ZA"), `${stats.entities} connected details`],
    ["Source data", formatBytes(stats.bytes), stats.oldest ? `since ${absoluteDate(stats.oldest)}` : ""],
  ];
  grid.innerHTML = stats_rows
    .map(
      ([label, value, sub]) => `<div class="stat"><span>${esc(label)}</span><b>${esc(formatNum(value))}</b><small>${esc(sub)}</small></div>`
    )
    .join("");
  $("#footerStats").textContent =
    `${stats.total} memories · ${stats.ocr.jobs} images through OCR (${stats.ocr.avgMs} ms avg) · ` +
    `embeddings ${stats.embedder.mode || "loading"} · ${stats.embedder.encoded || 0} vectors`;
  $("#deviceBadge").textContent = stats.embedder.ready ? "models loaded" : "loading";
  $("#galleryBadge").textContent = `${stats.total} items`;
}

function formatNum(v) {
  if (typeof v === "number") return v.toLocaleString("en-ZA");
  return v;
}

function formatBytes(b) {
  if (!b) return "0 KB";
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

/* ---------------------------------------------------------------- gallery --- */

async function loadGallery({ seedResults = false } = {}) {
  const { documents } = await api("/api/documents?limit=90&sort=recent");
  state.documents = documents;
  if (seedResults && !state.last) renderRecent(documents);
  const gallery = $("#gallery");
  if (!documents.length) {
    gallery.innerHTML = `<p class="muted">Indexed screenshots, photos, notes and pages appear here.</p>`;
    return;
  }
  gallery.innerHTML = "";
  for (const doc of documents) {
    const item = el("div", "gallery-item");
    item.title = `${doc.title} — ${doc.source} (${absoluteDate(doc.capturedAt)})`;
    if (doc.fileUrl) {
      item.innerHTML = `<img src="${doc.fileUrl}" alt="${esc(doc.title)}" loading="lazy" />
        <span class="g-tag">${esc(doc.title.slice(0, 34))}</span>`;
    } else {
      item.innerHTML = `<div class="g-glyph">${KIND_GLYPH[doc.kind] || "✎"}</div>
        <span class="g-tag">${esc(doc.title.slice(0, 34))}</span>`;
    }
    item.addEventListener("click", () => openDrawer(doc.id));
    gallery.appendChild(item);
  }
}

/* ----------------------------------------------------------- suggestions --- */

async function loadSuggestions() {
  const { suggestions } = await api("/api/suggestions");
  const row = $("#suggestions");
  row.innerHTML = "";
  for (const q of suggestions) {
    const chip = el("button", "chip", esc(q));
    chip.type = "button";
    chip.addEventListener("click", () => {
      $("#query").value = q;
      runSearch(q);
    });
    row.appendChild(chip);
  }
}

/* ----------------------------------------------------------------- search --- */

function setPipeline(active) {
  const pipeline = $("#pipeline");
  if (!active) {
    pipeline.hidden = true;
    return;
  }
  pipeline.hidden = false;
  const steps = [...pipeline.querySelectorAll(".pipeline-step")];
  for (const s of steps) s.className = "pipeline-step";
}

function advancePipeline(step) {
  const pipeline = $("#pipeline");
  const steps = [...pipeline.querySelectorAll(".pipeline-step")];
  const order = ["route", "embed", "retrieve", "compose"];
  const idx = order.indexOf(step);
  steps.forEach((s, i) => {
    if (i < idx) s.className = "pipeline-step is-done";
    else if (i === idx) s.className = "pipeline-step is-active";
  });
}

async function runSearch(query, { keepPipeline = false } = {}) {
  const q = (query ?? $("#query").value ?? "").trim();
  state.query = q;
  if (!q || state.busy) return;
  state.busy = true;
  $("#searchBtn").disabled = true;
  setPipeline(true);
  advancePipeline("route");
  renderSearching();

  try {
    const payload = { query: q, limit: 12, kinds: state.kind ? [state.kind] : [] };
    const timer1 = setTimeout(() => advancePipeline("embed"), 60);
    const timer2 = setTimeout(() => advancePipeline("retrieve"), 220);
    const timer3 = setTimeout(() => advancePipeline("compose"), 520);
    const data = await api("/api/search", { method: "POST", body: JSON.stringify(payload) });
    clearTimeout(timer1);
    clearTimeout(timer2);
    clearTimeout(timer3);
    state.last = data;
    advancePipeline("compose");
    renderAnswer(data);
    renderResults(data);
    renderConnections(data);
    renderTimeline(data);
    setTimeout(() => setPipeline(false), 500);
  } catch (err) {
    $("#resultsBody").innerHTML = `<div class="empty-state"><p class="muted">Search failed: ${esc(err.message)}</p></div>`;
    $("#answerBody").innerHTML = `<p class="muted">${esc(err.message)}</p>`;
    setPipeline(false);
  } finally {
    state.busy = false;
    $("#searchBtn").disabled = false;
  }
}

function renderSearching() {
  $("#answerBody").innerHTML = `
    <div class="skeleton" style="height:26px;width:60%"></div>
    <div class="skeleton" style="height:52px"></div>
    <div class="skeleton" style="height:52px"></div>`;
  $("#resultsBody").innerHTML = `<div class="result-list">
    <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`;
  $("#answerBadge").textContent = "thinking…";
}

/* ---------------------------------------------------------------- render --- */

function renderAnswer(data) {
  const body = $("#answerBody");
  const a = data.answer;
  $("#answerBadge").className = "badge " + (data.empty ? "badge-warn" : "badge-accent");
  $("#answerBadge").textContent = data.empty
    ? "no match"
    : `answer · ${(data.timings.total / 1000).toFixed(2)}s · ${data.timings.indexed} memories searched`;

  if (data.empty) {
    body.innerHTML = `
      <div class="answer-headline">${esc(a.headline)}</div>
      <p class="muted small">${esc((a.notes || [])[0] || "")}</p>
      <div class="chip-row">${(a.followUps || []).map((f, i) => `<button class="chip" data-follow="${i}" type="button">${esc(f)}</button>`).join("")}</div>`;
    bindFollowUps(body);
    return;
  }

  const facts = [];
  const top = data.results[0];
  if (top) {
    const pick = (type) => (top.entities || []).find((e) => e.type === type);
    const phone = pick("phone");
    const money = pick("money");
    const date = pick("date");
    const site = pick("website");
    if (phone) facts.push(["Number", phone.label]);
    if (money) facts.push(["Amount", money.label]);
    if (site) facts.push(["Website", site.label]);
    if (date) facts.push(["Date", date.label]);
    if (top.location) facts.push(["Place", top.location]);
  }

  body.innerHTML = `
    <div class="answer-headline">${esc(a.headline)}</div>
    <div class="answer-sub">${esc(data.routed.intent === "question" ? "Read your question as a question, then looked for the memory behind it." : "Matched against everything your phone remembers.")}</div>
    ${facts.length ? `<div class="fact-row">${facts.slice(0, 4).map(([k, v]) => `<div class="fact"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join("")}</div>` : ""}
    <ul class="answer-list">
      ${a.bullets.map((b) => `<li>${esc(b.text)}<span class="answer-cite">in <b>${esc(b.docTitle)}</b> — ${esc(b.why)}</span></li>`).join("")}
    </ul>
    <div class="confidence-bar">
      <span>confidence ${(a.confidence * 100).toFixed(0)}%</span>
      <span class="meter"><i style="width:${Math.round(a.confidence * 100)}%"></i></span>
      <span>${esc((a.notes || [])[0] || "")}</span>
    </div>
    <div class="chip-row">
      ${(a.entityTrail || []).slice(0, 4).map((t) => `<span class="chip chip-static chip-entity">${esc(t)}</span>`).join("")}
      ${(a.followUps || []).map((f, i) => `<button class="chip chip-strong" data-follow="${i}" type="button">${esc(f)}</button>`).join("")}
    </div>`;
  bindFollowUps(body);
}

function bindFollowUps(scope) {
  scope.querySelectorAll("[data-follow]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.textContent.trim();
      $("#query").value = text;
      runSearch(text);
    });
  });
}

function scoreBars(breakdown) {
  if (!breakdown) return "";
  return ["semantic", "keyword", "coverage", "entity", "phrase"]
    .map((key) => {
      const v = Math.max(0.08, Math.min(1, Number(breakdown[key]) || 0));
      return `<i style="height:${Math.round(v * 11)}px" title="${key}: ${breakdown[key]}"></i>`;
    })
    .join("");
}

function resultCard(doc, { score, breakdown, reasons = [], snippet, queryTerms = [] } = {}) {
  const card = el("article", "result");
  const chips = [
    ...reasons.map((x) => `<span class="result-chip evidence">${esc(x)}</span>`),
    ...(doc.entities || []).slice(0, 3).map((e) => `<span class="result-chip">${esc(e.type)}: ${esc(e.label)}</span>`),
  ].join("");
  const snip = snippet || doc.snippet;
  card.innerHTML = `
    <div class="result-thumb">
      ${doc.fileUrl ? `<img src="${doc.fileUrl}" alt="" loading="lazy" />` : `<span class="glyph">${KIND_GLYPH[doc.kind] || "✎"}</span>`}
    </div>
    <div class="result-main">
      <div class="result-top">
        <span class="result-title">${esc(doc.title)}</span>
        <span class="result-right">
          ${breakdown ? `<span class="result-bars">${scoreBars(breakdown)}</span>` : ""}
          ${score !== undefined ? `<span class="result-score">${(score * 100).toFixed(0)}% match</span>` : ""}
        </span>
      </div>
      <div class="result-meta">
        <span class="badge badge-soft">${esc(doc.source)}</span>
        <span>${esc(doc.kind)}</span>
        <span>·</span>
        <span>${esc(absoluteDate(doc.capturedAt))} (${esc(relativeDate(doc.capturedAt))})</span>
        ${doc.location ? `<span>·</span><span>${esc(doc.location)}</span>` : ""}
        ${doc.textSource === "ocr" ? `<span>·</span><span title="Text read from the image">OCR ${doc.ocr?.confidence ?? "–"}%</span>` : ""}
      </div>
      <div class="result-snippet">${highlightSnippet(snip)}</div>
      ${chips ? `<div class="result-chips">${chips}</div>` : ""}
    </div>`;
  card.addEventListener("click", () => openDrawer(doc.id, reasons));
  return card;
}

function renderResults(data) {
  const body = $("#resultsBody");
  const results = data.results;
  $("#resultsBadge").textContent = `${results.length} of ${data.timings.indexed} · ${data.timings.retrieve}ms`;
  if (!results.length) {
    body.innerHTML = `<div class="empty-state"><p class="muted">Nothing matched. ${esc(data.filterNote || "")}</p></div>`;
    return;
  }
  const list = el("div", "result-list");
  for (const r of results) {
    list.appendChild(resultCard(r, { score: r.score, breakdown: r.breakdown, reasons: r.reasons }));
  }
  body.innerHTML = "";
  body.appendChild(list);
  if (data.filterNote) body.insertAdjacentHTML("beforeend", `<p class="muted small">${esc(data.filterNote)}</p>`);
}

/* Before the first question the panel shows what the phone holds, so the page is
   never a blank slate - every card is ready to open. */
function renderRecent(documents) {
  const body = $("#resultsBody");
  const recent = documents.slice(0, 6);
  $("#resultsBadge").textContent = `${documents.length} in the index`;
  if (!recent.length) return;
  const list = el("div", "result-list");
  for (const doc of recent) list.appendChild(resultCard(doc, {}));
  body.innerHTML = `<p class="muted small">Recently remembered — ask a question above to search all of it by meaning.</p>`;
  body.appendChild(list);
}

function renderConnections(data) {
  const body = $("#connectionsBody");
  const edges = data.connections || [];
  $("#connectionsBadge").textContent = edges.length ? `${edges.length} links` : "no links yet";
  if (!edges.length) {
    body.innerHTML = `<p class="muted">No shared phone numbers, names or sites across these memories yet.</p>`;
    return;
  }
  body.innerHTML = edges
    .slice(0, 5)
    .map(
      (e) => `
      <div class="edge">
        <div class="edge-label">🔗 ${esc(e.label)}</div>
        <div class="edge-flow">
          <div class="edge-node"><b>${esc(e.from.title)}</b><span>${esc(e.from.source)} · ${esc(absoluteDate(e.from.capturedAt))}</span></div>
          <div class="edge-arrow">→</div>
          <div class="edge-node"><b>${esc(e.to.title)}</b><span>${esc(e.to.source)} · ${esc(absoluteDate(e.to.capturedAt))}</span></div>
        </div>
      </div>`
    )
    .join("");
}

function renderTimeline(data) {
  const body = $("#timelineBody");
  const items = data.timeline || [];
  $("#timelineBadge").textContent = items.length ? `${items.length} points` : "timeline";
  if (!items.length) {
    body.innerHTML = `<p class="muted">Matches in the order your phone lived through them.</p>`;
    return;
  }
  body.innerHTML = `<div class="timeline">${items
    .map(
      (t) => `
      <div class="timeline-item">
        <div class="timeline-date">${esc(absoluteDate(t.capturedAt))}</div>
        <div class="timeline-rail"><span class="timeline-dot"></span></div>
        <div class="timeline-body">
          <b>${esc(t.title)}</b>
          <span>${esc(t.source)} · ${esc(t.kind)}${t.location ? " · " + esc(t.location) : ""}</span>
        </div>
      </div>`
    )
    .join("")}</div>`;
  body.querySelectorAll(".timeline-item").forEach((node, i) => {
    node.style.cursor = "pointer";
    node.addEventListener("click", () => openDrawer(items[i].docId));
  });
}

/* ----------------------------------------------------------------- drawer --- */

async function openDrawer(docId, reasons = []) {
  $("#importDrawer").hidden = true;
  let doc = state.documents.find((d) => d.id === docId);
  try {
    const fresh = await api(`/api/documents/${docId}`);
    doc = fresh.document;
  } catch {
    /* fall back to the cached card */
  }
  if (!doc) return;
  state.drawer.doc = doc;
  state.drawer.tab = doc.fileUrl ? "image" : "text";
  $("#drawerTitle").textContent = doc.title;
  $("#drawerMeta").textContent = `${doc.source} · ${doc.kind} · ${absoluteDate(doc.capturedAt)}`;
  $("#drawer").hidden = false;
  syncScrim();
  document.querySelectorAll("#drawer .tab").forEach((t) => t.classList.toggle("is-active", t.getAttribute("data-tab") === state.drawer.tab));
  renderDrawer(reasons);
}

function closeDrawer() {
  $("#drawer").hidden = true;
  syncScrim();
}

function syncScrim() {
  const anyOpen = !$("#drawer").hidden || !$("#importDrawer").hidden;
  $("#scrim").hidden = !anyOpen;
  document.body.classList.toggle("is-locked", anyOpen);
}

async function renderDrawer(reasons = []) {
  const doc = state.drawer.doc;
  if (!doc) return;
  const body = $("#drawerBody");
  const tab = state.drawer.tab;
  const terms = (state.last?.routed?.terms || []).filter((t) => t.length > 2);

  if (tab === "image") {
    if (!doc.fileUrl) {
      body.innerHTML = `<p class="muted">This memory is text — it was typed or saved, not read from an image.</p>`;
      return;
    }
    body.innerHTML = `
      <div class="viewer-tools">
        <label class="chip chip-static"><input type="checkbox" id="boxToggle" ${state.drawer.boxes ? "checked" : ""} /> show OCR boxes</label>
        <span>${doc.ocrLines?.length || 0} text lines read from this image${doc.ocr ? ` · OCR confidence ${doc.ocr.confidence}% · ${doc.ocr.ms} ms` : ""}</span>
      </div>
      <div class="viewer"><div class="viewer-frame">
        <img id="viewerImg" src="${doc.fileUrl}" alt="${esc(doc.title)}" />
        <div id="ocrLayer" style="position:absolute;inset:0"></div>
      </div></div>
      <div class="text-block" style="max-height:26vh">${esc(doc.body || "")}</div>`;
    const img = $("#viewerImg");
    const draw = () => {
      const layer = $("#ocrLayer");
      if (!layer) return;
      const natW = img.naturalWidth || 1;
      const natH = img.naturalHeight || 1;
      const show = $("#boxToggle")?.checked;
      layer.innerHTML = show
        ? (doc.ocrLines || [])
            .filter((l) => l.b)
            .map(
              (l) =>
                `<span class="ocr-box" title="${esc(l.t)} (${l.c}%)" style="left:${(l.b[0] / natW) * 100}%;top:${(l.b[1] / natH) * 100}%;width:${((l.b[2] - l.b[0]) / natW) * 100}%;height:${((l.b[3] - l.b[1]) / natH) * 100}%"></span>`
            )
            .join("")
        : "";
    };
    if (img.complete) draw();
    else img.addEventListener("load", draw);
    $("#boxToggle")?.addEventListener("change", (e) => {
      state.drawer.boxes = e.target.checked;
      draw();
    });
    return;
  }

  if (tab === "text") {
    body.innerHTML = `
      <span class="section-title">${doc.textSource === "ocr" ? "Read from the image with OCR" : "Text saved with this memory"}</span>
      <div class="text-block" id="docText">${esc(doc.body || "(no text)")}</div>
      <div class="chip-row">${(doc.keywords || []).map((k) => `<span class="chip chip-static">${esc(k)}</span>`).join("")}</div>`;
    if (terms.length) highlightTerms($("#docText"), terms);
    return;
  }

  if (tab === "analysis") {
    const b = state.last?.results?.find((r) => r.id === doc.id)?.breakdown || null;
    const bars = b
      ? Object.entries(b)
          .map(
            ([k, v]) => `
        <div class="bar-row">
          <span>${esc(k)}</span>
          <span class="bar-track"><i style="width:${Math.min(100, Math.round((Number(v) || 0) * 100))}%"></i></span>
          <span class="bar-val">${esc(String(v))}</span>
        </div>`
          )
          .join("")
      : `<p class="muted small">Run a search first to see how this memory scored on that question.</p>`;

    const emb = doc.embeddingPreview || [];
    body.innerHTML = `
      <span class="section-title">Details</span>
      <dl class="kv">
        <dt>Kind</dt><dd>${esc(doc.kind)} · ${esc(doc.source)}</dd>
        <dt>Captured</dt><dd>${esc(absoluteDate(doc.capturedAt))} (${esc(relativeDate(doc.capturedAt))})</dd>
        ${doc.location ? `<dt>Location</dt><dd>${esc(doc.location)}</dd>` : ""}
        ${doc.url ? `<dt>Source url</dt><dd class="mono">${esc(doc.url)}</dd>` : ""}
        <dt>Text origin</dt><dd>${doc.textSource === "ocr" ? `OCR (${doc.ocr?.confidence ?? "–"}% confidence, ${doc.ocr?.ms ?? "–"} ms, ${doc.ocrLines?.length || 0} lines)` : "typed / pasted"}</dd>
        <dt>Indexed</dt><dd>${esc(relativeDate(doc.ingestedAt))}</dd>
        <dt>Embedding</dt><dd class="mono">384-d MiniLM · [${emb.slice(0, 6).map((v) => v.toFixed(2)).join(", ")}, …]</dd>
      </dl>
      ${reasons.length ? `<span class="section-title">Why it matched</span><div class="chip-row">${reasons.map((r) => `<span class="chip chip-strong chip-static">${esc(r)}</span>`).join("")}</div>` : ""}
      <span class="section-title">Score breakdown</span>
      <div class="bars">${bars}</div>
      <span class="section-title">Details the app connected</span>
      <div class="chip-row">${(doc.entities || []).map((e) => `<span class="chip chip-static chip-entity">${esc(e.type)}: ${esc(e.label)}</span>`).join("") || '<span class="muted small">none found</span>'}</div>`;
    return;
  }

  // related
  body.innerHTML = `<p class="muted small">Loading connections…</p>`;
  try {
    const { edges } = await api(`/api/documents/${doc.id}/related`);
    body.innerHTML = edges.length
      ? edges
          .map(
            (e) => `
        <div class="edge">
          <div class="edge-label">🔗 ${esc(e.label)}</div>
          <div class="edge-flow">
            <div class="edge-node"><b>${esc(e.from.title)}</b><span>${esc(e.from.source)} · ${esc(absoluteDate(e.from.capturedAt))}</span></div>
            <div class="edge-arrow">→</div>
            <div class="edge-node"><b>${esc(e.to.title)}</b><span>${esc(e.to.source)} · ${esc(absoluteDate(e.to.capturedAt))}</span></div>
          </div>
        </div>`
          )
          .join("")
      : `<p class="muted">This memory does not share a phone number, name or site with anything else yet.</p>`;
    edges.forEach((edge, i) => {
      const node = body.querySelectorAll(".edge")[i];
      if (!node) return;
      node.style.cursor = "pointer";
      node.addEventListener("click", () => {
        const otherId = edge.from.docId === doc.id ? edge.to.docId : edge.from.docId;
        if (otherId && otherId !== doc.id) openDrawer(otherId);
      });
    });
  } catch (err) {
    body.innerHTML = `<p class="muted">Could not load connections: ${esc(err.message)}</p>`;
  }
}

function highlightTerms(node, terms) {
  const html = node.innerHTML;
  let out = html;
  for (const term of terms.slice(0, 8)) {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    out = out.replace(re, "<mark>$1</mark>");
  }
  node.innerHTML = out;
}

/* ----------------------------------------------------------------- import --- */

function openImport() {
  $("#drawer").hidden = true;
  $("#importDrawer").hidden = false;
  syncScrim();
}

function closeImport() {
  $("#importDrawer").hidden = true;
  syncScrim();
}

function progressRow(name) {
  const row = el("div", "progress-row");
  row.innerHTML = `<b>${esc(name)}</b><span class="status">queued</span>`;
  $("#uploadProgress").appendChild(row);
  return row;
}

async function uploadFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith("image/"));
  if (!list.length) return;
  const form = new FormData();
  for (const f of list) form.append("files", f, f.name);
  form.append("source", $("#uploadSource").value || "Camera");
  form.append("location", $("#uploadLocation").value || "");
  const rows = new Map();
  for (const f of list) {
    const row = progressRow(f.name);
    row.querySelector(".status").textContent = "reading with OCR…";
    rows.set(f.name, row);
  }
  try {
    const res = await api("/api/import/images", { method: "POST", body: form });
    for (const item of res.items || []) {
      const row = rows.get(item.name);
      if (!row) continue;
      if (item.status === "created") {
        row.className = "progress-row is-ok";
        row.querySelector(".status").textContent = `indexed · OCR ${item.ocr?.confidence ?? "?"}% · ${(item.keywords || []).slice(0, 2).join(", ")}`;
      } else if (item.status === "skipped") {
        row.className = "progress-row is-ok";
        row.querySelector(".status").textContent = "already remembered";
      } else {
        row.className = "progress-row is-err";
        row.querySelector(".status").textContent = item.error || "could not read";
      }
    }
    $("#importStatus").textContent = `${res.counts.created} image(s) indexed, ${res.counts.skipped} already known, ${res.counts.errors} failed.`;
    await refreshStats();
    await loadGallery({ seedResults: true });
    await loadSuggestions();
  } catch (err) {
    rows.forEach((row) => {
      row.className = "progress-row is-err";
      row.querySelector(".status").textContent = err.message;
    });
  }
}

async function saveNote() {
  const body = $("#noteBody").value.trim();
  if (!body) {
    $("#importStatus").textContent = "Type or paste something to index first.";
    return;
  }
  $("#importStatus").textContent = "embedding on-device…";
  try {
    const res = await api("/api/import/text", {
      method: "POST",
      body: JSON.stringify({
        title: $("#noteTitle").value || undefined,
        body,
        kind: $("#noteKind").value,
        source: $("#noteSource").value || "Notes",
        location: "",
      }),
    });
    $("#importStatus").textContent = res.skipped ? "That memory was already in the index." : `Indexed “${res.document.title}” — ${res.document.keywords.slice(0, 4).join(", ")}`;
    $("#noteBody").value = "";
    $("#noteTitle").value = "";
    await refreshStats();
    await loadGallery({ seedResults: true });
    if (state.query) runSearch(state.query);
  } catch (err) {
    $("#importStatus").textContent = `Failed: ${err.message}`;
  }
}

async function rebuildIndex() {
  if (!confirm("Clear the index and re-run OCR over the sample phone data? Imported items will be removed.")) return;
  $("#importStatus").textContent = "clearing index…";
  await api("/api/reset", { method: "POST" });
  await api("/api/seed", { method: "POST", body: JSON.stringify({ force: false }) });
  $("#importStatus").textContent = "re-indexing with OCR…";
  await waitForSeed();
  $("#importStatus").textContent = "Index rebuilt.";
  state.last = null;
  await loadGallery({ seedResults: true });
  await refreshStats();
}

async function waitForSeed() {
  for (;;) {
    const s = await api("/api/seed/status");
    $("#importStatus").textContent = `indexing ${s.done}/${s.total} — ${s.label || s.stage}`;
    if (!s.running) return s;
    await new Promise((r) => setTimeout(r, 700));
  }
}

/* ------------------------------------------------------------------- init --- */

function bindEvents() {
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch($("#query").value);
  });

  $("#kindFilter").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg");
    if (!btn) return;
    document.querySelectorAll("#kindFilter .seg").forEach((b) => b.classList.toggle("is-active", b === btn));
    state.kind = btn.getAttribute("data-kind") || "";
    if (state.query) runSearch(state.query);
  });

  $("#drawerClose").addEventListener("click", closeDrawer);
  $("#importClose").addEventListener("click", closeImport);
  $("#scrim").addEventListener("click", () => {
    closeDrawer();
    closeImport();
  });
  $("#openImport").addEventListener("click", openImport);
  $("#saveNote").addEventListener("click", saveNote);
  $("#redoIndex").addEventListener("click", rebuildIndex);

  document.querySelectorAll("#drawer .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      state.drawer.tab = tab.getAttribute("data-tab");
      document.querySelectorAll("#drawer .tab").forEach((t) => t.classList.toggle("is-active", t === tab));
      renderDrawer();
    });
  });

  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    uploadFiles(e.target.files);
    e.target.value = "";
  });
  for (const evt of ["dragenter", "dragover"]) {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("is-over");
    });
  }
  for (const evt of ["dragleave", "drop"]) {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("is-over");
    });
  }
  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files?.length) uploadFiles(e.dataTransfer.files);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeDrawer();
      closeImport();
    }
    if (e.key === "/" && document.activeElement !== $("#query") && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      $("#query").focus();
    }
  });
}

const HERO_QUESTIONS = [
  {
    q: "What was that website with the cheap flights I found?",
    hint: "finds a screenshot from April you never named",
  },
  {
    q: "What was the name of the person who recommended that mechanic?",
    hint: "joins a WhatsApp chat, a note and a trip plan",
  },
];

function renderAnswerIntro() {
  $("#answerBody").innerHTML = `
    <p class="muted">Ask something you half-remember. The answer is assembled from your own screenshots,
      notes, photos and saved pages — with the evidence underneath.</p>
    <div class="try-grid">
      ${HERO_QUESTIONS.map(
        (h, i) => `<button class="try-card" data-hero="${i}" type="button"><b>“${esc(h.q)}”</b><span>${esc(h.hint)}</span></button>`
      ).join("")}
    </div>`;
  $("#answerBody").querySelectorAll("[data-hero]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = HERO_QUESTIONS[Number(btn.getAttribute("data-hero"))].q;
      $("#query").value = text;
      runSearch(text);
    });
  });
}

async function init() {
  bindEvents();
  renderAnswerIntro();
  $("#answerBadge").textContent = "waiting for a question";
  await refreshStatus();
  if (!state.stats || state.stats.total === 0) {
    const health = await api("/api/health");
    if (health.seed.running) {
      $("#indexLabel").textContent = `indexing 0/${health.seed.total}`;
      await waitForSeedSilent();
    }
  }
  await loadSuggestions();
  await loadGallery({ seedResults: true });
  await refreshStats();
  const params = new URLSearchParams(location.search);
  const q = params.get("q");
  if (q) {
    $("#query").value = q;
    runSearch(q);
  }
}

async function waitForSeedSilent() {
  for (;;) {
    try {
      const s = await api("/api/seed/status");
      $("#indexLabel").textContent = `indexing ${s.done}/${s.total}`;
      $("#indexDot").className = "dot dot-live";
      if (!s.running) break;
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  await refreshStatus();
}

init();
