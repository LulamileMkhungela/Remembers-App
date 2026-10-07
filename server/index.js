/**
 * Remembers — server entry point.
 *
 * Serves the browser client, the demo library and the search API.
 * Bind host is 0.0.0.0 so the sandbox preview proxy can reach it.
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createStore } from './store.js';
import { createApi } from './api.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

const store = createStore();
const api = createApi(store);

async function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('forbidden');
    return true;
  }
  try {
    const info = await stat(target);
    if (info.isDirectory()) return false;
    const body = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': ext === '.jpg' || ext === '.png' ? 'public, max-age=3600' : 'no-store'
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/view/')) {
      const handled = await api(req, res, url);
      if (handled !== undefined) return handled;
    }
    if (await serveStatic(req, res, url)) return;
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  } catch (error) {
    console.error('[remembers]', req.method, req.url, '-', error.message);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal error', message: error.message }));
  }
});

server.listen(PORT, HOST, () => {
  const stats = store.stats();
  console.log(`Remembers listening on http://${HOST}:${PORT}`);
  console.log(`Indexed ${stats.indexed} items · ${stats.dimensions} semantic dimensions · ${stats.vocabulary} terms`);
});
