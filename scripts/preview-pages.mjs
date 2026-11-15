import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { root } from './lib/files.mjs';

// QA server: deliberately serve the production build under a repository path.
const directory = path.resolve(root, 'dist');
const mount = '/ger-archive/';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/plain; charset=utf-8',
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (!url.pathname.startsWith(mount)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const relative = decodeURIComponent(url.pathname.slice(mount.length)) || 'index.html';
    const file = path.resolve(directory, relative);
    if (!file.startsWith(directory + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});
server.listen(4173, '127.0.0.1', () =>
  console.log(`Pages QA preview: http://127.0.0.1:4173${mount}`),
);
