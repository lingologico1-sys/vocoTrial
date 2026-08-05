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
    // Confirmed the only way it can be: a real call from a browser connected.
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
 * WHAT "UNVERIFIED" MEANS HERE
 *
 * Unchecked, not suspect. A model id can only be confirmed by a call that
 * actually connects, because nothing earlier in the chain looks at it:
 *
 *  - Neither provider validates the model when issuing a credential. Google's
 *    `auth_tokens` accepted four mutually exclusive spellings of a 3.1 id, and
 *    OpenAI's `client_secrets` minted a deliberate `gpt-realtime-no-such-model`
 *    exactly like the real ones.
 *  - OpenAI's /realtime/calls rejects a hand-rolled SDP offer before reading
 *    the model, returning the same "Invalid SDP offer." for a junk id as for a
 *    real one — so it discriminates nothing without a real WebRTC stack.
 *
 * gpt-realtime is therefore confirmed by the only means available: a browser
 * placed a call and it connected. gpt-realtime-mini is one dropdown change away
 * from the same treatment.
 *
 * The Gemini ids stay unverified until a call connects through the proxy in
 * functions/api/live/gemini.ts. Clear the flag the moment one does — it shows
 * in the picker, so a stale marking misleads.
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
