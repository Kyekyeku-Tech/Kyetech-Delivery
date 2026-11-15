export function registerServiceWorker() {
  if (!import.meta.env?.PROD || typeof window === 'undefined'
    || !window.isSecureContext || !('serviceWorker' in navigator)) return;

  const register = () => navigator.serviceWorker.register('/sw.js', {
    scope: '/',
    updateViaCache: 'none',
  }).catch((error) => {
    console.warn('KyeTech Delivery could not enable app installation.', error);
  });

  if (document.readyState === 'complete') return register();
  window.addEventListener('load', register, { once: true });
}
