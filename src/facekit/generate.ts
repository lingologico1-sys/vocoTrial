import {
  FULL_FRAME,
  clipToBase,
  cropToBox,
  featherPatch,
  flattenBackground,
  matchTone,
  maskFor,
  normalise,
} from './canvas';
import { beginRun, type RunHandle } from './runLog';
import { findImageModel } from './imageModels';
import { chinClearance, type MouthBox } from './kit';
import { PREAMBLE } from './slots';

/**
 * One round trip: ask a provider for an edit, come back with a patch.
 *
 * The sequencing here is the whole method, so it is worth naming the steps
 * rather than leaving them as four awaits. Ask for a full frame; normalise it
 * onto the standard square; cut out only the box that was asked about; pull its
 * colour onto the base's. What comes back is a rectangle, never a portrait —
 * the portrait on screen is still the one that was uploaded.
 */

export interface Generated {
  /** The patch, cropped to `box` and tone-matched. A PNG data URL. */
  patch: string;
  /** The provider's whole frame, kept only so the page can show its working. */
  full: string;
  usd: number;
  /**
   * How much of the prompt the provider served from an implicit cache, in
   * tokens. Reported, never billed on — `usd` is a flat per-image list price
   * that already excludes the input's tokens, so there is nothing for a cache
   * discount to come off. It is here to answer whether sending the portrait
   * first buys anything, which is otherwise a matter of opinion.
   */
  cached: number;
}

interface GenerateArgs {
  modelKey: string;
  base: string;
  /**
   * Typed as the wider of the two rectangles, which every box already satisfies.
   *
   * The mouth's is the only one carrying a measurement inside it, and an eye box
   * meets this type by not carrying one — which is exactly what `chinClearance`
   * reads it as. The alternative was a plain `Box` here and the chin surviving
   * only at runtime, so the one line that uses it would look like dead code.
   */
  box: MouthBox;
  /** The slot's instruction. The shared preamble is added here, not by callers. */
  instruction: string;
  /** What to call this run in the diagnostics panel. The slot's own label. */
  label: string;
  /**
   * Send the portrait ahead of the instruction. Gemini only — see the route.
   *
   * Carried as an argument rather than settled here because it is the thing
   * being compared: the same slot, generated both ways, judged side by side on
   * the page. Absent means the order this app has always sent.
   */
  imageFirst?: boolean;
  signal?: AbortSignal;
  onAttempt?: OnAttempt;
}

/**
 * A failed generation, with enough on it to decide whether trying again is
 * sensible or merely expensive-looking.
 */
export class GenerateError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly reason?: string,
    /** The provider's own stated wait, when it gave one. Milliseconds. */
    readonly retryAfterMs?: number,
    /**
     * What the provider itself answered, when the Worker knew.
     *
     * Distinct from `status`, which is the Worker's own — and the Worker turns
     * every upstream failure into a 502, so without this the log would call a
     * spent quota and a refused picture by the same number. Nothing branches on
     * it; it exists to be read.
     */
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = 'GenerateError';
  }

  /**
   * Worth another go.
   *
   * Only the statuses that mean "not now" rather than "not like that". A 400 is
   * the request being wrong and will be wrong again in a minute; a 502 is the
   * provider declining or falling over, which is the case actually observed to
   * clear on its own.
   */
  get retryable(): boolean {
    return this.status === 502 || this.status === 429 || this.status === 503;
  }

  /**
   * The provider has nothing left to give for now, as opposed to disliking this
   * particular request.
   *
   * Worth telling apart. It waits on a clock rather than on chance, so it wants
   * a different schedule; and it is not a judgement about the picture, so the
   * advice that helps is "use the other model or come back later" rather than
   * "try rewording it".
   */
  get exhausted(): boolean {
    return this.reason === 'RESOURCE_EXHAUSTED' || this.status === 429;
  }
}

async function post(body: unknown, signal?: AbortSignal): Promise<{ image: string; usd: number; cached: number }> {
  const response = await fetch('/api/image/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const payload = (await response.json().catch(() => null)) as {
    image?: string;
    usd?: number;
    cached?: number;
    error?: string;
    code?: string;
    reason?: string;
    retryAfterMs?: number | null;
    status?: number;
  } | null;

  if (!response.ok || !payload?.image) {
    throw new GenerateError(
      payload?.error ?? `The image request failed (${response.status})`,
      response.status,
      payload?.code,
      payload?.reason,
      typeof payload?.retryAfterMs === 'number' ? payload.retryAfterMs : undefined,
      typeof payload?.status === 'number' ? payload.status : undefined,
    );
  }

  return {
    image: `data:image/png;base64,${payload.image}`,
    usd: payload.usd ?? 0,
    cached: payload.cached ?? 0,
  };
}

/**
 * Asks whether the model has any capacity, without spending a generation on the
 * question. See functions/api/image/capacity.ts for why that is possible.
 *
 * Three answers rather than two, and the third is the important one: a probe
 * that fails, times out, or is refused must never become a new way for a
 * generation to fail. `unknown` means "go and find out properly", which is
 * exactly the behaviour this app had before the check existed.
 */
type Capacity = 'exhausted' | 'available' | 'unknown';

async function capacityOf(modelKey: string, signal?: AbortSignal): Promise<Capacity> {
  // OpenAI is deliberately out of scope — the probe is a Vertex behaviour and
  // its 429 means something else. Asking would get a 400 and prove nothing.
  if (findImageModel(modelKey)?.provider !== 'gemini') return 'unknown';

  try {
    const response = await fetch('/api/image/capacity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelKey }),
      signal,
    });
    if (!response.ok) return 'unknown';
    const payload = (await response.json()) as { exhausted?: boolean | null };
    return payload?.exhausted === true
      ? 'exhausted'
      : payload?.exhausted === false
        ? 'available'
        : 'unknown';
  } catch (error) {
    // An abort is the user leaving, not a verdict — it has to keep travelling.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return 'unknown';
  }
}

/**
 * How long to wait before each retry, in milliseconds.
 *
 * Two schedules, because the two things that go wrong clear on different
 * timescales and one set of delays cannot suit both.
 *
 * An ordinary hiccup is usually over in seconds. A spent quota is not: it is
 * measured against a window, and the shortest window a provider bothers with is
 * a minute — so a schedule whose longest wait is forty-five seconds can retry
 * three times inside the very window it is waiting out and learn nothing from
 * any of them. That was the earlier design, and it is why a run could burn
 * through its attempts and still report the quota as spent.
 *
 * Retrying is close to free, which is what makes waiting this long worth it: a
 * request that returns no image is not billed.
 */
const RETRY_DELAYS_MS = [6_000, 20_000, 45_000];

/**
 * Long enough that the first retry lands beyond any per-minute window.
 *
 * Probably not long enough for Pro, and that is measured rather than feared: a
 * free probe fired during a real burst found gemini-3-pro-image still
 * RESOURCE_EXHAUSTED after a hundred seconds of total silence from us, while
 * gemini-2.5-flash-image had capacity in the same second on the same key. A
 * per-minute bucket of our own would have refilled; this did not, so the pool
 * is either shared with everyone else or metered over something much longer
 * than a minute.
 *
 * Both entries are kept even though a quota run now usually ends on the first
 * check, because that check can also come back `unknown` — an unreachable or
 * refused probe falls through to a real attempt, and then this schedule is the
 * only thing pacing it, exactly as before. So the second number is not dead; it
 * is what the retry path degrades to when the cheap answer is unavailable.
 */
const QUOTA_DELAYS_MS = [70_000, 150_000];

/**
 * How far a wait is spread either side of its scheduled length.
 *
 * Not decoration. Every slot has its own button, so a kit is often several
 * generations fired within a second or two of each other, against a quota
 * metered per minute across the whole project. When that pool is empty they all
 * fail together — and on a fixed schedule they would then all wait exactly
 * seventy seconds and arrive together again, which is the same burst that
 * emptied it, retried. Spreading them is what lets the pool refill into
 * requests arriving one at a time rather than in a wave.
 */
const JITTER = 0.3;

function spread(ms: number): number {
  return Math.round(ms * (1 - JITTER + Math.random() * 2 * JITTER));
}

/**
 * A ceiling on a wait the provider asked for.
 *
 * The stated delay arrives from outside and is sanity-checked nowhere else. A
 * quarter of an hour is not a wait, it is a hung button — better to fail and
 * let the press be repeated deliberately.
 */
const MAX_STATED_MS = 300_000;

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Told which attempt is starting, and how long the wait before it was. */
export type OnAttempt = (attempt: number, total: number) => void;

async function postWithRetry(
  body: unknown,
  run: RunHandle,
  modelKey: string,
  signal?: AbortSignal,
  onAttempt?: OnAttempt,
): Promise<{ image: string; usd: number; cached: number }> {
  // The schedule is chosen from the first failure and then kept, so a run does
  // not flip between timescales as the reason wobbles between attempts.
  let schedule: number[] = RETRY_DELAYS_MS;

  /**
   * Set once the provider has said RESOURCE_EXHAUSTED, and never cleared.
   *
   * It is what turns every later attempt into a free question before an
   * expensive one. Not cleared on a recovery, because a pool that has just been
   * empty is the one most likely to be empty again, and the check costs nothing
   * to repeat.
   */
  let quotaBlocked = false;

  /** Kept so a run that ends on a free check can still throw a real error. */
  let lastError: unknown;

  for (let attempt = 0; ; attempt++) {
    onAttempt?.(attempt + 1, schedule.length + 1);
    run.attemptStarted(attempt + 1);

    // A free look before a paid one — but only from the second attempt on.
    // Probing the instant a 429 arrives samples the moment that just failed and
    // can do nothing but agree with it; the answer is only worth having on the
    // far side of a wait, which is precisely where the expensive alternative is
    // to send the whole picture again to find out.
    if (quotaBlocked) {
      const capacity = await capacityOf(modelKey, signal);
      if (capacity === 'exhausted') {
        // Recorded as a failed attempt because that is what it is — a real
        // question put to the provider and refused. The reason says it cost
        // nothing, so the transcript cannot be misread as billed tries.
        run.attemptFailed(502, 'RESOURCE_EXHAUSTED (checked free, not billed)', 429);
        // And then stop, rather than sleeping out the rest of the schedule.
        // This is the one place the app now knows something instead of hoping:
        // the pool was empty a minute ago and is still empty, verified, so the
        // remaining wait would be time spent on a conclusion already reached.
        // A burst measured at the time this was written was still exhausted
        // after a hundred idle seconds, which is longer than anything left on
        // the clock here.
        throw lastError;
      }
      // 'available' or 'unknown' both fall through to a real attempt. Unknown
      // deliberately behaves exactly as this function did before the check
      // existed: a broken probe must not invent a failure.
    }

    try {
      return await post(body, signal);
    } catch (error) {
      lastError = error;
      const failure = error instanceof GenerateError ? error : null;
      run.attemptFailed(
        failure?.status,
        failure?.reason ?? failure?.code ?? (error instanceof Error ? error.name : undefined),
        failure?.upstreamStatus,
      );
      if (!failure?.retryable) throw error;
      if (attempt === 0 && failure.exhausted) schedule = QUOTA_DELAYS_MS;
      if (failure.exhausted) quotaBlocked = true;

      // The schedule still decides how many attempts there are, even when the
      // provider is dictating their spacing — otherwise a stated one-second
      // delay would buy an unbounded number of tries.
      const scheduled = schedule[attempt];
      if (scheduled === undefined) throw error;

      // A stated delay is a floor rather than an answer. "Retry-After" means do
      // not come back before this, not that the pool refills exactly then — so
      // it can lengthen a wait the schedule guessed too short, and never
      // shorten one. Taking it literally would be worse than ignoring it: a
      // Vertex 429 can name a few seconds while the quota it belongs to is
      // metered over a minute, and obeying that spends both attempts inside the
      // window that was already closed.
      const stated = Math.min(failure.retryAfterMs ?? 0, MAX_STATED_MS);
      const sleep = spread(Math.max(scheduled, stated));
      run.waitingFor(sleep);
      await wait(sleep, signal);
    }
  }
}

export async function generatePatch({
  modelKey,
  base,
  box,
  instruction,
  label,
  imageFirst,
  signal,
  onAttempt,
}: GenerateArgs): Promise<Generated> {
  const model = findImageModel(modelKey);
  if (!model) throw new Error(`Unknown image model "${modelKey}"`);

  // Opened before the first canvas call rather than around the fetch alone,
  // because "the button has been down for two minutes" is a question about the
  // whole round trip and the local work is part of it.
  const run = beginRun(label, model.label);
  try {
    // Sent with a backdrop behind it when the portrait has none, and a
    // no-op otherwise. The kit keeps the cut-out either way — see the clip
    // below, which is what actually holds that promise.
    const flattened = await flattenBackground(base);
    // Sent only where it means something. A provider steered by prompt alone
    // is not handicapped by its absence, because the crop is what actually
    // protects the rest of the face either way.
    const mask = model.masked ? maskFor(box) : undefined;

    const { image, usd, cached } = await postWithRetry(
      {
        model: modelKey,
        prompt: `${PREAMBLE} ${instruction}`,
        image: flattened,
        mask,
        imageFirst,
      },
      run,
      modelKey,
      signal,
      onAttempt,
    );

    run.phase('stitching');
    // Crop, clip, match the seam, then fade it. The order matters throughout:
    // clipping before matching keeps the seam ring off invented background,
    // matching before fading measures the real border pixels rather than ones
    // already blended toward transparency, and fading last means the alpha
    // survives into the kit.
    const cropped = await cropToBox(image, box);
    const clipped = await clipToBase(cropped, base, box);
    const matched = await matchTone(clipped, base, box);
    const generated = {
      // The clearance rides along so the bottom of the fade stays off the chin.
      // Null for every eye box and for any mouth box nobody has measured, which
      // is the same instruction in both cases: fade all four edges as before.
      patch: await featherPatch(matched, box, undefined, chinClearance(box)),
      full: await normalise(image),
      usd,
      cached,
    };
    run.succeeded(usd);
    return generated;
  } catch (cause) {
    run.failed(cause instanceof Error ? cause.message : String(cause));
    throw cause;
  }
}

/**
 * Replaces the base itself rather than producing a patch.
 *
 * The one generation that is allowed to change the whole frame, because its job
 * is to give every later patch something sane to sit on: a closed, neutral
 * mouth. Everything downstream treats whatever this returns as the original.
 */
export async function generateBase({
  modelKey,
  base,
  instruction,
  box,
  label,
  imageFirst,
  signal,
  onAttempt,
}: GenerateArgs): Promise<{ base: string; usd: number }> {
  const model = findImageModel(modelKey);
  if (!model) throw new Error(`Unknown image model "${modelKey}"`);

  const run = beginRun(label, model.label);
  try {
    const flattened = await flattenBackground(base);
    const mask = model.masked ? maskFor(box) : undefined;

    const { image, usd } = await postWithRetry(
      {
        model: modelKey,
        prompt: `${PREAMBLE} ${instruction}`,
        image: flattened,
        mask,
        imageFirst,
      },
      run,
      modelKey,
      signal,
      onAttempt,
    );

    run.phase('stitching');
    // The silhouette is the one thing this pass may not change. It is allowed
    // to redraw the whole frame, but a cut-out portrait that comes back with an
    // invented background is no longer the picture that was uploaded — and
    // since every later patch is clipped to *this* base's alpha, a base that
    // lost its hole would take the whole kit with it.
    const normalised = await normalise(image);
    const clipped = await clipToBase(normalised, base, FULL_FRAME);
    run.succeeded(usd);
    return { base: clipped, usd };
  } catch (cause) {
    run.failed(cause instanceof Error ? cause.message : String(cause));
    throw cause;
  }
}
