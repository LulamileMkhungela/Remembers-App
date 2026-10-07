/**
 * HTTP tests — the router, the views and the API contract.
 * These caught a real bug: a handler that wrote a response but returned
 * undefined, so the request fell through to the static 404 path.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5991;
let child = null;

const get = (p) => fetch(`http://127.0.0.1:${PORT}${p}`);
const post = (p, body) => fetch(`http://127.0.0.1:${PORT}${p}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {})
});

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: 'ignore'
  });
  await waitForServer();
});

after(() => { if (child) child.kill(); });

function waitForServer(tries = 60) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/health' }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry(n);
      });
      req.on('error', () => retry(n));
      function retry(count) {
        if (count <= 0) reject(new Error('server did not start'));
        else setTimeout(() => attempt(count - 1), 100);
      }
    };
    attempt(tries);
  });
}

describe('http', () => {
  test('serves the app shell', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Remembers/);
    assert.match(html, /app\.js/);
  });

  test('serves the client assets', async () => {
    for (const asset of ['/styles.css', '/app.js']) {
      const res = await get(asset);
      assert.equal(res.status, 200, asset);
      assert.ok((await res.text()).length > 100, asset);
    }
  });

  test('serves the generated photo library', async () => {
    const res = await get('/assets/tram.jpg');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.ok(Number(res.headers.get('content-length')) > 10000);
  });

  test('health, stats and library report the index', async () => {
    const health = await (await get('/api/health')).json();
    assert.equal(health.ok, true);
    assert.equal(health.indexed, 35);
    const stats = await (await get('/api/stats')).json();
    assert.ok(stats.dimensions >= 2 && stats.dimensions <= 32);
    assert.ok(stats.vocabulary > 200);
    const library = await (await get('/api/library')).json();
    assert.equal(library.items.length, 35);
    assert.ok(library.items.every((i) => i.openTarget && i.openTarget.href));
  });

  test('unknown API routes answer 404 instead of falling through', async () => {
    const res = await get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).error, 'no such route');
  });

  test('unknown pages are a plain 404', async () => {
    const res = await get('/nope');
    assert.equal(res.status, 404);
    assert.equal(await res.text(), 'not found');
  });

  test('captured screens are rendered for items that have one', async () => {
    const res = await get('/view/shot-flights');
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Turkish Airlines/);
    assert.match(html, /9 420/);
    const missing = await get('/view/note-wine');
    assert.equal(missing.status, 404, 'a note has no captured screen');
  });

  test('ask returns answer, evidence and trace', async () => {
    const res = await post('/api/ask', { q: 'What was that website with the cheap flights I found?' });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.answer.headline, 'Skyscanner — from R9 420.');
    assert.ok(out.answer.evidence.length >= 3);
    assert.ok(out.results[0].snippet.length > 0);
    assert.ok(Array.isArray(out.timeline) && out.timeline.length > 0);
    assert.ok(out.meta.tookMs >= 0);
    assert.equal(out.meta.mode, 'on-device simulation');
  });

  test('ask validates its input', async () => {
    assert.equal((await post('/api/ask', {})).status, 400);
    assert.equal((await post('/api/ask', { q: 'x'.repeat(500) })).status, 400);
  });

  test('item detail explains how it was extracted and what it connects to', async () => {
    const item = await (await get('/api/item/photo-card')).json();
    assert.equal(item.kind, 'photo');
    assert.ok(item.extraction.length >= 3);
    assert.ok(item.extraction.every((row) => typeof row.confidence === 'number'));
    assert.ok(item.related.some((r) => r.id === 'photo-receipt'));
    const source = await (await get('/api/item/photo-card/source')).json();
    assert.match(source.indexedText, /NKOMO AUTO REPAIRS/i);
  });

  test('the simulator adds an item and re-answers its question', async () => {
    const events = await (await get('/api/simulator')).json();
    assert.ok(events.events.length >= 3);
    const res = await post('/api/simulator/advance', { id: 'message-mechanic' });
    assert.equal(res.status, 200);
    const out = await res.json();
    assert.equal(out.indexed, 36);
    assert.match(out.proof.headline, /073 630 7561/);
    const after = await (await get('/api/health')).json();
    assert.equal(after.indexed, 36);
    assert.equal((await post('/api/simulator/advance', { id: 'message-mechanic' })).status, 409, 'twice is a conflict');
    const reset = await (await post('/api/simulator/reset')).json();
    assert.equal(reset.indexed, 35);
    assert.equal((await (await get('/api/health')).json()).indexed, 35);
  });

  test('search endpoint works over GET as well as POST', async () => {
    const out = await (await get('/api/search?q=wine')).json();
    assert.ok(out.results.length > 0);
    assert.ok(out.results[0].signals.lexical >= 0);
  });
});
