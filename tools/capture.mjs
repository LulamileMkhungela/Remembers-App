/**
 * Render capture harness (development aid, not part of the app's test suite).
 *
 *   node tools/capture.mjs            # uses a Chromium from @sparticuz/chromium
 *
 * Boots the real page in a real browser, drives the interactions, and writes
 * screenshots to screenshots/ so the layout can be reviewed instead of guessed at.
 * It also reports layout faults it can measure: horizontal overflow, elements
 * wider than the viewport, panels with dead space, unreadable contrast pairs.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

// The browser deps (~110 MB) deliberately stay out of the app's node_modules:
//   mkdir -p /tmp/ss && cd /tmp/ss && npm init -y
//   npm i puppeteer-core@23 @sparticuz/chromium@153
const require = createRequire(process.env.CAPTURE_DEPS || "/tmp/ss/package.json");
const puppeteer = require("puppeteer-core");
const chromiumModule = require("@sparticuz/chromium");
const chromium = chromiumModule.default ?? chromiumModule;

const BASE = process.env.REMEMBERS_URL || "http://localhost:8787";
const OUT = "/home/user/screenshots";
fs.mkdirSync(OUT, { recursive: true });

// @sparticuz/chromium only unpacks its AL2023 shared libraries on Amazon Linux;
// elsewhere we decompress them ourselves once and point the loader at them.
const LIB_DIR = "/tmp/al2023/lib";
if (!fs.existsSync(path.join(LIB_DIR, "libnspr4.so"))) {
  const tar = "/tmp/al2023.tar";
  fs.writeFileSync(tar, require("node:zlib").brotliDecompressSync(fs.readFileSync("/tmp/ss/node_modules/@sparticuz/chromium/bin/al2023.tar.br")));
  fs.mkdirSync("/tmp/al2023", { recursive: true });
  execFileSync("tar", ["xf", tar, "-C", "/tmp/al2023"]);
}

const executablePath = await chromium.executablePath();
const browser = await puppeteer.launch({
  args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage", "--font-render-hinting=none"],
  executablePath,
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: `${LIB_DIR}:${process.env.LD_LIBRARY_PATH || ""}`, HOME: "/tmp" },
});

const problems = [];
const scene = async (name, { width, height, actions = [] }) => {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  for (const action of actions) {
    await action(page);
    await new Promise((r) => setTimeout(r, action.wait || 900));
  }
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });

  const report = await page.evaluate(() => {
    const vw = window.innerWidth;
    const overflow = document.documentElement.scrollWidth - vw;
    const wide = [...document.querySelectorAll("body *")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > vw + 1 && getComputedStyle(el).position !== "fixed";
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} = ${Math.round(el.getBoundingClientRect().width)}px`);

    // short text contrast: anything under 3.2:1 is hard to read on a dark theme
    const lum = (c) => {
      const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const parse = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
    const bgOf = (el) => {
      let node = el;
      while (node) {
        const cs2 = getComputedStyle(node);
        // an element painting its own gradient (primary buttons) has a transparent
        // background-color; measuring against an ancestor would be wrong
        if (cs2.backgroundImage && cs2.backgroundImage !== "none") return null;
        const bg = cs2.backgroundColor;
        const a = bg.match(/rgba?\(([^)]+)\)/);
        if (a && (bg.startsWith("rgb(") || Number(a[1].split(",")[3] || 1) > 0.5)) return parse(bg);
        node = node.parentElement;
      }
      return [8, 10, 15];
    };
    const lowContrast = [];
    for (const el of document.querySelectorAll("body *")) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const cs = getComputedStyle(el);
      const fg = parse(cs.color);
      const bg = bgOf(el);
      if (!bg || fg.length < 3 || bg.length < 3) continue;
      const L1 = lum(fg), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize);
      if (ratio < 3.2 && size < 18) lowContrast.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]} ${ratio.toFixed(1)}:1 (${cs.color})`);
    }
    // panels whose content is much shorter than the panel itself
    const slack = [...document.querySelectorAll(".panel")]
      .map((p) => {
        const body = p.querySelector(".panel-body");
        if (!body) return null;
        const used = [...body.children].reduce((s, c) => s + c.getBoundingClientRect().height, 0);
        const h = p.getBoundingClientRect().height;
        return h - used > 220 ? `${p.id || p.className} panel ${Math.round(h)}px tall, content ${Math.round(used)}px` : null;
      })
      .filter(Boolean);

    return { overflow, wide, lowContrast: [...new Set(lowContrast)].slice(0, 6), slack };
  });

  if (errors.length) problems.push(`${name}: ${errors.slice(0, 3).join(" | ")}`);
  if (report.overflow > 0) problems.push(`${name}: horizontal overflow ${report.overflow}px`);
  if (report.wide.length) problems.push(`${name}: elements wider than viewport — ${report.wide.join(", ")}`);
  if (report.lowContrast.length) problems.push(`${name}: low contrast — ${report.lowContrast.join(", ")}`);
  if (report.slack.length) problems.push(`${name}: dead space — ${report.slack.join(", ")}`);
  console.log(`${name}: ${file} ${errors.length ? `(errors: ${errors.length})` : ""}`);
  if (report.overflow || report.wide.length) console.log("   overflow:", report.overflow, report.wide.join(", "));
  if (report.lowContrast.length) console.log("   contrast:", report.lowContrast.join(", "));
  if (report.slack.length) console.log("   slack:", report.slack.join(", "));
  await page.close();
};

const ask = (q) => async (page) => {
  await page.evaluate((query) => {
    const input = document.querySelector("#query");
    input.value = query;
    input.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }, q);
};

await scene("desktop-1440", { width: 1440, height: 950 });
await scene("desktop-search", { width: 1440, height: 950, actions: [ask("What was the name of the person who recommended that mechanic?")] });
await scene("desktop-drawer", {
  width: 1440, height: 950,
  actions: [ask("what is the wifi password at the guest house?"), async (page) => {
    await page.evaluate(() => document.querySelector("#resultsBody .result")?.click());
  }],
});
await scene("desktop-import", { width: 1440, height: 950, actions: [async (page) => { await page.evaluate(() => document.querySelector("#openImport").click()); }] });
await scene("laptop-1280", { width: 1280, height: 800, actions: [ask("how much did the plumber charge to fix the geyser?")] });
await scene("tablet-900", { width: 900, height: 1200, actions: [ask("when is load shedding tonight?")] });
await scene("mobile-390", { width: 390, height: 844 });
await scene("mobile-search", { width: 390, height: 844, actions: [ask("what was the jacket I wanted to buy on sale?")] });
await scene("mobile-drawer", {
  width: 390, height: 844,
  actions: [ask("which series did Sipho tell me to watch?"), async (page) => { await page.evaluate(() => document.querySelector("#resultsBody .result")?.click()); }],
});

await browser.close();
console.log(problems.length ? `\n${problems.length} layout problem(s):\n - ${problems.join("\n - ")}\n` : "\nNo layout problems detected.\n");
process.exit(problems.length ? 1 : 0);
