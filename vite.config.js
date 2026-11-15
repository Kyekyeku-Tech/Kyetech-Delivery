import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createDeliverySmsMiddleware } from './server/sms.mjs';
import { createFirestoreSmsStore } from './server/firestoreSmsStore.mjs';
import { createGpsAddressMiddleware } from './server/gpsAddress.mjs';
import { createAdminOtpMiddleware } from './server/adminOtp.mjs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const define = {};
  for (const suffix of ['API_KEY', 'AUTH_DOMAIN', 'PROJECT_ID', 'STORAGE_BUCKET', 'MESSAGING_SENDER_ID', 'APP_ID']) {
    define[`import.meta.env.VITE_FIREBASE_${suffix}`] = JSON.stringify(env[`VITE_FIREBASE_${suffix}`] || env[`NEXT_PUBLIC_FIREBASE_${suffix}`] || '');
  }
  return {
    plugins: [react(), {
      name: 'delivery-sms-api',
      configureServer(server) {
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
