import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { createStaticFileHandler } from '../server/staticFiles.mjs';

const shell = '<!doctype html><html><body><div id="root"></div></body></html>';
const temporaryPrefix = resolve(tmpdir(), 'kyetech-not-found-');
let directory, server, port;
before(async () => {
  directory = await mkdtemp(temporaryPrefix);
  await mkdir(resolve(directory, 'assets'));
  await writeFile(resolve(directory, 'index.html'), shell);
  await writeFile(resolve(directory, '404.html'), shell);
  await writeFile(resolve(directory, 'assets', 'app.js'), 'export const ready = true;');
  await writeFile(resolve(directory, 'sw.js'), '// service worker');
  await writeFile(resolve(directory, 'manifest.webmanifest'), '{}');
  server = createServer(createStaticFileHandler({ publicDir: directory }));
  await new Promise((ready, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', ready); });
  port = server.address().port;
});
after(async () => {
  if (server?.listening) await new Promise(done => server.close(done));
  if (directory) {
    assert.ok(directory.startsWith(temporaryPrefix), 'Cleanup stays inside this test temporary directory.');
    await rm(directory, { recursive: true, force: true });
  }
});
function request(path, method = 'GET', headers = {}) {
  return new Promise((done, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, path, method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => done({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('known application routes keep the app shell and HTTP 200', async () => {
  for (const path of ['/', '/index.html', '/admin', '/admin/', '/admin/access', '/admin/orders/', '/review', '/review/', '/%61dmin', '/?store=example']) {
    const result = await request(path);
    assert.equal(result.status, 200, path);
    assert.match(result.headers['content-type'], /^text\/html/);
    assert.equal(result.body, shell);
  }
});

test('unknown document routes receive the app shell with HTTP 404', async () => {
  for (const path of ['/404', '/404.html', '/missing', '/admin/settings', '/missing.html', '/missing?ref=store', '/%2561dmin']) {
    const result = await request(path);
    assert.equal(result.status, 404, path);
    assert.match(result.headers['content-type'], /^text\/html/);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.equal(result.body, shell);
  }
  const dottedPage = await request('/a.mistyped.page', 'GET', { Accept: 'text/html' });
  assert.equal(dottedPage.status, 404);
  assert.equal(dottedPage.body, shell);
});

test('missing assets and unknown APIs do not receive the app shell', async () => {
  for (const path of ['/assets/missing.js', '/assets/missing', '/images/missing.png', '/missing.png', '/sw-missing.js', '/manifest-missing.webmanifest']) {
    const result = await request(path);
    assert.equal(result.status, 404, path);
    assert.match(result.headers['content-type'], /^text\/plain/);
    assert.equal(result.body, 'Not found.');
  }
  const result = await request('/api/missing');
  assert.equal(result.status, 404);
  assert.match(result.headers['content-type'], /^application\/json/);
  assert.deepEqual(JSON.parse(result.body), { error: 'Not found' });
  assert.equal((await request('/api/missing', 'POST')).status, 404);
});

test('existing assets preserve their content type and PWA cache controls', async () => {
  const result = await request('/assets/app.js');
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-type'], 'application/javascript');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.body, 'export const ready = true;');
  for (const path of ['/sw.js', '/manifest.webmanifest']) {
    const asset = await request(path);
    assert.equal(asset.status, 200, path);
    assert.equal(asset.headers['cache-control'], 'no-cache');
  }
});

test('malformed paths return 400 and traversal paths return 403', async () => {
  for (const path of ['/%broken', '/%00']) assert.equal((await request(path)).status, 400, path);
  for (const path of ['/../outside', '/%2e%2e/outside', '/%5c..%5coutside']) assert.equal((await request(path)).status, 403, path);
});

test('HEAD returns matching statuses and headers with no response body', async () => {
  for (const path of ['/', '/missing', '/assets/app.js', '/missing.png', '/api/missing', '/%broken', '/%2e%2e/outside']) {
    const get = await request(path), head = await request(path, 'HEAD');
    assert.equal(head.status, get.status, path);
    assert.equal(head.headers['content-type'], get.headers['content-type'], path);
    assert.equal(Number(head.headers['content-length']), Buffer.byteLength(get.body), path);
    assert.equal(head.body, '', path);
  }
});

test('unsupported static methods return 405 with the allowed methods', async () => {
  const result = await request('/missing', 'POST');
  assert.equal(result.status, 405);
  assert.equal(result.headers.allow, 'GET, HEAD');
});
