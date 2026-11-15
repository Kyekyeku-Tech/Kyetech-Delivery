import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_TYPES, MAX_IMAGE_BYTES, uploadImageToImgbb, validateImageFile } from '../src/lib/imageUpload.js';

const file = { type: 'image/png', size: 2048 };
const imageUrl = 'https://i.ibb.co/example/profile.png';

function fixture() {
  const xhr = {
    upload: {}, status: 200, responseText: '', aborted: false,
    open(method, url) { this.method = method; this.url = url; },
    send(data) { this.data = data; },
    abort() { this.aborted = true; this.onabort?.(); },
  };
  const formData = { entries: [], append(...entry) { this.entries.push(entry); } };
  const options = { apiKey: 'test-key', xhrFactory: () => xhr, formDataFactory: () => formData };
  const respond = (data = { success: true, data: { url: imageUrl } }, status = 200) => {
    xhr.status = status; xhr.responseText = JSON.stringify(data); xhr.onload();
  };
  return { xhr, formData, options, respond };
}

function assertCleaned(xhr) {
  for (const handler of ['onload', 'onerror', 'ontimeout', 'onabort']) assert.equal(xhr[handler], null);
  assert.equal(xhr.upload.onprogress, null);
}

test('image uploads accept supported formats and reject oversized, empty and SVG files before sending', async () => {
  for (const type of IMAGE_TYPES) assert.equal(validateImageFile({ ...file, type }).type, type);
  assert.equal(validateImageFile({ ...file, size: MAX_IMAGE_BYTES }).size, MAX_IMAGE_BYTES);
  for (const invalid of [null, { ...file, type: 'image/svg+xml' }, { ...file, type: 'text/plain' }, { ...file, size: 0 }, { ...file, size: Infinity }, { ...file, size: MAX_IMAGE_BYTES + 1 }]) {
    let started = false;
    await assert.rejects(uploadImageToImgbb(invalid, null, { apiKey: 'test-key', xhrFactory() { started = true; } }));
    assert.equal(started, false);
  }
});

test('XHR reports upload progress and resolves the public URL without returning the response data', async () => {
  const { xhr, formData, options, respond } = fixture();
  const progress = [];
  const result = uploadImageToImgbb(file, percent => progress.push(percent), options);
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, 'https://api.imgbb.com/1/upload?key=test-key');
  assert.equal(xhr.timeout, 90_000);
  assert.equal(xhr.data, formData);
  assert.deepEqual(formData.entries, [['image', file]]);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 1, total: 4 });
  xhr.upload.onprogress({ lengthComputable: false, loaded: 1, total: 4 });
  xhr.upload.onprogress({ lengthComputable: true, loaded: 6, total: 4 });
  respond({ success: true, data: { url: imageUrl, delete_url: 'https://example.com/private-delete' } });
  assert.equal(await result, imageUrl);
  assert.deepEqual(progress, [0, 25, 100, 100]);
  assertCleaned(xhr);
});

test('failed HTTP requests cannot be treated as successful uploads', async () => {
  for (const status of [0, 400, 401, 413, 429, 500]) {
    const { xhr, options, respond } = fixture();
    const result = uploadImageToImgbb(file, null, options);
    respond({ success: true, data: { url: imageUrl } }, status);
    await assert.rejects(result, /upload|image|photo/i);
    assertCleaned(xhr);
  }
});

test('malformed responses, service errors and unsafe URLs never resolve a profile URL', async () => {
  for (const response of [null, { success: false, error: { message: 'secret-response-content' } }, { success: true }, { success: true, data: { url: 'javascript:alert(1)' } }, { success: true, data: { url: '/images/photo.png' } }, { success: true, data: { url: 'https://user:password@example.com/photo.png' } }, { success: true, data: { url: 'data:image/png;base64,abc' } }]) {
    const { options, respond, xhr } = fixture();
    const result = uploadImageToImgbb(file, null, options);
    respond(response);
    await assert.rejects(result, error => !error.message.includes('secret-response-content'));
    assertCleaned(xhr);
  }
  const { xhr, options } = fixture();
  const result = uploadImageToImgbb(file, null, options);
  xhr.responseText = '<html>private service response</html>'; xhr.onload();
  await assert.rejects(result, /invalid response/);
  assertCleaned(xhr);
});

test('network failures and timeouts reject, clean up handlers, and allow a fresh retry', async () => {
  for (const event of ['onerror', 'ontimeout']) {
    const { xhr, options } = fixture();
    const result = uploadImageToImgbb(file, null, options);
    xhr[event]();
    await assert.rejects(result, /connection|timed out/);
    assertCleaned(xhr);
  }
  const retry = fixture();
  const result = uploadImageToImgbb(file, null, retry.options);
  retry.respond();
  assert.equal(await result, imageUrl);
});

test('AbortSignal stops an active XHR and detaches all event handlers', async () => {
  const controller = new AbortController();
  const { xhr, options } = fixture();
  const result = uploadImageToImgbb(file, null, { ...options, signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(xhr.aborted, true);
  assertCleaned(xhr);
  const alreadyAborted = fixture();
  await assert.rejects(uploadImageToImgbb(file, null, { ...alreadyAborted.options, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(alreadyAborted.xhr.method, undefined);
});

test('missing configuration and synchronous XHR failures use safe errors', async () => {
  await assert.rejects(uploadImageToImgbb(file, null, { apiKey: '' }), /ImgBB key/);
  const { xhr, options } = fixture();
  xhr.send = () => { throw new Error('private key and response'); };
  await assert.rejects(uploadImageToImgbb(file, null, options), error => error.message === 'The photo upload could not start. Please retry.');
  assertCleaned(xhr);
});
