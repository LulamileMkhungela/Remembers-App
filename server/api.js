/**
 * The HTTP surface the browser client talks to.
 * On a real device these are the bridges into the local index, not routes on a
 * server — but the shapes are the same.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyEvent, EVENTS, RESET_NOTE } from './simulator.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIEWS = path.join(HERE, '..', 'data', 'views');

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  return res.end(body);
}

async function readBody(req, limit = 1e6) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('payload too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

export function createApi(store) {
  return async function handle(req, res, url) {
    const segments = url.pathname.split('/').filter(Boolean);

    if (url.pathname === '/api/health') {
      return json(res, 200, { ok: true, indexed: store.stats().indexed, mode: 'on-device simulation' });
    }

    if (url.pathname === '/api/stats') {
      return json(res, 200, store.stats());
    }

    if (url.pathname === '/api/library') {
      const kind = url.searchParams.get('kind');
      const source = url.searchParams.get('source');
      let items = store.library();
      if (kind) items = items.filter((i) => i.kind === kind);
      if (source) items = items.filter((i) => i.source === source);
      return json(res, 200, { items, stats: store.stats() });
    }

    if (segments[0] === 'api' && segments[1] === 'item' && segments[2]) {
      const id = decodeURIComponent(segments[2]);
      if (segments[3] === 'source') {
        const source = store.extractedText(id);
        if (!source) return json(res, 404, { error: 'not found' });
        return json(res, 200, source);
      }
      const item = store.item(id);
      if (!item) return json(res, 404, { error: 'not found' });
      return json(res, 200, item);
    }

    if (url.pathname === '/api/simulator') {
      return json(res, 200, { events: EVENTS, resetNote: RESET_NOTE });
    }

    if (url.pathname === '/api/simulator/advance' && req.method === 'POST') {
      const body = await readBody(req);
      const id = body.id || url.searchParams.get('id');
      const result = applyEvent(store, id);
      if (!result) return json(res, 400, { error: `unknown event: ${id}` });
      if (!result.added) return json(res, 409, { error: 'already indexed', id });
      // What the same question returns now, so the client can show the jump.
      const after = store.ask(result.proves, { limit: 4 });
      return json(res, 200, {
        ...result,
        proof: {
          question: result.proves,
          headline: after.answer.headline,
          confidence: after.answer.confidence,
          topId: after.answer.primary
        }
      });
    }

    if (url.pathname === '/api/simulator/reset' && req.method === 'POST') {
      return json(res, 200, { reset: true, ...store.reset() });
    }

    if (url.pathname === '/api/ask' && req.method === 'POST') {
      const body = await readBody(req);
      const question = String(body.q || body.question || '').trim();
      if (!question) return json(res, 400, { error: 'empty question' });
      if (question.length > 400) return json(res, 400, { error: 'question too long' });
      const started = Date.now();
      const out = store.ask(question, {
        limit: Number(body.limit) || 12,
        kind: body.kind || null,
        source: body.source || null
      });
      out.meta.indexMs = Date.now() - started;
      return json(res, 200, out);
    }

    if (url.pathname === '/api/search' && (req.method === 'POST' || req.method === 'GET')) {
      const body = req.method === 'POST' ? await readBody(req) : {};
      const question = String(body.q || url.searchParams.get('q') || '').trim();
      if (!question) return json(res, 400, { error: 'empty query' });
      const out = store.search(question, {
        limit: Number(body.limit) || 12,
        kind: body.kind || url.searchParams.get('kind') || null,
        source: body.source || url.searchParams.get('source') || null
      });
      return json(res, 200, { question, ...out });
    }

    // ── rendered "screenshots" ────────────────────────────────────────────────
    if (segments[0] === 'view' && segments[1]) {
      const item = store.item(decodeURIComponent(segments[1]));
      if (!item || !item.view) return json(res, 404, { error: 'no captured screen for that item' });
      const file = path.join(VIEWS, path.basename(item.view));
      try {
        const html = await readFile(file, 'utf8');
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src 'self'"
        });
        return res.end(html);
      } catch {
        return json(res, 500, { error: 'captured screen missing' });
      }
    }

    return json(res, 404, { error: 'no such route' });
  };
}
