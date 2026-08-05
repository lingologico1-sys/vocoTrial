import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Stamps the bundle with which deployment it is.
 *
 * The commit alone is not enough to track redeploys: retrying a build, or
 * changing a dashboard secret and redeploying, produces a new deployment from
 * the *same* commit. Cloudflare exposes the deployment only through
 * CF_PAGES_URL, whose first hostname label is the deployment's short id
 * (https://1147a89d.vocotrial.pages.dev), so that is where the id comes from.
 *
 * Every field falls back rather than throwing, so a local build still produces
 * a usable badge.
 */
function buildInfo() {
  const url = process.env.CF_PAGES_URL ?? '';
  const deploy = /^https?:\/\/([0-9a-f]{8})\./.exec(url)?.[1] ?? null;
  const commit = process.env.CF_PAGES_COMMIT_SHA?.slice(0, 7) ?? null;

  return {
    // What the badge shows. On Pages this is the deployment; locally, the
    // build time, so a stale tab is still obvious.
    label: deploy ?? commit ?? new Date().toISOString().slice(11, 16),
    deploy,
    commit,
    branch: process.env.CF_PAGES_BRANCH ?? null,
    builtAt: new Date().toISOString(),
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo()),
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
