export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',');

export function validateImageFile(file) {
  if (!file || !IMAGE_TYPES.includes(file.type)) {
    throw new Error('Choose a JPG, PNG, WebP or GIF image.');
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('This image is empty. Choose another photo.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error('Choose an image smaller than 10 MB.');
  }
  return file;
}

function abortError() {
  const error = new Error('Image upload cancelled.');
  error.name = 'AbortError';
  return error;
}

function uploadedUrl(value) {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password
      ? value : '';
  } catch { return ''; }
}

// Only the returned public image URL is saved in Firebase. The file goes to ImgBB.
// Factories and apiKey can be supplied by tests without making network requests.
export function uploadImageToImgbb(file, onProgress, options = {}) {
  return new Promise((resolve, reject) => {
    let xhr;
    let settled = false;
    const { signal } = options;
    const notifyProgress = value => {
      if (typeof onProgress === 'function') {
        try { onProgress(value); } catch { /* Progress does not affect the upload. */ }
      }
    };
    const abort = () => {
      if (settled) return;
      // Detach handlers before aborting to prevent a second completion callback.
      finish(abortError());
      xhr?.abort();
    };
    const finish = (error, url) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      if (xhr) {
        xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
        if (xhr.upload) xhr.upload.onprogress = null;
      }
      if (error) reject(error);
      else { notifyProgress(100); resolve(url); }
    };

    try {
      validateImageFile(file);
      const apiKey = String(options.apiKey ?? import.meta.env?.VITE_IMGBB_API_KEY ?? '').trim();
      if (!apiKey) throw new Error('Photo uploads are unavailable. Add the ImgBB key and restart the server.');
      if (signal?.aborted) throw abortError();
      xhr = options.xhrFactory ? options.xhrFactory() : new XMLHttpRequest();
      const formData = options.formDataFactory ? options.formDataFactory() : new FormData();
      formData.append('image', file);
      xhr.open('POST', `https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`);
      xhr.timeout = 90_000;
      xhr.upload.onprogress = event => {
        if (event.lengthComputable && event.total > 0) {
          notifyProgress(Math.min(100, Math.max(0, Math.round(event.loaded / event.total * 100))));
        }
      };
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          const message = xhr.status === 429 ? 'Too many photo uploads. Wait a moment and retry.'
            : xhr.status === 413 ? 'This image is too large. Choose a smaller photo.'
              : 'The photo service could not accept the upload. Retry or choose another image.';
          finish(new Error(message));
          return;
        }
        try {
          const data = JSON.parse(xhr.responseText);
          const url = uploadedUrl(data?.data?.url);
          if (data?.success !== true || !url) {
            finish(new Error('The photo service did not return an image link. Please retry.'));
            return;
          }
          finish(null, url);
        } catch {
          finish(new Error('The photo service returned an invalid response. Please retry.'));
        }
      };
      xhr.onerror = () => finish(new Error('Photo upload failed. Check your connection and retry.'));
      xhr.ontimeout = () => finish(new Error('Photo upload timed out. Check your connection and retry.'));
      xhr.onabort = () => finish(abortError());
      signal?.addEventListener('abort', abort, { once: true });
      notifyProgress(0);
      xhr.send(formData);
    } catch (error) {
      const knownError = !xhr || error.name === 'AbortError';
      finish(knownError ? error : new Error('The photo upload could not start. Please retry.'));
    }
  });
}
