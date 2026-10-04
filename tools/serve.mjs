#!/usr/bin/env node
/**
 * Preview the site locally. No dependencies:
 *
 *   node tools/serve.mjs [port]        # default 8080
 *
 * Serves public/ the way Firebase Hosting does (clean URLs, nothing cached), so what
 * works here works there. Add ?now=2027-04-09T07:00 to the URL to see the trip at any
 * moment; a time with no offset is trip-local.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../public/', import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.pdf': 'application/pdf', '.ico': 'image/x-icon',
};

const isFile = (p) => stat(p).then((s) => s.isFile(), () => false);

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  // Clean URLs: / is index.html, /about is about.html.
  const candidates = path.endsWith('/') ? [join(path, 'index.html')] : [path, `${path}.html`];
  for (const c of candidates) {
    const file = join(ROOT, c);
    if (!file.startsWith(ROOT) || !(await isFile(file))) continue;
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    return res.end(await readFile(file));
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
}).listen(PORT, () => {
  console.log(`tripline preview: http://localhost:${PORT}/`);
  console.log(`see any moment:   http://localhost:${PORT}/?now=2027-04-09T07:00`);
});
