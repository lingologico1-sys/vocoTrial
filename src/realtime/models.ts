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

/**
 * Which of Google's two APIs a Gemini model is served by.
 *
 * Not a preference and not a billing switch — a fact about the model. Vertex
 * and AI Studio publish overlapping but different catalogues, and a model is
 * reachable on the one that carries it or not at all: 2.5 native audio is GA on
 * Vertex, and 3.1 Flash Live exists only on AI Studio, with no Vertex build in
 * any region. So the surface travels with the entry rather than sitting in a
 * global setting, and adding a model means saying where it lives.
 *
 * The meters differ as a consequence: Vertex bills through Cloud Billing on the
 * GCP project, AI Studio through its own account.
 */
export type Surface = 'vertex' | 'aistudio';

export interface ModelChoice {
  /** What the client sends. Stable; the id underneath may change. */
  key: string;
  provider: Provider;
  label: string;
  /** The provider's own model id. */
  id: string;
  /** Gemini only: which Google surface serves this model. See Surface. */
  surface?: Surface;
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
    key: 'gemini-native-audio',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash Native Audio',
    id: 'gemini-live-2.5-flash-native-audio',
    surface: 'vertex',
    // The GA id, not the dated preview. Both work — this and
    // gemini-live-2.5-flash-preview-native-audio-09-2025 each reach
    // setupComplete — but a dated preview retires 45 days after its replacement
    // ships, and a replacement (native-audio-preview-12-2025) already exists on
    // AI Studio. The undated GA alias follows the 2.5 family lifecycle instead.
    //
    // That lifecycle still ends: the 2.5 family retires 2026-10-16. Nothing
    // succeeds it here yet — Vertex serves no Gemini 3 or 3.1 Live model under
    // any spelling tried, so plan on re-probing before then rather than
    // discovering it on the day.
  },
  {
    key: 'gemini-flash-31',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash Live',
    id: 'gemini-3.1-flash-live-preview',
    surface: 'aistudio',
    // AI Studio only, and not for want of looking: sixteen spellings across
    // four Vertex regions all closed 1008, and Google's own answer is that this
    // model has no Vertex build in any region. So it is here on the surface
    // that carries it, billed to the AI Studio account rather than GCP.
    //
    // Half-cascade rather than native audio, which is why settings.ts refuses
    // it affectiveDialog and proactivity — those are native-audio dialects.
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
    // Confirmed the same way as gpt-realtime: a browser called and connected.
  },
];

/**
 * WHAT "UNVERIFIED" MEANS HERE
 *
 * Unchecked, not suspect. A model id can only be confirmed by a call that
 * actually connects, because nothing earlier in the chain looks at it:
 *
 * Nothing here is flagged today. The Gemini entry was, briefly, through the
 * move to Vertex AI: the two ids that used to be here had reached
 * `setupComplete` twelve times out of twelve against AI Studio, and that
 * confirmation did not travel — both 404 on Vertex, which publishes its Live
 * models under quite different names. The id here replaced them because Vertex
 * answered for it and for nothing else, and the flag came off on a handshake.
 *
 *
 *  - Neither provider validates the model when issuing a credential. Google's
 *    `auth_tokens` accepted four mutually exclusive spellings of a 3.1 id, and
 *    OpenAI's `client_secrets` minted a deliberate `gpt-realtime-no-such-model`
 *    exactly like the real ones.
 *  - OpenAI's /realtime/calls rejects a hand-rolled SDP offer before reading
 *    the model, returning the same "Invalid SDP offer." for a junk id as for a
 *    real one — so it discriminates nothing without a real WebRTC stack.
 *
 * Both OpenAI ids are therefore confirmed by the only means available: a browser
 * placed a call and it connected. They are untouched by the Vertex move, which
 * is a Google-side change only.
 *
 * The Gemini id came from asking rather than guessing — POST /api/live/models
 * probes candidate ids against the live surface. Use it before inventing one.
 * Nine spellings went in and one came back, and it was not the one anybody
 * would have written down: the two rejected AI Studio guesses
 * (gemini-live-3.1-flash-preview, gemini-live-2.5-flash-preview) are *closer*
 * to the winner than either id this project actually shipped, and still wrong.
 * The date suffix is load-bearing.
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
