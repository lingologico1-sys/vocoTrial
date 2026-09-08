import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Stamps the bundle with which deployment it is.
 *
 * The commit alone is not enough to track redeploys: retrying a build, or
 * changing a secret and redeploying, produces a new deployment from the *same*
 * commit. So the badge carries a build id beside the commit.
 *
 * WORKERS_CI_* ARE THE POST-PAGES NAMES. Workers Builds sets its own three
 * variables, and none of them is a URL: under Pages the deployment id had to be
 * dug out of CF_PAGES_URL's first hostname label
 * (https://1147a89d.vocotrial.pages.dev), because that was the only place
 * Cloudflare exposed it. Workers Builds hands over WORKERS_CI_BUILD_UUID
 * directly, and it is sliced to eight characters purely to match the width the
 * badge was already drawn for.
 *
 * The CF_PAGES_* fallbacks are kept deliberately, and cost one `??` each: a
 * build run from the old Pages project — or from a branch predating the
 * migration — still stamps a correct badge rather than a blank one. Drop them
 * once the Pages project is deleted.
 *
 * Every field falls back rather than throwing, so a local build still produces
 * a usable badge.
 */
function buildInfo() {
  const pagesUrl = process.env.CF_PAGES_URL ?? '';
  const deploy =
    process.env.WORKERS_CI_BUILD_UUID?.slice(0, 8) ??
    /^https?:\/\/([0-9a-f]{8})\./.exec(pagesUrl)?.[1] ??
    null;
  const commit =
    (process.env.WORKERS_CI_COMMIT_SHA ?? process.env.CF_PAGES_COMMIT_SHA)?.slice(0, 7) ??
    null;

  return {
    // What the badge leads with. The commit, because the question actually
    // being asked of the badge is "is what I just pushed what I am looking
    // at", and that is answered by comparing it against `git log` rather than
    // against anything a person can hold in their head. The deployment id is
    // still shown, next to it — see App.tsx — so redeploys of one commit stay
    // distinguishable. Locally, neither exists and the build time stands in,
    // which at least makes a stale tab obvious.
    label: commit ?? deploy ?? new Date().toISOString().slice(11, 16),
    deploy,
    commit,
    branch: process.env.WORKERS_CI_BRANCH ?? process.env.CF_PAGES_BRANCH ?? null,
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
    //
    // The two are further apart than they were. `wrangler pages dev` could put
    // this dev server behind it and keep HMR; `wrangler dev` has no equivalent,
    // so dev:api now builds first and serves the built bundle — correct, but
    // with no hot reload. Edit against `npm run dev` and switch over when the
    // change reaches functions/.
    port: 5173,
  },
});
