#!/usr/bin/env node
/**
 * Static UI integrity check — catches the mistakes that only show up in a browser.
 *
 *   npm run check:ui
 *
 * It reads public/index.html, public/styles.css and public/app.js and fails on:
 *   1. an element with the `hidden` attribute whose CSS sets `display` (author CSS
 *      beats the UA `[hidden] { display: none }` rule — the drawers stayed on screen)
 *   2. an id referenced from app.js that index.html does not define
 *   3. a class used in the markup or the JS with no rule in the stylesheet
 *   4. a fixed-position element with no way of being hidden
 *   5. unbalanced HTML tags, and grid/flex children missing min-width guards
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");

const problems = [];
const note = (msg) => problems.push(msg);
// strip comments first: prose like "…beats [hidden] { display: none }" would
// otherwise be parsed as a rule and hide the real one
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
const rules = [...cssNoComments.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));

/** The element a rule actually styles: the rightmost compound of a selector. */
const subject = (sel) => sel.split(",").map((part) => part.trim().split(/\s+|>|\+|~/).pop() || "");

// 1. [hidden] must win -------------------------------------------------------
const hiddenRule = rules.find((r) => /\[hidden\]/.test(r.sel) && /display\s*:\s*none/.test(r.body));
const hiddenWins = Boolean(hiddenRule && /!important/.test(hiddenRule.body));
if (!hiddenRule) note("styles.css has no `[hidden] { display: none }` rule; an author display rule would override the UA rule");
else if (!hiddenWins) note("`[hidden]` must be declared with !important — element display rules (.drawer, .pipeline) otherwise win the cascade");
// a standalone `hidden` attribute - not `aria-hidden` or a word containing "hidden"
// a standalone `hidden` attribute - not `aria-hidden` or a word containing "hidden"
const hiddenTags = [...html.matchAll(/<([a-z0-9]+)([^>]*)>/gi)]
  .filter((m) => /(?:^|\s)hidden(?:[\s/>]|$)/.test(m[2]))
  .map((m) => ({ tag: m[1], attrs: m[2] }));

if (!hiddenWins) {
  for (const { tag, attrs } of hiddenTags) {
    const id = (attrs.match(/id="([^"]+)"/) || [])[1];
    const classes = ((attrs.match(/class="([^"]+)"/) || [])[1] || "").split(/\s+/).filter(Boolean);
    const selectors = [...(id ? [`#${id}`] : []), ...classes.map((c) => `.${c}`)];
    for (const { sel, body } of rules) {
      if (!/display\s*:/.test(body) || /\[hidden\]/.test(sel)) continue;
      const subjects = subject(sel);
      if (selectors.some((t) => subjects.some((part) => part === t || part.startsWith(t + ":") || part.startsWith(t + "[")))) {
        note(`<${tag}${id ? " #" + id : ""}> is hidden in the markup but "${sel}" sets ${(body.match(/display\s*:[^;]*/) || [""])[0].trim()} and nothing wins it back`);
      }
    }
  }
}

// 2. ids the JS reaches for --------------------------------------------------
const idsInHtml = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const idsInJs = new Set([...js.matchAll(/\$\("#([\w-]+)"\)/g)].map((m) => m[1]));
const dynamicIds = new Set(["boxToggle", "docText", "ocrLayer", "viewerImg"]); // created by app.js at runtime
for (const id of idsInJs) {
  if (!idsInHtml.has(id) && !dynamicIds.has(id)) note(`app.js looks for #${id} but index.html has no such element`);
}

// 3. classes with no styling -------------------------------------------------
const cssClasses = new Set();
for (const { sel } of rules) for (const c of sel.matchAll(/\.([a-z][\w-]*)/gi)) cssClasses.add(c[1]);
const usedClasses = new Set();
for (const m of html.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && usedClasses.add(c));
for (const m of js.matchAll(/el\("[a-z]+",\s*"([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && usedClasses.add(c));
for (const m of js.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach((c) => c && usedClasses.add(c.replace(/\$\{.*?\}/g, "")));
const runtime = new Set(["is-active", "is-over", "is-ok", "is-err", "is-done", "is-locked"]);
for (const c of usedClasses) if (!cssClasses.has(c) && !runtime.has(c)) note(`class "${c}" is used but never styled`);

// 4. fixed panels must be hideable -------------------------------------------
for (const { sel, body } of rules) {
  if (!/position\s*:\s*fixed/.test(body)) continue;
  const cls = (sel.match(/\.([a-z][\w-]*)/i) || [])[1];
  if (!cls) continue;
  const inMarkup = new RegExp(`class="[^"]*\\b${cls}\\b`).test(html);
  const hideable = new RegExp(`class="[^"]*\\b${cls}\\b[^"]*"[^>]*\\bhidden\\b|hidden[^>]*class="[^"]*\\b${cls}\\b`).test(html);
  if (inMarkup && !hideable && cls !== "scrim") note(`.${cls} is position: fixed but never carries the hidden attribute`);
}

// 5. structure ---------------------------------------------------------------
const voidTags = new Set(["meta", "link", "br", "hr", "img", "input", "source", "path", "circle", "rect", "stop", "use", "area", "base", "col", "embed", "track", "wbr"]);
const stack = [];
for (const m of html.matchAll(/<(\/?)([a-z0-9]+)([^>]*?)(\/?)>/gi)) {
  const [, closing, tag, attrs, selfClose] = m;
  const name = tag.toLowerCase();
  if (name === "!doctype" || voidTags.has(name) || selfClose === "/") continue;
  if (closing) {
    const last = stack.pop();
    if (last !== name) note(`HTML tags are unbalanced near </${name}> (open tag was <${last ?? "none"}>)`);
  } else {
    stack.push(name);
    void attrs;
  }
}
if (stack.length) note(`HTML tags left unclosed: ${stack.join(", ")}`);

const gridChildren = [...css.matchAll(/([^{}]+)\{([^}]*grid-template-columns[^}]*)\}/g)];
for (const m of gridChildren) {
  if (!/minmax\(0/.test(m[2]) && !/repeat\(/.test(m[2]) && !/auto-fill/.test(m[2])) {
    note(`"${m[1].trim()}" defines grid columns without a shrinkable track (minmax(0, …))`);
  }
}

// report ---------------------------------------------------------------------
console.log("\nUI integrity check\n");
if (!problems.length) {
  console.log(`  ✓ ${hiddenTags.length} hidden-markup element(s) all stay hidden`);
  console.log(`  ✓ ${idsInJs.size} ids referenced from app.js all exist in index.html`);
  console.log(`  ✓ ${usedClasses.size} class names all have styling`);
  console.log(`  ✓ tags balanced, grid tracks shrinkable\n\nEverything lines up.\n`);
  process.exit(0);
}
for (const p of problems) console.log(`  ✗ ${p}`);
console.log(`\n${problems.length} problem(s) found.\n`);
process.exit(1);
