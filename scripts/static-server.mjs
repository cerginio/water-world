import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, relative, extname, isAbsolute } from 'node:path';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

// Only serves the artifact directory. No Vite config or Tilecraft checkout access.
export async function serveDist({ directory, base = '/', port = 0, host = '127.0.0.1' }) {
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD' }); return response.end();
      }
      const pathname = decodeURIComponent(new URL(request.url, 'http://static.invalid').pathname);
      if (pathname === '/favicon.ico') { response.writeHead(204); return response.end(); }
      if (!pathname.startsWith(base)) throw new Error('outside base');
      // a folder (products/story-quest/) is served by its index.html, as on Netlify
      const part = `${pathname.slice(base.length)}${pathname.endsWith('/') ? 'index.html' : ''}` || 'index.html';
      const filename = resolve(directory, part);
      const rel = relative(directory, filename);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\')) throw new Error('outside dist');
      const bytes = await readFile(filename);
      response.writeHead(200, { 'Content-Type': types[extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found');
    }
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, host, accept); });
  return { url: `http://${host}:${server.address().port}${base}`, close: () => new Promise((accept, reject) => {
    server.close(error => error ? reject(error) : accept());
    server.closeAllConnections();
  }) };
}
