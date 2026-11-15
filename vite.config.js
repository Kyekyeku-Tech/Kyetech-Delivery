import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createDeliverySmsMiddleware } from './server/sms.mjs';
import { createFirestoreSmsStore } from './server/firestoreSmsStore.mjs';
import { createGpsAddressMiddleware } from './server/gpsAddress.mjs';
import { createAdminOtpMiddleware } from './server/adminOtp.mjs';
import { createRiderAlertsMiddleware } from './server/riderAlerts.mjs';

function deliveryPwa() {
  return {
    name: 'delivery-pwa',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const publicFiles = [
        '/offline.html',
        '/manifest.webmanifest',
        '/images/pwa/icon-192.png',
        '/images/pwa/icon-512.png',
        '/images/pwa/icon-maskable-512.png',
      ];
      const builtAssets = Object.keys(bundle)
        .filter((fileName) => fileName.startsWith('assets/') && /\.(?:js|css|png|jpe?g|svg|webp|gif|woff2?)$/i.test(fileName))
        .sort();
      const workerTemplate = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8');
      const version = createHash('sha256').update(workerTemplate);
      for (const fileName of builtAssets) {
        const asset = bundle[fileName];
        version.update(fileName).update(asset.type === 'chunk' ? asset.code : asset.source);
      }
      for (const pathname of publicFiles) {
        version.update(pathname).update(readFileSync(new URL(`./public${pathname}`, import.meta.url)));
      }
      const source = workerTemplate
        .replace('__KYETECH_PWA_CACHE_VERSION__', version.digest('hex').slice(0, 16))
        .replace('/* __KYETECH_PWA_PRECACHE__ */ []', JSON.stringify([...publicFiles, ...builtAssets.map((fileName) => `/${fileName}`)]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const define = {};
  for (const suffix of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']) {
    define[`import.meta.env.VITE_FIREBASE_${suffix}`] = JSON.stringify(env[`VITE_FIREBASE_${suffix}`] || env[`NEXT_PUBLIC_FIREBASE_${suffix}`] || '');
  }
  return {
    plugins: [react(), deliveryPwa(), {
      name: 'delivery-sms-api',
      configureServer(server) {
        server.middlewares.use('/api/rider-alerts', createRiderAlertsMiddleware({ projectId: env.VITE_FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }));
        server.middlewares.use('/api/admin-otp', createAdminOtpMiddleware({ projectId: env.VITE_FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, apiKey: env.MOJOAUTH_API_KEY, serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON }));
        server.middlewares.use('/api/gps-address', createGpsAddressMiddleware({ projectId: env.VITE_FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID }));
        server.middlewares.use('/api/delivery-sms', createDeliverySmsMiddleware({
          projectId: env.VITE_FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          apiKey: env.VITE_MNOTIFY_API_KEY,
          appUrl: env.SMS_APP_URL || 'https://kyetechdelivery.site',
          storeFactory: createFirestoreSmsStore,
        }));
      },
    }],
    envPrefix: ['VITE_FIREBASE_', 'VITE_IMGBB_', 'VITE_USE_FIREBASE_EMULATORS'],
    define,
    resolve: { dedupe: ['react', 'react-dom', 'firebase', '@firebase/app', '@firebase/component', '@firebase/util'] },
    optimizeDeps: { include: ['firebase/app', 'firebase/auth', 'firebase/firestore'] },
    server: { port: 5173, watch: { ignored: ['**/.verification/**'] } },
    build: {
      outDir: 'dist',
      rollupOptions: { output: { manualChunks: {
        maps: ['leaflet'],
        'firebase-core': ['firebase/app'],
        'firebase-auth': ['firebase/auth'],
        'firebase-firestore': ['firebase/firestore'],
      } } },
    },
  };
});
