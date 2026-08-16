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
import { findImageModel } from './imageModels';
import type { Box } from './kit';
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
}

interface GenerateArgs {
  modelKey: string;
  base: string;
  box: Box;
  /** The slot's instruction. The shared preamble is added here, not by callers. */
  instruction: string;
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

async function post(body: unknown, signal?: AbortSignal): Promise<{ image: string; usd: number }> {
  const response = await fetch('/api/image/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const payload = (await response.json().catch(() => null)) as {
    image?: string;
    usd?: number;
    error?: string;
    code?: string;
    reason?: string;
    retryAfterMs?: number | null;
  } | null;

  if (!response.ok || !payload?.image) {
    throw new GenerateError(
      payload?.error ?? `The image request failed (${response.status})`,
      response.status,
      payload?.code,
      payload?.reason,
      typeof payload?.retryAfterMs === 'number' ? payload.retryAfterMs : undefined,
    );
  }

  return { image: `data:image/png;base64,${payload.image}`, usd: payload.usd ?? 0 };
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

/** Long enough that the first retry lands beyond any per-minute window. */
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
  signal?: AbortSignal,
  onAttempt?: OnAttempt,
): Promise<{ image: string; usd: number }> {
  // The schedule is chosen from the first failure and then kept, so a run does
  // not flip between timescales as the reason wobbles between attempts.
  let schedule: number[] = RETRY_DELAYS_MS;

  for (let attempt = 0; ; attempt++) {
    onAttempt?.(attempt + 1, schedule.length + 1);
    try {
      return await post(body, signal);
    } catch (error) {
      const failure = error instanceof GenerateError ? error : null;
      if (!failure?.retryable) throw error;
      if (attempt === 0 && failure.exhausted) schedule = QUOTA_DELAYS_MS;

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
      await wait(spread(Math.max(scheduled, stated)), signal);
    }
  }
}

export async function generatePatch({
  modelKey,
  base,
  box,
  instruction,
  signal,
  onAttempt,
}: GenerateArgs): Promise<Generated> {
  const model = findImageModel(modelKey);
  if (!model) throw new Error(`Unknown image model "${modelKey}"`);

  const { image, usd } = await postWithRetry(
    {
      model: modelKey,
      prompt: `${PREAMBLE} ${instruction}`,
      // Sent with a backdrop behind it when the portrait has none, and a
      // no-op otherwise. The kit keeps the cut-out either way — see the clip
      // below, which is what actually holds that promise.
      image: await flattenBackground(base),
      // Sent only where it means something. A provider steered by prompt alone
      // is not handicapped by its absence, because the crop is what actually
      // protects the rest of the face either way.
      mask: model.masked ? maskFor(box) : undefined,
    },
    signal,
    onAttempt,
  );

  // Crop, clip, match the seam, then fade it. The order matters throughout:
  // clipping before matching keeps the seam ring off invented background,
  // matching before fading measures the real border pixels rather than ones
  // already blended toward transparency, and fading last means the alpha
  // survives into the kit.
  const cropped = await cropToBox(image, box);
  const clipped = await clipToBase(cropped, base, box);
  const matched = await matchTone(clipped, base, box);
  return { patch: await featherPatch(matched, box), full: await normalise(image), usd };
}

/**
 * Replaces the base itself rather than producing a patch.
 *
 * The one generation that is allowed to change the whole frame, because its job
 * is to give every later patch something sane to sit on: a closed, neutral
 * mouth. Everything downstream treats whatever this returns as the original.
 */
export async function generateBase(
  modelKey: string,
  base: string,
  instruction: string,
  box: Box,
  signal?: AbortSignal,
  onAttempt?: OnAttempt,
): Promise<{ base: string; usd: number }> {
  const model = findImageModel(modelKey);
  if (!model) throw new Error(`Unknown image model "${modelKey}"`);

  const { image, usd } = await postWithRetry(
    {
      model: modelKey,
      prompt: `${PREAMBLE} ${instruction}`,
      image: await flattenBackground(base),
      mask: model.masked ? maskFor(box) : undefined,
    },
    signal,
    onAttempt,
  );

  // The silhouette is the one thing this pass may not change. It is allowed to
  // redraw the whole frame, but a cut-out portrait that comes back with an
  // invented background is no longer the picture that was uploaded — and since
  // every later patch is clipped to *this* base's alpha, a base that lost its
  // hole would take the whole kit with it.
  const normalised = await normalise(image);
  return { base: await clipToBase(normalised, base, FULL_FRAME), usd };
}
