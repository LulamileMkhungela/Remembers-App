#!/usr/bin/env node
/**
 * Query regression test.
 *
 * Runs the demo questions against a running server and asserts the value that
 * must come back — real answers from the sample phone data, through the real
 * pipeline (OCR → embeddings → hybrid rank → extractive answer).
 *
 *   npm start          # in one terminal
 *   npm run test:queries
 */
const BASE = process.env.REMEMBERS_URL || "http://localhost:8787";

/**
 * [question, what the headline must contain, what the answer must cite]
 *
 * "cite" is checked against the whole evidence trail — the bullets, the memory
 * titles they came from and the top result — because the answer is allowed to
 * quote a line ("TOTAL  R456.90") that does not repeat the memory's name.
 */
const CASES = [
  ["What was that website with the cheap flights I found?", /cheapflights\.co\.za/i, /R1 ?289|Cape Town/i],
  ["What was the name of the person who recommended that mechanic?", /Thabo Mokoena/i, /mechanic|071 ?555 ?0199/i],
  ["what is Thabo's number?", /071 ?555 ?0199/, /Lerato|Thabo/i],
  ["how do I fix the E20 error on my washing machine?", /E20|washer|Bosch/i, /drain|pump|filter/i],
  ["what is the wifi password at the guest house?", /Sunset2024!/, /Protea/i],
  ["when is my dentist appointment?", /Thu|15[:.]30|dentist/i, /Naidoo|Rosebank|15[:.]30/i],
  ["how much did the plumber charge to fix the geyser?", /R1 ?850/, /geyser|Denzel/i],
  ["when is load shedding tonight?", /17:00|19:30/, /Stage 4|Zone 7/i],
  ["what was the jacket I wanted to buy on sale?", /jacket|R899/i, /jacket|sale/i],
  ["which series did Sipho tell me to watch?", /Shogun/, /Sipho|watch/i],
  ["what did I spend on groceries?", /R456\.90|456/, /receipt|Checkers|grocery/i],
  ["where is the hiking trail I wanted to try?", /Kloofendal/i, /trail|parking|km/i],
  ["what is my medical aid claim reference?", /CLM448120/, /Discovery|claim/i],
  ["how much did the laptop upgrade quote come to?", /R1 ?299|R1 ?649|1 ?299/, /Matrix|SSD|Faizel/i],
];

const caseless = (re) => new RegExp(re.source, `${re.flags.replace(/[gi]/g, "")}i`);

const post = async (path, body) => {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
};

console.log(`\nQuery regression test — ${BASE}`);
console.log("(expects the sample phone library — reset the index first if you have imported extra data)\n");

let health;
try {
  health = await (await fetch(`${BASE}/api/health`)).json();
} catch {
  console.error(`  ✗ no server at ${BASE}. Start it with \`npm start\`.\n`);
  process.exit(1);
}
if (!health.store.total) {
  console.error("  ✗ the index is empty — wait for seeding to finish, or POST /api/seed.\n");
  process.exit(1);
}
console.log(`  index: ${health.store.total} memories (${health.store.ocrDocs} read by OCR), model: ${health.embedder.mode}\n`);

let failed = 0;
for (const [question, headlineRe, contextRe] of CASES) {
  const data = await post("/api/search", { query: question });
  const answer = data.answer || {};
  const headline = answer.headline || "";
  const top = data.results?.[0];
  const context = [
    ...(answer.bullets || []).map((b) => `${b.text} ${b.docTitle}`),
    ...(answer.evidence || []).map((e) => `${e.title} ${e.quote || ""}`),
    top ? top.title : "",
  ].join(" \n ");

  const okHeadline = caseless(headlineRe).test(headline);
  const okContext = caseless(contextRe).test(context);
  const ok = okHeadline && okContext;
  if (!ok) failed++;

  console.log(`  ${ok ? "✓" : "✗"} ${question}`);
  console.log(`      → ${headline}${ok ? "" : `   [expected headline ${headlineRe}]`}`);
  if (!ok) {
    console.log(`      top: ${top ? `${top.title} (${top.score})` : "no results"}`);
    console.log(`      answer did not mention ${contextRe}`);
  }
  if (ok && data.timings) console.log(`      ${data.timings.total} ms · ${data.results.length} results · ${data.connections.length} links`);
}

console.log(failed ? `\n${failed} of ${CASES.length} questions failed.\n` : `\nAll ${CASES.length} questions answered correctly.\n`);
process.exit(failed ? 1 : 0);
