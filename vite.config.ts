import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // Cloudflare Pages sets CF_PAGES_COMMIT_SHA on every build, so a deployed
    // page can say which commit it is. Locally there is no commit yet, so
    // stamp the build time instead.
    __APP_VERSION__: JSON.stringify(
      process.env.CF_PAGES_COMMIT_SHA
        ? process.env.CF_PAGES_COMMIT_SHA.slice(0, 7)
        : new Date().toISOString().replace(/T/, ' ').replace(/\..+/, ''),
    ),
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    // `npm run dev` alone serves the SPA but not functions/, so /api/* 404s.
    // `npm run dev:api` runs both behind wrangler and is what you want when
    // touching the session endpoints.
    port: 5173,
  },
});
