import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = __dirname;
const distDir = path.join(rootDir, 'dist');
const host = '127.0.0.1';
const port = Number(process.env.POLYLAB_PORT || 4173);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.map': 'application/json; charset=utf-8'
};

function safeJoin(baseDir, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = decoded === '/' ? '/index.html' : decoded;
  const fullPath = path.normalize(path.join(baseDir, normalized));
  if (!fullPath.startsWith(path.normalize(baseDir))) {
    return null;
  }
  return fullPath;
}

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('Missing dist/index.html. Run npm run build first.');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const requestedPath = safeJoin(distDir, req.url);
  if (!requestedPath) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const candidatePaths = [requestedPath];
  if (!path.extname(requestedPath)) {
    candidatePaths.push(path.join(requestedPath, 'index.html'));
  }

  for (const candidatePath of candidatePaths) {
    if (!existsSync(candidatePath)) continue;
    try {
      const body = await readFile(candidatePath);
      const mimeType = mimeTypes[path.extname(candidatePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mimeType, 'Cache-Control': 'no-cache' });
      res.end(body);
      return;
    } catch (error) {
      console.error(error);
      res.writeHead(500);
      res.end('Server error');
      return;
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(port, host, () => {
  console.log(`PolyLab server ready at http://${host}:${port}/`);
});
