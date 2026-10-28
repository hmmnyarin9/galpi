import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../site/dist/', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.exe': 'application/octet-stream' };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!target.startsWith(root)) { response.writeHead(403).end(); return; }
    const content = await readFile(target);
    response.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream', 'content-length': content.length });
    response.end(content);
  } catch { response.writeHead(404).end('Not found'); }
}).listen(1421, '127.0.0.1', () => console.log('Galpi site: http://127.0.0.1:1421/'));
