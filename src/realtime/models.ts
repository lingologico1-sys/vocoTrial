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

export const MODELS: ModelChoice[] = [
  // Confirmed: mints, and OpenAI rejects a nonsense id at mint time, so a
  // successful mint means the model exists.
  {
    key: 'openai-realtime',
    provider: 'openai',
    label: 'GPT Realtime',
    id: 'gpt-realtime',
  },
  {
    key: 'openai-realtime-mini',
    provider: 'openai',
    label: 'GPT Realtime Mini',
    id: 'gpt-realtime-mini',
  },

  // Gemini ids cannot currently be verified at all — see the note below. Both
  // are carried on the same footing: one is the id the app shipped with, the
  // other is the 3.1 Flash Live entry, guessed from Google's own naming
  // pattern (gemini-live-2.5-flash-preview -> gemini-live-3.1-flash-preview).
  {
    key: 'gemini-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash Live',
    id: 'gemini-live-2.5-flash-preview',
    unverified: true,
  },
  {
    key: 'gemini-flash-31',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash Live',
    id: 'gemini-live-3.1-flash-preview',
    unverified: true,
  },

  // Negative control. If this ever mints, then a successful mint proves nothing
  // about the OpenAI ids above and they need checking another way.
  {
    key: 'probe-openai-junk',
    provider: 'openai',
    label: 'probe',
    id: 'gpt-realtime-no-such-model',
    hidden: true,
  },
];

/**
 * WHY EVERY GEMINI ID IS MARKED UNVERIFIED
 *
 * There are two places a bad Gemini model id could be caught, and neither
 * currently works:
 *
 *  1. Minting. `auth_tokens` accepts ANY model string — "gemini-3.1-flash-live",
 *     "gemini-live-3.1-flash-preview" and two more mutually exclusive spellings
 *     all minted successfully. It does not validate the constraint.
 *
 *  2. The Live socket. It never gets far enough to judge the model, because it
 *     refuses the ephemeral token itself. Probed across both API versions and
 *     both parameter names, with and without the "auth_tokens/" prefix:
 *
 *       ?access_token=...  ->  1008 "Method doesn't allow unregistered callers"
 *       ?key=...           ->  1007 "API key not valid"
 *
 * So the Gemini path is blocked on authentication, not on model naming, and no
 * id can be confirmed until that is resolved. The likely fix is to stop using
 * ephemeral tokens and proxy the WebSocket through the Worker instead, which
 * keeps GOOGLE_API_KEY server-side but puts audio through Cloudflare. That is
 * a real architectural trade, so it is a decision rather than a patch.
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
