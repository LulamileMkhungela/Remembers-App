/**
 * Headless UI test.
 *
 * Loads the real public/index.html and public/app.js against a running server and
 * drives the interface the way a person would: asks a question, reads the answer,
 * opens a memory, moves through the drawer tabs, filters, and imports a note.
 *
 *   npm start           # in one terminal
 *   npm run test:ui     # in another
 */
import { parseHTML } from "linkedom";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASE = process.env.REMEMBERS_URL || "http://localhost:8787";

const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const { window, document } = parseHTML(html);

// --- browser globals that app.js expects -----------------------------------
globalThis.window = window;
globalThis.document = document;
try { globalThis.navigator = window.navigator; } catch { /* node 22 exposes a read-only navigator */ }
globalThis.HTMLElement = window.HTMLElement;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.FormData = window.FormData || FormData;
globalThis.location = new URL(BASE);

const problems = [];
window.addEventListener?.("error", (e) => problems.push("window error: " + e.message));
process.on("unhandledRejection", (e) => problems.push("unhandled rejection: " + (e?.message || e)));

const realFetch = globalThis.fetch;
globalThis.fetch = (url, opts) => realFetch(String(url).startsWith("http") ? url : BASE + url, opts);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function check(label, condition, detail = "") {
  console.log(`${condition ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) problems.push(label);
}

// ---------------------------------------------------------------------------

console.log("\n1. boot the app");
await import(path.join(ROOT, "public/app.js"));
await sleep(3500);

// regression: author display rules used to beat [hidden], so both drawers and the
// pipeline strip were on screen before any interaction
check("memory drawer starts hidden", $("#drawer").hidden === true);
check("import drawer starts hidden", $("#importDrawer").hidden === true);
check("scrim starts hidden", $("#scrim").hidden === true);
check("pipeline strip starts hidden", $("#pipeline").hidden === true);
check("page is not scroll-locked at rest", document.body.classList.contains("is-locked") === false);
check("hero questions offered before the first search", $$("#answerBody [data-hero]").length === 2);
check("recent memories fill the results panel", $$("#resultsBody .result").length >= 6, `${$$("#resultsBody .result").length} cards`);
check("status pill shows the on-device model", /MiniLM|loading/.test($("#embedLabel").textContent), $("#embedLabel").textContent.trim());
check("index pill reports memories", /\d+ memories/.test($("#indexLabel").textContent), $("#indexLabel").textContent.trim());
check("suggestion chips rendered", $$("#suggestions .chip").length >= 4, `${$$("#suggestions .chip").length} chips`);
check("stats grid filled", $$("#statsGrid .stat").length === 4);
check("gallery populated", $$("#gallery .gallery-item").length > 10, `${$$("#gallery .gallery-item").length} items`);

console.log("\n2. ask a question (submit the form)");
$("#query").value = "What was the name of the person who recommended that mechanic?";
$("#searchForm").dispatchEvent(new window.Event("submit", { bubbles: true }));
await sleep(2500);

check("answer headline rendered", $$("#answerBody .answer-headline").length === 1, $("#answerBody .answer-headline")?.textContent);
check("headline names the mechanic", /Thabo Mokoena/.test($("#answerBody").textContent));
check("answer bullets cite sources", $$("#answerBody .answer-list li").length >= 2, `${$$("#answerBody .answer-list li").length} bullets`);
check("confidence meter shown", $$("#answerBody .meter").length === 1);
check("result cards rendered", $$("#resultsBody .result").length >= 5, `${$$("#resultsBody .result").length} results`);
check("snippet highlighting present", $$("#resultsBody .result-snippet mark").length > 0, `${$$("#resultsBody .result-snippet mark").length} marks`);
check("connection edges shown", $$("#connectionsBody .edge").length >= 1, `${$$("#connectionsBody .edge").length} edges`);
check("timeline rendered", $$("#timelineBody .timeline-item").length >= 2, `${$$("#timelineBody .timeline-item").length} points`);

console.log("\n3. open a memory (click the top result)");
$$("#resultsBody .result")[0].dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(1200);
check("drawer opened", $("#drawer").hidden === false);
check("scrim shown behind it", $("#scrim").hidden === false);
check("page scroll locked while open", document.body.classList.contains("is-locked") === true);
check("import drawer stays closed", $("#importDrawer").hidden === true);
check("drawer title set", $("#drawerTitle").textContent.length > 3, $("#drawerTitle").textContent);
check("viewer or text block present", $$("#drawerBody .viewer, #drawerBody .text-block").length >= 1);

console.log("\n4. drawer tabs");
for (const tab of ["text", "analysis", "related"]) {
  const btn = $$(`#drawer .tab`).find((t) => t.dataset.tab === tab);
  btn.dispatchEvent(new window.Event("click", { bubbles: true }));
  await sleep(900);
  const body = $("#drawerBody");
  const ok = body.textContent.trim().length > 40;
  check(`tab "${tab}" renders content`, ok, body.textContent.replace(/\s+/g, " ").slice(0, 62));
}
$("#drawerClose").dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(200);
check("drawer closes", $("#drawer").hidden === true);
check("scrim and lock released", $("#scrim").hidden === true && document.body.classList.contains("is-locked") === false);

console.log("\n5. kind filter");
const noteSeg = $$("#kindFilter .seg").find((s) => s.dataset.kind === "note");
noteSeg.dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(2000);
const kinds = $$("#resultsBody .result .result-meta").map((m) => m.textContent.replace(/\s+/g, " "));
console.log("     debug kinds:", JSON.stringify(kinds.slice(0, 3)));
check("filtered results are all notes", kinds.length > 0 && kinds.every((k) => /note/i.test(k)), `${kinds.length} results`);
$$("#kindFilter .seg").find((s) => s.dataset.kind === "").dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(1800);

console.log("\n6. import panel");
$("#openImport").dispatchEvent(new window.Event("click", { bubbles: true }));
check("import drawer opens", $("#importDrawer").hidden === false);
check("only one overlay at a time", $("#drawer").hidden === true);
$("#noteTitle").value = "Test memory from the UI harness";
$("#noteBody").value = "Bought a new bike helmet at Cycle Lab for R749, receipt in the cubby hole. Invoice number INV90210.";
$("#saveNote").dispatchEvent(new window.Event("click", { bubbles: true }));
await sleep(2500);
check("note import reported", /Indexed|already in the index/i.test($("#importStatus").textContent), $("#importStatus").textContent.slice(0, 80));

console.log("\n7. search the memory that was just imported");
$("#importClose").dispatchEvent(new window.Event("click", { bubbles: true }));
$("#query").value = "how much was the bike helmet?";
$("#searchForm").dispatchEvent(new window.Event("submit", { bubbles: true }));
await sleep(2500);
check("imported memory is searchable", /749|helmet/i.test($("#answerBody").textContent), $("#answerBody .answer-headline")?.textContent);

console.log("\n8. summary");
check("no stray unhandled errors", problems.length === 0, problems.join(" | ").slice(0, 400));

console.log(problems.length ? `\nFAILED: ${problems.length} problem(s)\n` : "\nAll UI checks passed.\n");
process.exit(problems.length ? 1 : 0);
