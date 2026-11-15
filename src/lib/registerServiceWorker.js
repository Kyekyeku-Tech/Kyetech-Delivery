const attempts = new WeakMap();
const setupMessage = 'Phone notifications could not start. Check your connection and turn alerts on again.';

function startRegistration(container) {
  if (attempts.has(container)) return attempts.get(container);
  const attempt = Promise.resolve().then(() => container.register('/sw.js', { scope: '/', updateViaCache: 'none' }));
  attempts.set(container, attempt);
  const clear = () => { if (attempts.get(container) === attempt) attempts.delete(container); };
  attempt.then(clear, clear);
  return attempt;
}

export async function ensureServiceWorker({ container = navigator.serviceWorker, timeoutMs = 30000 } = {}) {
  if (!container?.register) throw new Error(setupMessage);
  let timer, registrationAttempt, finished = false;
  const cleanup = [];
  try {
    return await Promise.race([
      (async () => {
        let registration = await container.getRegistration?.('/');
        if (finished) throw new Error(setupMessage);
        if (registration?.active?.state === 'activated') return registration;
        registrationAttempt = startRegistration(container);
        registration = await registrationAttempt;
        if (finished) throw new Error(setupMessage);
        if (registration.active?.state === 'activated') return registration;
        return await new Promise((resolve, reject) => {
          const watched = new Set();
          function check() {
            if (registration.active?.state === 'activated') { resolve(registration); return; }
            const worker = registration.installing || registration.waiting || registration.active;
            if (worker && !watched.has(worker)) {
              watched.add(worker); worker.addEventListener('statechange', check);
              cleanup.push(() => worker.removeEventListener('statechange', check));
            }
            if (worker?.state === 'redundant' || (!worker && [...watched].some(candidate => candidate.state === 'redundant'))) reject(new Error(setupMessage));
          }
          registration.addEventListener('updatefound', check);
          cleanup.push(() => registration.removeEventListener('updatefound', check));
          check();
        });
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(setupMessage)), timeoutMs); }),
    ]);
  } catch { throw new Error(setupMessage); }
  finally {
    finished = true; clearTimeout(timer); cleanup.forEach(remove => remove());
    if (attempts.get(container) === registrationAttempt) attempts.delete(container);
  }
}

export function registerServiceWorker() {
  if (!import.meta.env?.PROD || typeof window === 'undefined'
    || !window.isSecureContext || !('serviceWorker' in navigator)) return;

  return startRegistration(navigator.serviceWorker).catch((error) => {
    console.warn('KyeTech Delivery could not enable app installation.', error);
  });

}
