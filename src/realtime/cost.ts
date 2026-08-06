/**
 * What a call cost, from what the providers actually reported.
 *
 * This is not a wall-clock guess. Both providers send real token counts during
 * the session — OpenAI on every `response.done`, Gemini in `usageMetadata` —
 * and both were already arriving at the browser and being dropped on the floor.
 * The session files now collect them; this file prices them.
 *
 * Two things it deliberately does not do:
 *
 *  - It does not bill the Gemini path's Cloudflare Worker time. That leg exists
 *    because Google's ephemeral tokens are refused on this account (see
 *    functions/api/live/gemini.ts) and it is metered per call, so the Gemini
 *    number here is a floor by construction.
 *  - It does not survive a socket that dies mid-call. Usage is whatever was
 *    reported before the connection went away, so an errored call under-reports.
 *
 * Both caveats are shown to the user rather than hidden, because a cost readout
 * that quietly understates is worse than no readout.
 */

/**
 * Token counts split into buckets that price differently.
 *
 * The buckets are disjoint on purpose: a provider that reports cached tokens as
 * a *subset* of its input tokens (OpenAI does) gets un-nested on the way in, so
 * every token here is counted exactly once and multiplying by a rate is valid.
 */
export interface UsageTotals {
  textInput: number;
  cachedTextInput: number;
  audioInput: number;
  cachedAudioInput: number;
  textOutput: number;
  audioOutput: number;
}

export interface ModelRates {
  /** USD per 1M tokens. */
  textInput: number;
  cachedTextInput: number;
  audioInput: number;
  cachedAudioInput: number;
  textOutput: number;
  audioOutput: number;
}

/**
 * Published list prices, USD per 1M tokens, read off each provider's own pages
 * on the date below. They are a snapshot, not a contract: rates change, and
 * discounts, free tiers and committed-use pricing are not modelled here.
 *
 * Verified 2026-08-05 against:
 *  - developers.openai.com/api/docs/models/gpt-realtime
 *  - developers.openai.com/api/docs/models/gpt-realtime-mini
 *  - ai.google.dev/gemini-api/docs/pricing
 *
 * Keyed by the provider's model id (ModelChoice.id), not our key, because that
 * is what the provider prices.
 */
export const RATES_VERIFIED_ON = '2026-08-05';

const RATES: Record<string, ModelRates> = {
  'gpt-realtime': {
    textInput: 4,
    cachedTextInput: 0.4,
    audioInput: 32,
    cachedAudioInput: 0.4,
    textOutput: 16,
    audioOutput: 64,
  },
  'gpt-realtime-mini': {
    textInput: 0.6,
    cachedTextInput: 0.06,
    audioInput: 10,
    cachedAudioInput: 0.3,
    textOutput: 2.4,
    audioOutput: 20,
  },
  // Gemini Live bills no separate cached rate on this path — we use no context
  // caching — so the cached buckets carry the uncached rate and stay at zero.
  'gemini-3.1-flash-live-preview': {
    textInput: 0.75,
    cachedTextInput: 0.75,
    audioInput: 3,
    cachedAudioInput: 3,
    textOutput: 4.5,
    audioOutput: 12,
  },
  'gemini-2.5-flash-native-audio-latest': {
    textInput: 0.5,
    cachedTextInput: 0.5,
    audioInput: 3,
    cachedAudioInput: 3,
    textOutput: 2,
    audioOutput: 12,
  },
};

/**
 * How much audio one token stands for, tokens per second.
 *
 * Neither provider bills speech by the word: audio is cut into fixed slices and
 * each slice is a token, so a token count divided by these numbers is a length
 * of speech. That is the only clock we have on the *content* of a call — the
 * wall clock knows how long the connection was open, not who was talking.
 *
 * Input and output differ on OpenAI (one token per 100 ms of the user, one per
 * 50 ms of the assistant) and are the same on Gemini.
 *
 * Verified 2026-08-06 against:
 *  - OpenAI Realtime pricing notes: 1 min of user speech = 600 tokens, 1 min of
 *    assistant speech = 1,200 tokens
 *  - ai.google.dev/gemini-api/docs/tokens: "Audio: 32 tokens per second"
 */
export const AUDIO_RATES_VERIFIED_ON = '2026-08-06';

const AUDIO_TOKENS_PER_SECOND: Record<string, { input: number; output: number }> = {
  'gpt-realtime': { input: 10, output: 20 },
  'gpt-realtime-mini': { input: 10, output: 20 },
  'gemini-3.1-flash-live-preview': { input: 32, output: 32 },
  'gemini-2.5-flash-native-audio-latest': { input: 32, output: 32 },
};

export interface SpeakingTime {
  /** Wall clock: the call was live this long. Measured, not derived. */
  callSeconds: number;
  /** Seconds the user was talking, or null when the tokens cannot say. */
  userSeconds: number | null;
  /** Seconds the agent was talking, or null when the tokens cannot say. */
  agentSeconds: number | null;
}

/**
 * Turns audio tokens back into seconds of speech.
 *
 * The agent's side is trustworthy: output audio is generated once and billed
 * once, so those tokens are exactly the speech the user heard.
 *
 * The user's side is not, always. Both APIs re-send the conversation so far as
 * input on every turn, which means the same second of the user's speech can be
 * charged for many times over — on the Gemini path, where nothing is cached, it
 * is charged on every subsequent turn. Dividing that by 32 measures how often
 * the model re-read the call, not how long anyone spoke. OpenAI splits the
 * re-read out as cached tokens, which is why only the uncached bucket is used
 * here; where even that exceeds the length of the call, the figure is withheld
 * rather than shown as a number that cannot be true.
 */
export function speakingTime(
  modelId: string,
  usage: UsageTotals,
  callSeconds: number,
): SpeakingTime {
  const rate = AUDIO_TOKENS_PER_SECOND[modelId];
  if (!rate) return { callSeconds, userSeconds: null, agentSeconds: null };

  const spoken = usage.audioInput / rate.input;
  // A second of tolerance: the call clock starts a beat before the first audio
  // frame, and a derived figure a hair over the wall clock is rounding, not a
  // re-read.
  const plausible = spoken <= callSeconds + 1;

  return {
    callSeconds,
    userSeconds: plausible ? spoken : null,
    agentSeconds: usage.audioOutput / rate.output,
  };
}

/**
 * Below this, an hour is too far to extrapolate to.
 *
 * A 10-second call scaled to an hour multiplies whatever happened in it by 360,
 * including the fixed cost of the system prompt and the one greeting the agent
 * managed. The projection would be dominated by the parts that do not repeat.
 */
export const MIN_PROJECTION_SECONDS = 30;

export interface HourlyProjection {
  /** This call's spend per second, times an hour. */
  usd: number;
  /**
   * The same hour if the context is never trimmed — see projectHour. The
   * honest upper bound, not a second guess at the same number.
   */
  ceilingUsd: number;
}

function scaleUsage(usage: UsageTotals, inputFactor: number, outputFactor: number): UsageTotals {
  return {
    textInput: usage.textInput * inputFactor,
    cachedTextInput: usage.cachedTextInput * inputFactor,
    audioInput: usage.audioInput * inputFactor,
    cachedAudioInput: usage.cachedAudioInput * inputFactor,
    textOutput: usage.textOutput * outputFactor,
    audioOutput: usage.audioOutput * outputFactor,
  };
}

/**
 * What an hour of this same conversation would cost.
 *
 * Two numbers, because the honest answer is a range and picking one would hide
 * which end of it a long call lands on:
 *
 *  - `usd` scales everything with time. It is what "this call, but longer"
 *    means if each turn costs what the average turn of this call cost.
 *  - `ceilingUsd` scales the *input* buckets with the square of time, because
 *    every turn re-sends the whole conversation so far: twice the call is twice
 *    as many turns each carrying twice the history. Output is generated once
 *    and stays linear.
 *
 * Reality sits between them. The square is only reached if nothing intervenes,
 * and something usually does — caching discounts the re-read prefix, and both
 * providers slide or compress the context window once a call runs long.
 */
export function projectHour(
  modelId: string,
  usage: UsageTotals,
  callSeconds: number,
): HourlyProjection | null {
  if (callSeconds < MIN_PROJECTION_SECONDS) return null;
  if (!RATES[modelId]) return null;

  const ratio = 3600 / callSeconds;

  return {
    usd: estimateCost(modelId, scaleUsage(usage, ratio, ratio)).usd,
    ceilingUsd: estimateCost(modelId, scaleUsage(usage, ratio * ratio, ratio)).usd,
  };
}

export function emptyUsage(): UsageTotals {
  return {
    textInput: 0,
    cachedTextInput: 0,
    audioInput: 0,
    cachedAudioInput: 0,
    textOutput: 0,
    audioOutput: 0,
  };
}

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    textInput: a.textInput + b.textInput,
    cachedTextInput: a.cachedTextInput + b.cachedTextInput,
    audioInput: a.audioInput + b.audioInput,
    cachedAudioInput: a.cachedAudioInput + b.cachedAudioInput,
    textOutput: a.textOutput + b.textOutput,
    audioOutput: a.audioOutput + b.audioOutput,
  };
}

export function totalTokens(usage: UsageTotals): number {
  return (
    usage.textInput +
    usage.cachedTextInput +
    usage.audioInput +
    usage.cachedAudioInput +
    usage.textOutput +
    usage.audioOutput
  );
}

export interface CostLine {
  label: string;
  /** The provider's own name for this bucket, for the row's tooltip. */
  hint: string;
  tokens: number;
  /** USD per 1M tokens. */
  rate: number;
  usd: number;
}

export interface CostEstimate {
  usd: number;
  lines: CostLine[];
  /** False when we have no published rates for this model id. */
  priced: boolean;
}

/**
 * Plain English first, the API's own vocabulary in the tooltip.
 *
 * "Audio out" and "text out" are the same sentence billed twice — these models
 * emit a reply as sound and as words together, so the transcript in the log is
 * not a free byproduct of the speech. The labels say so, because reading the
 * bill as "why am I paying for output twice" is the obvious wrong conclusion.
 */
const LABELS: Array<[keyof UsageTotals, string, string]> = [
  ['audioInput', 'You spoke', 'audio input tokens — billed per second of audio, not per word'],
  ['cachedAudioInput', 'You spoke (cached)', 'audio input tokens served from the cached prefix'],
  ['textInput', 'Prompt & history', 'text input tokens — system prompt plus the conversation so far, resent each turn'],
  ['cachedTextInput', 'Prompt & history (cached)', 'text input tokens served from the cached prefix'],
  ['audioOutput', 'Agent spoke', 'audio output tokens — the voice you heard'],
  ['textOutput', 'Reply transcript', 'text output tokens — the same reply in words, generated alongside the audio'],
];

export function estimateCost(modelId: string, usage: UsageTotals): CostEstimate {
  const rates = RATES[modelId];
  if (!rates) return { usd: 0, lines: [], priced: false };

  const lines: CostLine[] = [];
  let usd = 0;

  for (const [bucket, label, hint] of LABELS) {
    const tokens = usage[bucket];
    if (!tokens) continue;
    const rate = rates[bucket];
    const cost = (tokens / 1_000_000) * rate;
    usd += cost;
    lines.push({ label, hint, tokens, rate, usd: cost });
  }

  return { usd, lines, priced: true };
}

/**
 * Sub-cent costs are the normal case for a short call, so a plain 2dp format
 * would render every trial run as "$0.00" and tell the user nothing.
 */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(tokens: number): string {
  return tokens.toLocaleString('en-US');
}

/** Seconds as "42s", "4m 12s", "1h 06m" — whichever two units read fastest. */
export function formatDuration(seconds: number): string {
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;

  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m ${String(whole % 60).padStart(2, '0')}s`;

  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}
