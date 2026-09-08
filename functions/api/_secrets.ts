/**
 * Turns Secrets Store bindings back into strings, once per request.
 *
 * WHY THIS HAS TO EXIST. A secret bound from the account's Secrets Store does
 * not arrive as a string — `env.OPENAI_API_KEY` is an object with an async
 * `get()`. Every handler in this app was written against strings and there are
 * about twenty such reads, so the choice was to rewrite all of them or to
 * resolve once in front of them. This is the second, and it is only available
 * because functions/api/_middleware.ts already sits in front of every /api/*
 * route. bannerMaker resolves per handler instead, for the opposite reason: it
 * has no middleware to hang this on.
 *
 * IT MUTATES `env`, WHICH IS DELIBERATE AND IS THE WHOLE TRICK. The Pages
 * Functions template hands the *same* env object to the middleware and to every
 * handler below it, so a copy — which is what bannerMaker returns — would be
 * seen by nobody. Assigning onto it is what lets the handlers stay unchanged.
 *
 * THE ORIGINAL BINDINGS ARE KEPT ASIDE, because that assignment destroys them:
 * after the first request `env.NAME` is a string, and a naive implementation
 * would have no way back to the store and would serve that first value until
 * the isolate died. `bindings` below is that way back, which is what makes a
 * rotated secret take effect while the isolate is still warm.
 *
 * A SHORT TTL, not a read per request and not a permanent cache. A store read
 * on every call would add a round trip to routes that are already relaying
 * audio; caching forever would mean rotating SITE_PASSWORD did nothing until
 * Cloudflare happened to recycle the isolate. Sixty seconds is the compromise:
 * a rotation takes effect within a minute, and a busy minute costs one read.
 *
 * NOTHING HERE IS NEEDED LOCALLY. .dev.vars supplies plain strings, `resolve`
 * leaves strings alone, and there is no store to read — so local development is
 * unchanged and both configurations stay supported.
 */

/** What a Secrets Store binding looks like once bound. */
interface SecretsStoreBinding {
  get(): Promise<string>;
}

/**
 * The names that may arrive as either a string or a binding.
 *
 * AN EXPLICIT ALLOWLIST, copied from bannerMaker along with the reason: the
 * tempting shortcut is to treat any env value with a `get()` method as a secret,
 * and that also matches every R2 bucket in wrangler.toml, whose `get(key)` means
 * something entirely different and would be called here with no argument.
 *
 * Adding a `[[secrets_store_secrets]]` block to wrangler.toml means adding its
 * binding name here too. A name that is missing here is simply never resolved,
 * and reads as "not configured" — which is a confusing way to discover this.
 *
 * The Vertex service accounts are NOT here and cannot be: a store value is
 * capped at 1024 characters and a service-account JSON is about 2.3 KB. They
 * stay ordinary Worker secrets. See _vertex.ts.
 */
const SECRET_BINDING_NAMES = [
  'SITE_PASSWORD',
  'OPENAI_API_KEY',
  'ELEVENLABS_API_KEY',
  'LIPSYNC_URL',
  'LIPSYNC_API_KEY',
] as const;

/** The bindings as first seen, before `env` was written over. Per isolate. */
const bindings = new Map<string, SecretsStoreBinding>();

/** Resolved values and when they were read. Per isolate. */
const cache = new Map<string, { value: string; readAt: number }>();

const TTL_MS = 60_000;

function isBinding(value: unknown): value is SecretsStoreBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<SecretsStoreBinding>).get === 'function'
  );
}

/**
 * Replaces every bound secret in `env` with its string value.
 *
 * THROWS if a binding will not read, and the caller must turn that into a 503
 * rather than carrying on. Treating an unreadable secret as unset would fail
 * OPEN in the worst possible place: hasValidSession returns false when
 * SITE_PASSWORD is missing, which is safe, but auth/status.ts reports
 * `configured: false` and the sign-in screen then tells the user the deployment
 * has no password — an outage that reads like an invitation.
 */
export async function resolveSecrets(env: Record<string, unknown>): Promise<void> {
  const now = Date.now();

  await Promise.all(
    SECRET_BINDING_NAMES.map(async (name) => {
      const current = env[name];

      // First sight of a real binding: remember it before it is overwritten.
      if (isBinding(current)) bindings.set(name, current);

      const binding = bindings.get(name);

      // No binding was ever seen, so this name is a plain string from
      // .dev.vars or `wrangler secret`, or is absent. Either way, leave it.
      if (!binding) return;

      const hit = cache.get(name);
      if (hit && now - hit.readAt < TTL_MS) {
        env[name] = hit.value;
        return;
      }

      const value = await binding.get();
      if (typeof value !== 'string') {
        throw new Error(`Secrets Store returned no value for ${name}`);
      }
      cache.set(name, { value, readAt: now });
      env[name] = value;
    }),
  );
}
