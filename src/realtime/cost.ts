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
