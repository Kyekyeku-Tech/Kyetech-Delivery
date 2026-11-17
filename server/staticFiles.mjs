import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { isAppPathname } from '../src/lib/appRoutes.js';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(request, response, status, content, type = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(content), 'X-Content-Type-Options': 'nosniff' });
  response.end(request.method === 'HEAD' ? undefined : content);
}

export function createStaticFileHandler({ publicDir }) {
  const directory = resolve(publicDir), indexFile = resolve(directory, 'index.html');
  return async function staticFiles(request, response) {
    let rawPathname, pathname;
    try {
      rawPathname = (request.url || '/').split(/[?#]/, 1)[0];
      if (!rawPathname.startsWith('/')) throw new URIError();
      pathname = decodeURIComponent(rawPathname);
      if (pathname.includes('\0')) throw new URIError();
    } catch { return send(request, response, 400, 'Bad request.'); }
    if (pathname.includes('\\') || pathname.split('/').includes('..')) return send(request, response, 403, 'Forbidden.');
    const file = resolve(directory, `.${pathname}`);
    if (file !== directory && !file.startsWith(directory + sep)) return send(request, response, 403, 'Forbidden.');
    if (pathname === '/api' || pathname.startsWith('/api/')) return send(request, response, 404, '{"error":"Not found"}', 'application/json; charset=utf-8');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return send(request, response, 405, 'Method not allowed.');
    }
    try {
      let target = file, exists = false, status = pathname === '/404.html' ? 404 : 200;
      try { exists = (await stat(file)).isFile(); }
      catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
      if (!exists) {
        const extension = extname(pathname).toLowerCase();
        const documentRequest = request.headers.accept?.includes('text/html');
        const assetPath = ['/assets', '/images'].some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
        if (assetPath || (extension && extension !== '.html' && !documentRequest)) return send(request, response, 404, 'Not found.');
        target = indexFile;
        status = isAppPathname(rawPathname) ? 200 : 404;
      }
      const content = await readFile(target);
      if (pathname === '/sw.js' || pathname === '/manifest.webmanifest') response.setHeader('Cache-Control', 'no-cache');
      if (status === 404) response.setHeader('Cache-Control', 'no-store');
      return send(request, response, status, content, types[extname(target).toLowerCase()] || 'application/octet-stream');
    } catch (error) {
      const missingBuild = error.code === 'ENOENT' || error.code === 'ENOTDIR';
      return send(request, response, missingBuild ? 503 : 500, missingBuild ? 'Build the app with npm run build before starting the server.' : 'Unable to serve this request.');
    }
  };
}
