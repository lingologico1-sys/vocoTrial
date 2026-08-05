/// <reference types="vite/client" />

/**
 * Injected by vite.config.ts. `label` is what the corner badge renders — the
 * Cloudflare deployment id in production, so a redeploy of the same commit is
 * still distinguishable.
 */
declare const __BUILD_INFO__: {
  label: string;
  deploy: string | null;
  commit: string | null;
  branch: string | null;
  builtAt: string;
};
