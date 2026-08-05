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
  /**
   * Allowed by the server but kept out of the picker. Used to test whether a
   * candidate id is real before offering it — an unknown id fails at mint time
   * with a 400, so the endpoint itself is the oracle.
   */
  hidden?: boolean;
}

export const MODELS: ModelChoice[] = [
  {
    key: 'gemini-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash Live',
    id: 'gemini-live-2.5-flash-preview',
  },
  {
    key: 'openai-realtime',
    provider: 'openai',
    label: 'GPT Realtime',
    id: 'gpt-realtime',
  },

  // Candidates being verified. Promote the ones that mint, delete the rest.
  { key: 'probe-oai-1', provider: 'openai', label: 'probe', id: 'gpt-realtime-mini', hidden: true },
  {
    key: 'probe-oai-2',
    provider: 'openai',
    label: 'probe',
    id: 'gpt-4o-mini-realtime-preview',
    hidden: true,
  },
  {
    key: 'probe-gem-1',
    provider: 'gemini',
    label: 'probe',
    id: 'gemini-3.1-flash-live-preview',
    hidden: true,
  },
  {
    key: 'probe-gem-2',
    provider: 'gemini',
    label: 'probe',
    id: 'gemini-live-3.1-flash-preview',
    hidden: true,
  },
  {
    key: 'probe-gem-3',
    provider: 'gemini',
    label: 'probe',
    id: 'gemini-3.1-flash-live',
    hidden: true,
  },
  {
    key: 'probe-gem-4',
    provider: 'gemini',
    label: 'probe',
    id: 'gemini-3.1-flash-native-audio-preview',
    hidden: true,
  },
];

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
