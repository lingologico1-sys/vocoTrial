/**
 * What a call cost, from what the provider actually reported.
 *
 * This is not a wall-clock guess. Both providers send real token counts during
 * the session — Gemini in `usageMetadata`, OpenAI on every `response.done` —
 * and the two clients collect them into the same buckets. This file prices
 * them.
 *
 * Two things it deliberately does not do:
 *
 *  - It does not bill the Cloudflare Worker time the relay spends. Both
 *    providers go through one — Google's because its ephemeral tokens are
 *    refused on this account, OpenAI's by choice, since the alternative is
 *    WebRTC and WebRTC has no PCM to measure (see functions/api/live/
 *    openai.ts). It is metered per call either way, so every number here is a
 *    floor by construction.
 *  - It does not survive a socket that dies mid-call. Usage is whatever was
 *    reported before the connection went away, so an errored call under-reports.
 *
 * Both caveats are shown to the user rather than hidden, because a cost readout
 * that quietly understates is worse than no readout.
 */

/**
 * Token counts split into buckets that price differently.
 *
 * The buckets are disjoint on purpose. Nothing on this path reports cached
 * tokens as a *subset* of its input counts today — OpenAI Realtime did, and was
 * un-nested on the way in — but the shape is kept because the invariant is what
 * makes multiplying by a rate valid: every token is counted exactly once.
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
 * Published list prices, USD per 1M tokens, read off Google's own pages on the
 * date below. They are a snapshot, not a contract: rates change, and discounts,
 * free tiers and committed-use pricing are not modelled here.
 *
 * Verified 2026-08-05 against ai.google.dev/gemini-api/docs/pricing.
 *
 * KEYED BY ModelChoice.id, NOT BY OUR KEY, and that is the part to be careful
 * with: a mismatch does not fail, it silently prices nothing. The native-audio
 * row spent time holding the AI Studio spelling after models.ts moved that
 * model to the Vertex GA alias, and every call on it reported "no rates in the
 * table" instead of a cost. Renaming a model id means renaming it here too —
 * which is why both spellings of the same 2.5 model appear below, one per
 * surface.
 */
export const RATES_VERIFIED_ON = '2026-08-05';

// Gemini Live bills no separate cached rate on this path — we use no context
// caching — so the cached buckets carry the uncached rate and stay at zero.
//
// OPENAI IS THE OPPOSITE, AND IT IS THE MOST INTERESTING NUMBER IN THIS FILE.
// Its cached audio input is $0.40 against $32 uncached — eighty to one — and a
// realtime API re-sends the whole conversation as input on every single turn.
// This file already says, under `speakingTime` below, that Gemini charges that
// re-read at full price because nothing on that path caches. So the comparison
// is not the one the headline rates suggest:
//
//   - Per second of *fresh* speech, OpenAI costs about 3.3x Gemini. Its tokens
//     are coarser (10/s in and 20/s out against Gemini's 32/s both ways), which
//     already absorbs most of the 10x gap in the per-token price.
//   - Per second of *re-read* conversation — which is the term that grows with
//     the square of a lesson's length, and therefore dominates a fifteen-minute
//     one — OpenAI is far cheaper.
//
// Which of those wins over a real lesson is not predictable from this table and
// has not been measured. The diagnostic's cost block is the instrument; run the
// same lesson on both and read it. Nothing in the UI should claim a total until
// somebody has. See the `caution` on the model in models.ts, worded to say
// "more per minute of speech" and not "more".
//
// Verified 2026-08-27 against developers.openai.com/api/docs/models.
const RATES: Record<string, ModelRates> = {
  'gemini-3.1-flash-live-preview': {
    textInput: 0.75,
    cachedTextInput: 0.75,
    audioInput: 3,
    cachedAudioInput: 3,
    textOutput: 4.5,
    audioOutput: 12,
  },
  'gemini-live-2.5-flash-native-audio': {
    textInput: 0.5,
    cachedTextInput: 0.5,
    audioInput: 3,
    cachedAudioInput: 3,
    textOutput: 2,
    audioOutput: 12,
  },
  // The same model on AI Studio, at the same published rates, and the equality
  // is the thing to re-check rather than to trust. Google prices the two
  // surfaces from separate rate cards onto separate meters — GCP billing
  // against the AI Studio account — and nothing obliges them to agree. They
  // agreed when this was written. A divergence here shows up as a lesson
  // costed correctly on one surface and not the other, which no error reports.
  'gemini-2.5-flash-native-audio-latest': {
    textInput: 0.5,
    cachedTextInput: 0.5,
    audioInput: 3,
    cachedAudioInput: 3,
    textOutput: 2,
    audioOutput: 12,
  },
  'gpt-realtime-2.1': {
    textInput: 4,
    cachedTextInput: 0.4,
    audioInput: 32,
    cachedAudioInput: 0.4,
    textOutput: 24,
    audioOutput: 64,
  },
};

/**
 * How much audio one token stands for, tokens per second.
 *
 * Google does not bill speech by the word: audio is cut into fixed slices and
 * each slice is a token, so a token count divided by these numbers is a length
 * of speech. That is the only clock we have on the *content* of a call — the
 * wall clock knows how long the connection was open, not who was talking.
 *
 * Input and output are the same rate on Gemini and are not on OpenAI, which
 * bills one token per 100 ms of the user and one per 50 ms of the assistant.
 * The two fields survived that provider's removal because the shape was right
 * either way, and are load-bearing again.
 *
 * Keyed by ModelChoice.id, with the same trap the RATES table above documents.
 *
 * Verified 2026-08-06 against ai.google.dev/gemini-api/docs/tokens:
 * "Audio: 32 tokens per second".
 */
export const AUDIO_RATES_VERIFIED_ON = '2026-08-06';

const AUDIO_TOKENS_PER_SECOND: Record<string, { input: number; output: number }> = {
  'gemini-3.1-flash-live-preview': { input: 32, output: 32 },
  'gemini-live-2.5-flash-native-audio': { input: 32, output: 32 },
  'gemini-2.5-flash-native-audio-latest': { input: 32, output: 32 },
  /*
   * NOT VERIFIED AGAINST CURRENT DOCUMENTATION, and flagged rather than quietly
   * carried. These are the figures this file recorded for OpenAI Realtime
   * before that provider was removed — one token per 100ms of the user, one per
   * 50ms of the assistant — and they are the reason the input and output fields
   * are separate at all, since Gemini has never needed them to differ.
   *
   * They are used for one thing: turning audio tokens back into seconds of
   * speech, which is a readout and not a bill. The cost above is computed from
   * the token counts the provider reports, so a wrong figure here misstates how
   * long somebody talked and cannot misstate what it cost. Re-verify before
   * anything starts reasoning from the seconds.
   */
  'gpt-realtime-2.1': { input: 10, output: 20 },
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
 * The user's side is not. The API re-sends the conversation so far as input on
 * every turn, which means the same second of the user's speech is charged for
 * again on every subsequent turn — nothing is cached on this path, so nothing
 * separates the re-read out. Dividing that by 32 measures how often the model
 * re-read the call, not how long anyone spoke. So the figure is checked against
 * the wall clock and withheld where it exceeds it, rather than shown as a
 * number that cannot be true; on a call of any length, expect it withheld.
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
 * and something usually does — Google slides or compresses the context window
 * once a call runs long.
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

/**
 * What one end-of-lesson marking call cost, as the route measured it.
 *
 * WHY IT IS A TYPE AND NOT TWO NUMBERS ON A RESPONSE. There are two markers —
 * the standard report and the advanced exam rubric — they run different models
 * against different prompts, and the only honest way to answer "which one costs
 * more" is to have both report the same fields. The routes were already
 * computing a `usd`; what was missing was everything that makes a `usd`
 * interpretable. A cent is a cent, but a cent from 12k input tokens on one call
 * and a cent from 5k on two are different facts about which lever to pull.
 *
 * `calls` is the field that earns its place: the advanced marker retries once
 * when a quotation fails to ground (spec §14), so a run that validated first
 * time and a run that did not differ by roughly double, and nothing else in the
 * readout would show it.
 *
 * Both markers price against a published rate card rather than a bill — see
 * `unverifiedRates` — so these are estimates on the same footing as the live
 * call's.
 */
export interface MarkingCost {
  /** Which of the two markers ran. */
  kind: 'standard' | 'advanced';
  /** The provider's own model id, so it can be checked against a rate card. */
  modelId: string;
  modelLabel: string;
  /** Model calls made. More than one means the marker retried. */
  calls: number;
  inputTokens: number;
  /** Reply plus reasoning tokens, which bill at the same rate. */
  outputTokens: number;
  cachedInputTokens: number;
  usd: number;
  /** True when the rates came off a pricing page rather than a bill. */
  unverifiedRates: boolean;
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
