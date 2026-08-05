/**
 * The models this app will talk to, and the only ones it will.
 *
 * Both the browser and the Pages Functions import this file, so the picker and
 * the allowlist cannot drift apart. The browser sends a *key* ("gemini-flash")
 * and the Worker resolves it to a provider model id here — a raw model string
 * from the client would let any visitor run any model on the account, which is
 * the same hole the server-side system prompt closes.
 *
 * Deliberately free of imports: functions/ compiles against workers-types with
 * no DOM lib, so this has to stay pure data.
 */

export type Provider = 'openai' | 'gemini';

export interface ModelChoice {
  /** What the client sends. Stable; the id underneath may change. */
  key: string;
  provider: Provider;
  label: string;
  /** The provider's own model id. */
  id: string;
  /** Allowed by the server but kept out of the picker (verification probes). */
  hidden?: boolean;
  /**
   * Set when the id has NOT been confirmed against the provider. Shown in the
   * picker so nobody mistakes a guess for a checked fact.
   */
  unverified?: boolean;
}

// First entry per provider is that provider's default.
export const MODELS: ModelChoice[] = [
  {
    key: 'gemini-flash-31',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash Live',
    id: 'gemini-live-3.1-flash-preview',
    unverified: true,
  },
  {
    key: 'gemini-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash Live',
    id: 'gemini-live-2.5-flash-preview',
    unverified: true,
  },
  {
    key: 'openai-realtime',
    provider: 'openai',
    label: 'GPT Realtime',
    id: 'gpt-realtime',
    unverified: true,
  },
  {
    key: 'openai-realtime-mini',
    provider: 'openai',
    label: 'GPT Realtime Mini',
    id: 'gpt-realtime-mini',
    unverified: true,
  },
];

/**
 * WHY EVERY ID HERE IS MARKED UNVERIFIED
 *
 * Not "probably wrong" — unchecked. Every layer that could confirm a model id
 * was tried against the deployed site and none of them can, so the marking says
 * so rather than implying a confidence nobody earned.
 *
 * Neither provider validates the model when issuing a credential:
 *
 *  - Google's `auth_tokens` accepts ANY model string. Four mutually exclusive
 *    spellings of a 3.1 id all minted.
 *  - OpenAI's `client_secrets` does too: a deliberate `gpt-realtime-no-such-model`
 *    minted exactly like the real ids.
 *
 * And neither transport gets far enough to judge it:
 *
 *  - Gemini's Live socket refuses the ephemeral token before setup. Probed
 *    across both API versions and both parameter names, with and without the
 *    "auth_tokens/" prefix:
 *      ?access_token=...  ->  1008 "Method doesn't allow unregistered callers"
 *      ?key=...           ->  1007 "API key not valid"
 *  - OpenAI's /realtime/calls rejects a hand-rolled SDP offer before looking at
 *    the model — the junk id returns the same "Invalid SDP offer." as the real
 *    ones, so it discriminates nothing without a real WebRTC stack.
 *
 * What that leaves: the OpenAI ids get their first real test from a browser
 * making an actual call, so open the deployed site and try one. The Gemini ids
 * cannot be tested at all until the auth problem is fixed — likely by dropping
 * ephemeral tokens and proxying the socket through the Worker, which keeps
 * GOOGLE_API_KEY server-side but routes audio through Cloudflare. That is a
 * real architectural trade, so it is a decision rather than a patch.
 *
 * Clear the `unverified` flag on an id the moment a call actually connects with
 * it. The flag is visible in the picker, so leaving a stale one is misleading.
 */

export function findModel(key: string): ModelChoice | undefined {
  return MODELS.find((m) => m.key === key);
}

/** What the picker offers, in order. */
export function visibleModels(provider: Provider): ModelChoice[] {
  return MODELS.filter((m) => m.provider === provider && !m.hidden);
}

export function defaultModelKey(provider: Provider): string {
  return visibleModels(provider)[0].key;
}
