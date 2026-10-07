/**
 * Remembers — browser client.
 *
 * Vanilla ES modules, no build step, no network. Everything here talks to the
 * local API, which stands in for the on-device index.
 */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const KIND_ICON = {
  screenshot: '🖼', photo: '📷', note: '📝', email: '✉️', voice: '🎙',
  event: '📅', contact: '👤', page: '🔖', message: '💬'
};

const state = {
  data: null,
  lastQuestion: '',
  library: [],
  kindFilter: null,
  stats: null,
  events: [],
  advanced: new Set()
};

const CHIPS = [
  { q: 'What was that website with the cheap flights I found?', wow: true },
  { q: 'What was the name of the person who recommended that mechanic?', wow: true },
  { q: 'How much was the car service?', wow: false },
  { q: 'Where is that café with the wifi?', wow: false },
  { q: 'What is the mechanic’s number?', wow: false },
  { q: 'When did I look for flights?', wow: false },
  { q: 'What did I save about focus?', wow: false },
  { q: 'Show me my voice memos', wow: false }
];

/** Sample questions for the empty state — each one leans on a different source. */
const SAMPLES = [
  { icon: '✈️', title: 'The cheap flight', q: 'What was that website with the cheap flights I found?' },
  { icon: '🔧', title: 'The mechanic', q: 'What was the name of the person who recommended that mechanic?' },
  { icon: '💰', title: 'What it cost', q: 'How much was the car service?' },
  { icon: '🎙', title: 'Against filenames', q: 'That idea I recorded in the shower' },
  { icon: '📅', title: 'Across sources', q: 'What do I know about the Lisbon trip?' },
  { icon: '🚫', title: 'When it doesn’t know', q: 'Where did I park the car?' }
];

// ── api ──────────────────────────────────────────────────────────────────────

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

const ask = (q, extra = {}) => api('/api/ask', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ q, ...extra })
});

const searchOnly = (q) => api('/api/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ q })
});

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(text = '') {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function highlight(text, terms = []) {
  let html = esc(text);
  for (const term of terms.filter((t) => t && t.length > 2)) {
    const re = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    html = html.replace(re, '<mark>$1</mark>');
  }
  return html;
}

function bar(pct) {
  const clamped = Math.max(0, Math.min(1, pct));
  return `<i><span style="width:${(clamped * 100).toFixed(1)}%"></span></i>`;
}

function whenLabel(ev) {
  if (ev.daysAgo == null) return 'always on your phone';
  return `${ev.when}`;
}

function confClass(label) {
  return (label || '').toLowerCase();
}

// ── phone: ask ───────────────────────────────────────────────────────────────

function renderChips() {
  $('#chips').innerHTML = CHIPS
    .map((c) => `<button class="chip${c.wow ? ' wow' : ''}" data-q="${esc(c.q)}">${esc(c.q)}</button>`)
    .join('');
}

function renderEmpty() {
  $('#empty-grid').innerHTML = SAMPLES
    .map((s) => `<button class="empty-card" data-q="${esc(s.q)}"><b>${s.icon} ${esc(s.title)}</b>${esc(s.q)}</button>`)
    .join('');
}

function thinking() {
  const stages = ['reading the phone', 'text index', 'meaning space', 'ranking'];
  $('#phone-body').innerHTML = `
    <div class="thinking">
      <div class="skeleton-line" style="width:72%"></div>
      <div class="skeleton-line" style="width:46%"></div>
      <div class="skeleton-line" style="width:58%"></div>
      <div class="stages">${stages.map((s) => `<span>${s}</span>`).join('')}</div>
    </div>`;
}

async function runQuestion(question) {
  if (!question || !question.trim()) return;
  state.lastQuestion = question.trim();
  $('#ask-input').value = state.lastQuestion;
  thinking();
  try {
    const data = await ask(state.lastQuestion);
    state.data = data;
    renderAnswer(data);
    renderStats(data.meta);
  } catch (error) {
    $('#phone-body').innerHTML = `<div class="answer"><h2 class="hedged">Something broke</h2>
      <p class="detail">${esc(error.message)}</p></div>`;
  }
}

// ── phone: answer rendering ──────────────────────────────────────────────────

function renderAnswer(data) {
  const { answer, results, understanding, meta, timeline } = data;
  const primary = results.find((r) => r.id === answer.primary) || results[0];
  const body = $('#phone-body');

  if (!results.length) {
    body.innerHTML = `
      <div class="answer">
        <div class="qline"><span class="who">You asked</span> ${esc(data.question)}</div>
        <h2 class="hedged">${esc(answer.headline)}</h2>
        <p class="detail">${esc(answer.detail)}</p>
        <div class="actions">
          <button class="btn" data-q="Show me my screenshots">Browse Screenshots instead</button>
          <button class="btn" data-q="Show me my photos">Browse Photos instead</button>
        </div>
      </div>`;
    return;
  }

  const signals = answer.confidence.signals;
  const bars = [
    { name: 'match', v: Math.min(signals.match / 0.9, 1) },
    { name: 'coverage', v: signals.coverage },
    { name: 'margin', v: Math.min(signals.margin / 0.25, 1) },
    { name: 'trust', v: signals.trust },
    { name: 'breadth', v: Math.min(results.length / 3, 1) }
  ];

  const facts = (answer.facts || []).map((f) => {
    const inner = `<span class="lab">${esc(f.label)}</span><b>${esc(f.value)}</b>`;
    return f.from
      ? `<button class="fact" data-open="${esc(f.from)}">${inner}</button>`
      : `<span class="fact plain">${inner}</span>`;
  }).join('');

  const evidence = results.slice(0, 5).map((r) => evidenceCard(r, answer.primary)).join('');

  body.innerHTML = `
    <div class="answer">
      <div class="qline">
        <span class="who">You asked</span> “${esc(data.question)}”
      </div>
      <h2 class="${answer.hedged ? 'hedged' : ''}">${esc(answer.headline)}</h2>
      <p class="detail">${esc(answer.detail)}</p>
      ${facts ? `<div class="facts">${facts}</div>` : ''}
      <div class="conf">
        <span class="label ${confClass(answer.confidence.label)}">
          <b>${esc(answer.confidence.label)}</b> confidence
        </span>
        <span class="bars">
          ${bars.map((b, i) => `<i class="s${i}" title="${b.name}">${'<span>'}</i>`).join('')}
        </span>
        <span class="pct">${(answer.confidence.score * 100).toFixed(0)}%</span>
      </div>
      <div class="actions">
        ${primary?.openTarget
          ? `<a class="btn primary" href="${esc(primary.openTarget.href)}" ${primary.openTarget.type === 'view' || primary.openTarget.type === 'image' ? 'target="_blank" rel="noopener"' : ''} data-open-btn="${esc(primary.id)}">${esc(primary.openTarget.label)}</a>`
          : ''}
        <button class="btn" data-open="${esc(answer.primary)}">Full record</button>
        <button class="btn ghost" data-explain="1">Why this answer</button>
      </div>
      <div id="explain-slot"></div>
    </div>

    <div class="sect-title">Where it came from <span class="count">${results.length} of ${meta.indexed} items · ${meta.tookMs} ms</span></div>
    ${evidence}
    ${results.length > 5 ? `<button class="btn tiny" data-q="${esc(data.question)}" data-limit="12">Show ${results.length - 5} more</button>` : ''}

    <div class="sect-title">The trail <span class="count">${timeline.filter((t) => t.onTheQuestionPath).length} of ${timeline.length} on this answer</span></div>
    ${renderTimeline(timeline)}
  `;

  $('[data-explain]', body)?.addEventListener('click', () => toggleExplain(data));
}

function evidenceCard(r, primaryId) {
  const isPrimary = r.id === primaryId;
  const txtPct = Math.round(r.signals.lexical * 100) || 0;
  const semPct = Math.round(r.signals.semantic * 100) || 0;
  const terms = [...(r.signals.matchedWords || []), ...(r.signals.anchors || [])];
  return `
    <article class="ev${isPrimary ? ' primary' : ''}" data-open="${esc(r.id)}">
      <div class="top">
        <div class="ico">${KIND_ICON[r.kind] || '•'}</div>
        <div class="head">
          <b>${esc(r.title || r.summary || r.id)}</b>
          <div class="meta">
            <span class="pill">${esc(r.source)}</span>
            ${r.app ? `<span>${esc(r.app)}</span>` : ''}
            <span>${esc(r.daysAgo == null ? 'always on your phone' : r.daysAgo === 0 ? 'today' : `${r.daysAgo} days ago`)}</span>
            ${r.location ? `<span>· ${esc(r.location)}</span>` : ''}
          </div>
        </div>
        <div class="score"><b>${(r.score * 100).toFixed(0)}</b>score</div>
      </div>
      ${r.snippet ? `<p class="snip">${highlight(r.snippet, terms)}</p>` : ''}
      <div class="split" title="text match ${txtPct}% · meaning match ${semPct}%">
        <i class="txt" style="width:${Math.max(2, txtPct)}%"></i>
        <i class="sem" style="width:${Math.max(2, semPct)}%"></i>
        <i class="rest"></i>
      </div>
      <div class="why">${(r.why || []).map((w) => `<span>${esc(w)}</span>`).join('')}</div>
    </article>`;
}

function renderTimeline(timeline) {
  if (!timeline.length) return '';
  const nodes = timeline.map((t) => `
    <div class="tt-node${t.onTheQuestionPath ? ' on' : ''}" data-open="${esc(t.id)}" title="${esc(t.title || '')}">
      <span class="dot"></span>
      <span class="k">${KIND_ICON[t.kind] || '•'}</span>
      <span class="lab">${esc(t.daysAgo == null ? 'contact' : t.daysAgo === 0 ? 'today' : `${t.daysAgo}d`)}</span>
    </div>`).join('');
  return `
    <div class="timeline">
      <div class="rail"></div>
      <div class="tt-track">${nodes}</div>
      <div class="tt-more">oldest → newest · ${timeline.filter((t) => t.onTheQuestionPath).length} of these were used to answer</div>
    </div>`;
}

function toggleExplain(data) {
  const slot = $('#explain-slot');
  if (!slot) return;
  if (slot.innerHTML) { slot.innerHTML = ''; return; }
  const { understanding, answer, meta } = data;
  const perToken = answer.confidence.perToken || [];
  const tokens = perToken.map((t) => {
    const cls = t.credit >= 1 ? '' : t.credit > 0 ? 'part' : 'miss';
    const label = t.credit >= 1 ? t.token : t.credit > 0 ? `${t.token}~` : t.token;
    return `<i class="${cls}" title="${t.credit >= 1 ? 'exact match' : t.credit > 0 ? 'related wording' : 'not found in the best item'}">${esc(label)}</i>`;
  }).join('');

  slot.innerHTML = `
    <details class="trace" open>
      <summary>How this was answered <span style="color:var(--ink-3);font-size:11px">${meta.tookMs} ms · ${meta.dimensions} dimensions</span></summary>
      <div class="rows">
        <div class="row"><span class="k">Question kind</span><span class="v">${esc(understanding.intent)} · ${understanding.tokens.length} search terms${understanding.kinds.length ? ` · filtered to ${understanding.kinds.join(', ')}` : ''}</span></div>
        <div class="row"><span class="k">Terms</span><span class="v"><span class="tok">${tokens}</span></span></div>
        <div class="row"><span class="k">Also searched</span><span class="v"><span class="tok">${(understanding.expanded || []).slice(0, 10).map((t) => `<i class="part">${esc(t)}</i>`).join('') || '—'}</span></span></div>
        ${understanding.entities.length ? `<div class="row"><span class="k">Pinned</span><span class="v">${understanding.entities.map((e) => esc(e.text)).join(', ')}</span></div>` : ''}
        <div class="row"><span class="k">Pipeline</span><span class="v">
          <span class="steps">
            <span><b>${meta.indexed}</b> items</span>
            <span><b>${meta.vocabulary}</b> terms</span>
            <span>BM25 <b>${(answer.confidence.signals.textMatch * 100).toFixed(0)}%</b></span>
            <span>LSA <b>${(answer.confidence.signals.senseMatch * 100).toFixed(0)}%</b></span>
            <span>fused <b>${(answer.confidence.signals.match * 100).toFixed(0)}%</b></span>
          </span>
        </span></div>
        <div class="row"><span class="k">Confidence</span><span class="v">${esc(answer.confidence.label)} — ${(answer.confidence.score * 100).toFixed(0)}% (match ${answer.confidence.signals.match}, coverage ${answer.confidence.signals.coverage}, margin ${answer.confidence.signals.margin}, source trust ${answer.confidence.signals.trust})</span></div>
      </div>
    </details>`;
}

// ── drawer: one item in full ─────────────────────────────────────────────────

async function openItem(id) {
  const drawer = $('#drawer');
  drawer.hidden = false;
  $('#drawer-body').innerHTML = `<button class="btn ghost close" data-close>Close</button>
    <div class="skeleton-line" style="width:60%;height:18px"></div>
    <div class="skeleton-line" style="width:40%;margin-top:10px"></div>`;
  const item = await api(`/api/item/${encodeURIComponent(id)}`);
  const d = $('#drawer-body');

  const visual = item.view
    ? `<div class="frame shot"><iframe src="/view/${encodeURIComponent(item.id)}" title="${esc(item.title)}" loading="lazy"></iframe></div>
       <p class="frame-note">This is the captured screen, re-rendered from what the phone stored — <a href="/view/${encodeURIComponent(item.id)}" target="_blank" rel="noopener">open it full size</a>.</p>`
    : item.image
      ? `<div class="frame"><img src="${esc(item.image)}" alt="${esc(item.title)}" loading="lazy"></div>`
      : '';

  const pipe = item.extraction.map((p) => `
    <div class="prow">
      <span class="name">${esc(p.pipeline)}</span>
      <span class="bar"><i style="width:${Math.round((p.confidence || 0) * 100)}%"></i></span>
      <span class="num">${Math.round((p.confidence || 0) * 100)}%</span>
    </div>
    <div class="triggered" style="margin:-2px 0 6px 0">${esc(p.detail)}</div>`).join('');

  d.innerHTML = `
    <button class="btn ghost close" data-close>Close</button>
    <h3>${esc(item.title || item.summary || item.id)}</h3>
    <div class="dmeta">${KIND_ICON[item.kind] || '•'} ${esc(item.kind)} · ${esc(item.source)}${item.app ? ` · ${esc(item.app)}` : ''} · captured ${esc(item.daysAgo == null ? 'no date (a record, not a capture)' : `${item.daysAgo} days ago`)}</div>

    ${visual}

    ${item.summary ? `<section><h4>What it is</h4><div class="text">${esc(item.summary)}</div></section>` : ''}

    <section>
      <h4>What the phone extracted</h4>
      <div class="text">${esc(item.body || '—')}</div>
    </section>

    <section>
      <h4>Extraction confidence</h4>
      <div class="pipe">${pipe}</div>
    </section>

    <section>
      <h4>Why it was findable</h4>
      <div class="rel">
        ${(item.tags || []).map((t) => `<button data-q="${esc(t)}">#${esc(t)}</button>`).join('')}
      </div>
    </section>

    <section>
      <h4>Connected items</h4>
      <div class="rel">
        ${(item.related || []).map((r) => `<button data-open="${esc(r.id)}">${KIND_ICON[r.kind] || '•'} ${esc(r.title)}</button>`).join('') || '<span class="triggered">Nothing shares a tag with this yet.</span>'}
      </div>
    </section>

    <section>
      <h4>Actions</h4>
      <div class="rel">
        <a class="btn" href="${esc(item.openTarget.href)}" target="_blank" rel="noopener">${esc(item.openTarget.label)}</a>
        ${item.url ? `<a class="btn" href="https://${esc(item.url)}" target="_blank" rel="noopener">Visit ${esc(item.url.split('/')[0])}</a>` : ''}
        <button class="btn" data-ask="What else do I have about ${esc((item.tags || [item.kind])[0])}?">Ask about this</button>
      </div>
    </section>`;
}

// ── right hand panels ────────────────────────────────────────────────────────

function renderStats(meta) {
  if (meta) state.stats = { ...(state.stats || {}), ...meta };
  const s = state.stats || {};
  const items = s.indexed ?? state.library.length;
  $('#stats').innerHTML = `
    <div class="stat"><b>${items ?? '—'}</b><span>items indexed</span></div>
    <div class="stat"><b>${s.dimensions ?? '—'}</b><span>meaning dims</span></div>
    <div class="stat"><b>${s.vocabulary ?? '—'}</b><span>terms</span></div>
    <div class="stat"><b>${s.tookMs != null ? `${s.tookMs}` : '—'}</b><span>ms / query</span></div>`;
}

async function loadLibrary() {
  const data = await api('/api/library');
  state.library = data.items;
  state.stats = { ...(state.stats || {}), indexed: data.stats.indexed, dimensions: data.stats.dimensions, vocabulary: data.stats.vocabulary };
  renderStats();
  renderLibraryFilters();
  renderLibrary();
}

function renderLibraryFilters() {
  const sources = [...new Set(state.library.map((i) => i.source))];
  $('#library-filters').innerHTML = `<button data-src="" class="${state.kindFilter ? '' : 'on'}">all ${state.library.length}</button>` +
    sources.map((s) => {
      const count = state.library.filter((i) => i.source === s).length;
      return `<button data-src="${esc(s)}" class="${state.kindFilter === s ? 'on' : ''}">${esc(s)} ${count}</button>`;
    }).join('');
}

function renderLibrary() {
  const items = state.kindFilter ? state.library.filter((i) => i.source === state.kindFilter) : state.library;
  $('#library').innerHTML = items.map((i) => {
    const thumb = i.image
      ? `<img src="${esc(i.image)}" alt="" loading="lazy">`
      : i.view
        ? `<div class="shot-frame"><iframe src="/view/${esc(i.id)}" loading="lazy" scrolling="no" tabindex="-1" aria-hidden="true"></iframe></div><span class="view-badge">captured screen</span>`
        : `<div class="glyph">${KIND_ICON[i.kind] || '•'}</div>`;
    return `
      <button class="lib-card" data-open="${esc(i.id)}">
        <div class="thumb${i.image ? ' photo' : ''}">${thumb}</div>
        <div class="body">
          <b>${esc(i.title || i.id)}</b>
          <p>${esc(i.summary || '')}</p>
          <div class="tags">
            <span class="tag src">${esc(i.source)}</span>
            <span class="tag">${i.daysAgo == null ? 'record' : i.daysAgo === 0 ? 'today' : `${i.daysAgo}d ago`}</span>
            ${i.addedBy === 'simulator' ? '<span class="tag added">just added</span>' : ''}
          </div>
        </div>
      </button>`;
  }).join('');
}

function renderPipeline() {
  const stats = state.stats || {};
  $('#pipeline').innerHTML = `
    <div class="pipeline-steps">
      <div class="pstep"><span class="n">1</span><div><b>Capture &amp; extract — on the phone</b>
        <p>Screenshots are OCR'd. Photos get an on-device caption plus OCR of any text in frame. Pages keep their reader text.
           Voice memos are transcribed locally, mail and notes are already text. Nothing in this step touches the network.</p></div></div>
      <div class="pstep"><span class="n">2</span><div><b>Build a text index</b>
        <p>Every item becomes a bag of weighted terms — title, tags, people, body and metadata — with a synonym graph
           (<code>cheap</code> ↔ <code>cheapest</code> ↔ <code>deal</code> ↔ <code>fare</code>). Right now:
           <b>${stats.vocabulary ?? '—'}</b> terms across <b>${stats.indexed ?? '—'}</b> items.</p></div></div>
      <div class="pstep"><span class="n">3</span><div><b>Rank with two rankers at once</b>
        <p>BM25 for what the words literally say, and LSA — a truncated SVD over the term–document matrix
           (<b>${stats.dimensions ?? '—'}</b> dimensions) — for what the item is <em>about</em>. The two are fused, so a
           screenshot that never says "website" still answers a question about one.</p></div></div>
      <div class="pstep"><span class="n">4</span><div><b>Filter by kind, source, person, time</b>
        <p>"Screenshots from last month", "what Thabo sent" and "how much" are handled as gates and priors before ranking,
           not as words in the query.</p></div></div>
      <div class="pstep"><span class="n">5</span><div><b>Answer, with its evidence attached</b>
        <p>The reply is assembled only from what was retrieved: the figure comes off the matched item, corroboration is
           counted across sources, and a confidence score is computed from match strength, word coverage, the margin over
           the runner-up and how clean the extraction was. Weak matches say so.</p></div></div>
    </div>
    <h4>What it deliberately does not do</h4>
    <ul>
      <li>No generative text about your life — every value in the answer is quoted from an item you can open.</li>
      <li>No silent guessing: when nothing clears the floor, it says nothing matched, or hedges and explains why.</li>
      <li>No cloud round-trip. The whole pipeline above is the same shape an on-device implementation uses.</li>
    </ul>`;
}

function renderPrivacy() {
  $('#privacy').innerHTML = `
    <p>Every claim this page makes should be checkable in the code, so here is the honest version.</p>
    <h4>What is real here</h4>
    <ul>
      <li>The library is a fixed demo dataset, but the <b>retrieval is genuine</b>: BM25 over a weighted term index, fused with
        a truncated-SVD semantic space, with kind/source/person/time gates and a confidence model. No hardcoded answers —
        ask it something the library cannot support and it will say so.</li>
      <li>The extraction stories are the real shape of an on-device pipeline: OCR for screens, captions for photos,
        speech-to-text for memos, plus per-item extraction confidence that feeds back into ranking.</li>
      <li>Zero dependencies, zero network calls at runtime, no CDN, no fonts, no telemetry. Open the network tab: nothing leaves.</li>
    </ul>
    <h4>What would be different on a real phone</h4>
    <ul>
      <li>OCR, captioning and transcription run on-device (Vision / ML Kit / Whisper-style local models) instead of being
        pre-baked into the demo library.</li>
      <li>The index lives in a local database next to the items, rebuilt incrementally as the phone captures more.</li>
      <li>Permission and retention are per-source, and revoking "Photos" removes those rows from the index, not just from the UI.</li>
    </ul>
    <h4>Things a page like this normally hides</h4>
    <ul>
      <li>Speech-to-text for accents and noisy rooms is the weak link — a garbled transcript is invisible to the user later.</li>
      <li>Semantic search fails quietly: a confident-sounding answer that came from the wrong screenshot is the failure mode
        worth designing against, which is why coverage and margin are shown, not just a score.</li>
      <li>"Six months ago" means the index has to survive OS-level storage pressure and app reinstall. Anything cached and
        unrecoverable is not memory.</li>
    </ul>`;
}

async function loadEvents() {
  const data = await api('/api/simulator');
  state.events = data.events;
  renderEvents();
}

function renderEvents() {
  $('#events').innerHTML = state.events.map((e) => {
    const done = state.advanced.has(e.id);
    return `
      <div class="event${done ? ' done' : ''}">
        <div class="appline"><span class="ico">${e.icon}</span> ${esc(e.app)} ${done ? '· indexed' : '· waiting'}</div>
        <b>${esc(e.label)}</b>
        <p>${esc(e.blurb)}</p>
        <div class="proves">Proves: <em>${esc(e.proves)}</em></div>
        <div class="row">
          <button class="btn ${done ? '' : 'primary'} tiny" data-advance="${esc(e.id)}" ${done ? 'disabled style="opacity:.5"' : ''}>${done ? 'Indexed' : 'Advance'}</button>
          <button class="btn tiny" data-q="${esc(e.proves)}">Ask it</button>
        </div>
      </div>`;
  }).join('');
}

async function advanceEvent(id) {
  const before = state.stats?.indexed ?? state.library.length;
  let res;
  try {
    res = await api('/api/simulator/advance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id })
    });
  } catch (error) {
    if (String(error.message).startsWith('409')) {
      state.advanced.add(id);
      renderEvents();
      toast('That one is already on the phone — reset the library to replay it.');
    } else {
      toast(`Could not advance: ${esc(error.message)}`);
    }
    return;
  }
  state.advanced.add(id);
  await loadLibrary();
  renderEvents();
  toast(`<b>+1 item</b> from ${esc(res.event.app)} — index went from ${before} to ${res.indexed}. `
    + `<br>“${esc(res.proves)}” now answers: <b>${esc(res.proof.headline)}</b> (${esc(res.proof.confidence.label)})`);
  if (state.lastQuestion && state.lastQuestion.toLowerCase() === res.proves.toLowerCase()) {
    await runQuestion(state.lastQuestion);
  }
}

async function resetLibrary() {
  await api('/api/simulator/reset', { method: 'POST' });
  state.advanced.clear();
  await loadLibrary();
  renderEvents();
  $('#phone-body').innerHTML = '';
  renderEmpty();
  state.data = null;
  toast('Library reset to the original capture set.');
}

function toast(html, ms = 6500) {
  const el = $('#toast');
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, ms);
}

// ── wiring ───────────────────────────────────────────────────────────────────

document.addEventListener('click', async (event) => {
  const chip = event.target.closest('[data-q]');
  if (chip) {
    event.preventDefault();
    runQuestion(chip.dataset.q);
    return;
  }
  const open = event.target.closest('[data-open]');
  if (open) {
    event.preventDefault();
    openItem(open.dataset.open);
    return;
  }
  if (event.target.closest('[data-close]')) {
    $('#drawer').hidden = true;
    return;
  }
  const src = event.target.closest('[data-src]');
  if (src) {
    state.kindFilter = src.dataset.src || null;
    renderLibraryFilters();
    renderLibrary();
    return;
  }
  const advance = event.target.closest('[data-advance]');
  if (advance) {
    advance.disabled = true;
    await advanceEvent(advance.dataset.advance);
    return;
  }
  const askBack = event.target.closest('[data-ask]');
  if (askBack) {
    $('#drawer').hidden = true;
    runQuestion(askBack.dataset.ask);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') $('#drawer').hidden = true;
  if (event.key === '/' && document.activeElement !== $('#ask-input')) {
    event.preventDefault();
    $('#ask-input').focus();
  }
});

$('#ask-form').addEventListener('submit', (event) => {
  event.preventDefault();
  runQuestion($('#ask-input').value);
});

$$('.tab').forEach((tab) => tab.addEventListener('click', () => {
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
  $$('.panel').forEach((p) => p.classList.toggle('is-active', p.id === `panel-${tab.dataset.panel}`));
}));

$('#reset-btn').addEventListener('click', resetLibrary);

// ── boot ─────────────────────────────────────────────────────────────────────

renderChips();
renderEmpty();
renderPipeline();
renderPrivacy();
await loadLibrary();
await loadEvents();
renderPipeline();

// Deep link: /?q=the+question
const initial = new URLSearchParams(location.search).get('q');
if (initial) runQuestion(initial);
