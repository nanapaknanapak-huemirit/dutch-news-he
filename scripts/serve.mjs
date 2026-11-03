import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { detectSiteUrl } from './qr.mjs';

const root = path.resolve(process.cwd(), 'site');
const port = Number(process.env.PORT) || 8787;
const host = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match) return 'invalid';
  const startRaw = match[1];
  const endRaw = match[2];
  if (!startRaw && !endRaw) return 'invalid';
  let start;
  let end;
  if (!startRaw) {
    const suffix = Number(endRaw);
    if (!Number.isFinite(suffix) || suffix <= 0) return 'invalid';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startRaw);
    end = endRaw ? Number(endRaw) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid';
  if (start > end || start >= size) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-cache',
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'method not allowed', { allow: 'GET, HEAD' });
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    send(response, 400, 'bad request');
    return;
  }

  let file = path.resolve(root, `.${pathname}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    send(response, 403, 'forbidden');
    return;
  }
  if (pathname.endsWith('/')) file = path.join(file, 'index.html');

  let stats;
  try {
    stats = fs.statSync(file);
    if (stats.isDirectory()) {
      file = path.join(file, 'index.html');
      stats = fs.statSync(file);
    }
  } catch {
    send(response, 404, 'not found');
    return;
  }

  const extension = path.extname(file).toLowerCase();
  const headers = {
    'content-type': contentType(file),
    'accept-ranges': 'bytes',
    'cache-control':
      extension === '.html' || extension === '.xml' || extension === '.json'
        ? 'no-cache, must-revalidate'
        : 'public, max-age=3600',
  };

  let status = 200;
  let start = 0;
  let end = stats.size - 1;

  if (request.headers.range) {
    const range = parseRange(request.headers.range, stats.size);
    if (range === 'invalid') {
      send(response, 416, 'range not satisfiable', {
        'content-range': `bytes */${stats.size}`,
        'accept-ranges': 'bytes',
      });
      return;
    }
    start = range.start;
    end = range.end;
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${stats.size}`;
  }

  headers['content-length'] = String(end - start + 1);

  if (request.method === 'HEAD' || stats.size === 0) {
    response.writeHead(status, headers);
    response.end();
    return;
  }

  response.writeHead(status, headers);
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => response.destroy());
  stream.pipe(response);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`port ${port} is already in use`);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`dutch-news-he serving ${root}`);
  console.log(`local: http://localhost:${port}/`);
  console.log(`lan:   ${detectSiteUrl(port)}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
