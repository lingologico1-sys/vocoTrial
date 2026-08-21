/**
 * The models this app will talk to, and the only ones it will.
 *
 * Both the browser and the Pages Functions import this file, so the picker and
 * the allowlist cannot drift apart. The browser sends a *key* ("gemini-flash")
 * and the Worker resolves it to a provider model id here — a raw model string
 * from the client would let any visitor run any model on the account, which is
 * the same hole the server-side system prompt closes.
 *
 * Every model here is Gemini Live. There used to be a `provider` field and a
 * union to go with it, because OpenAI Realtime was offered beside these; that
 * path is gone and a one-member union is a worse description of the world than
 * no union at all. The face-kit image models outlasted that removal by a
 * while and have since followed it: src/facekit/imageModels.ts dropped its own
 * provider field for the same reason, and nothing in this project calls OpenAI
 * any more.
 *
 * Deliberately free of imports: functions/ compiles against workers-types with
 * no DOM lib, so this has to stay pure data.
 */

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
  label: string;
  /** Google's own model id. */
  id: string;
  /** Which Google surface serves this model. See Surface. */
  surface: Surface;
  /** Allowed by the server but kept out of the picker (verification probes). */
  hidden?: boolean;
  /**
   * Set when the id has NOT been confirmed against the provider. Shown in the
   * picker so nobody mistakes a guess for a checked fact.
   */
  unverified?: boolean;
}

/**
 * First entry is the default, and it is the half-cascade model rather than the
 * native-audio one. That order was the other way round until a student lesson
 * was watched end to end on 2.5, and the two things that went wrong there are
 * both properties of the surface rather than of the prompt:
 *
 *  - EVERY TOOL CALL ON VERTEX IS BLOCKING. `behavior: 'NON_BLOCKING'` is a
 *    Gemini Developer API feature that Vertex ignores in silence, so a tutor
 *    that reports its progress is a tutor that speaks its turn twice. That is
 *    what forced the one-call-at-the-end protocol, and one unverifiable call
 *    is what ended a five-question lesson at question three.
 *  - NATIVE AUDIO TRANSCRIBES ITS OWN INPUT, with no ASR stage to tell a
 *    language to. It wrote Arabic script into a French transcript where the
 *    learner had said "oui", and the bubble, the vocabulary list and the report
 *    all read that text.
 *
 * The half-cascade model has an answer to each: non-blocking tools, so progress
 * can be reported per question without the doubling, and a real ASR stage that
 * takes `speechConfig.languageCode`. What it gives up is affective dialog and
 * proactivity, which settings.ts refuses it — see `isNativeAudio` there.
 *
 * Native audio stays second rather than being removed. Studio is where the two
 * are compared, and everything measured on it so far is measured on that model.
 */
export const MODELS: ModelChoice[] = [
  {
    key: 'gemini-flash-31',
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
    key: 'gemini-native-audio',
    label: 'Gemini 2.5 Flash Native Audio',
    id: 'gemini-live-2.5-flash-native-audio',
    surface: 'vertex',
    // The GA id, not the dated preview. Both work — this and
    // gemini-live-2.5-flash-preview-native-audio-09-2025 each reach
    // setupComplete — but a dated preview retires 45 days after its replacement
    // ships, and a replacement (native-audio-preview-12-2025) already exists on
    // AI Studio. The undated GA alias follows the 2.5 family lifecycle instead.
    //
    // GA, and with no published retirement date. The 2026-10-16 retirement that
    // gets quoted for "Gemini 2.5" is for gemini-2.5-flash / -pro / -flash-lite
    // — the standard text models, none of which this app uses. Do not read that
    // date onto this entry; the Live audio models were not in that sweep.
    //
    // Which is not the same as permanent. Vertex serves no Gemini 3 or 3.1 Live
    // model under any spelling tried, so there is nothing here to migrate *to*
    // if that changes — re-probe with /api/live/models rather than assume.
  },
];

/**
 * WHAT "UNVERIFIED" MEANS HERE
 *
 * Unchecked, not suspect. A model id can only be confirmed by a call that
 * actually connects, because nothing earlier in the chain looks at it:
 *
 *  - Nothing validates the model when issuing a credential. Google's
 *    `auth_tokens` accepted four mutually exclusive spellings of a 3.1 id
 *    before minting against any of them.
 *  - The relay does not discover a bad id either. It opens the upstream socket
 *    and only the `setup` frame carries the model, so a wrong one surfaces as a
 *    close code seconds later rather than as a refusal to connect.
 *
 * Nothing here is flagged today. The native-audio entry was, briefly, through
 * the move to Vertex AI: the two ids that used to be here had reached
 * `setupComplete` twelve times out of twelve against AI Studio, and that
 * confirmation did not travel — both 404 on Vertex, which publishes its Live
 * models under quite different names. The id here replaced them because Vertex
 * answered for it and for nothing else, and the flag came off on a handshake.
 *
 * The id came from asking rather than guessing — POST /api/live/models
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
export function visibleModels(): ModelChoice[] {
  return MODELS.filter((m) => !m.hidden);
}

export function defaultModelKey(): string {
  return visibleModels()[0].key;
}
