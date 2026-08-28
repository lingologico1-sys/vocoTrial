/**
 * The models this app will talk to, and the only ones it will.
 *
 * Both the browser and the Pages Functions import this file, so the picker and
 * the allowlist cannot drift apart. The browser sends a *key* ("gemini-flash")
 * and the Worker resolves it to a provider model id here — a raw model string
 * from the client would let any visitor run any model on the account, which is
 * the same hole the server-side system prompt closes.
 *
 * THE `provider` FIELD IS BACK, AND THE ARGUMENT THAT REMOVED IT STILL HOLDS.
 * It went out with OpenAI Realtime on the reasoning that a one-member union
 * describes the world worse than no union at all. That was an argument about
 * the count and never about the axis, and the count is two again.
 *
 * WHAT HAS NOT COME BACK IS THE OLD TRANSPORT, which is the part worth being
 * explicit about because git log makes it look available. That path went direct
 * from the browser over WebRTC against an ephemeral secret, and WebRTC hands
 * back an <audio> element: no PcmPlayer, so no AudioTap, so no visemes, no head
 * motion, no audio-synced reveal, no AudioGap and no MicSpan. Every one of
 * those was built after it was removed. The GPT models here run over the same
 * relayed PCM socket Gemini does, and pay the same latency leg for it.
 *
 * The face-kit image models followed the original removal and have not come
 * back with it: src/facekit/imageModels.ts has no provider field, and nothing
 * outside the voice path calls OpenAI.
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
 *
 * A GOOGLE FACT AND NOTHING ELSE. OpenAI publishes one catalogue on one host,
 * so an OpenAI entry carries no surface at all rather than a third member
 * meaning "not applicable" — which is why ModelChoice below is a union and not
 * one interface with an optional field.
 */
export type Surface = 'vertex' | 'aistudio';

/**
 * Whose API serves a model, and therefore which wire shape it speaks.
 *
 * THE ONE AXIS THAT DECIDES WHICH CODE RUNS. A surface changes three values in
 * one relay; a provider changes the transport frame by frame — the setup
 * message, the event names, the tool protocol, the audio rate. So it picks
 * between whole files (src/realtime/gemini.ts against src/realtime/openai.ts,
 * geminiSetup against openAiSession) rather than branching inside one.
 */
export type Provider = 'google' | 'openai';

interface ModelBase {
  /** What the client sends. Stable; the id underneath may change. */
  key: string;
  label: string;
  /** The provider's own model id. */
  id: string;
  /** Allowed by the server but kept out of the picker (verification probes). */
  hidden?: boolean;
  /**
   * How a teacher meets this model on /teach. Absent means not offered there.
   *
   * TEACHER LANGUAGE, NOT MODEL LANGUAGE, and that is the whole reason it is a
   * separate field from `label`. Everywhere else a model is named by its id and
   * its surface, because everywhere else is the workshop. /teach asks for
   * patience and a manner rather than milliseconds and prompts, and "Gemini 2.5
   * Flash Native Audio" tells the person choosing it nothing about the lesson
   * they are about to hand out.
   *
   * `caution` is the half a teacher could not find out any other way: what this
   * model costs them. Prose rather than a flag because the page prints it
   * verbatim, and because what goes wrong differs per model — see Eleve.tsx for
   * what the student page does with each. A model with nothing to warn about
   * leaves it off rather than saying so.
   */
  teach?: {
    label: string;
    blurb: string;
    caution?: string;
  };
  /**
   * Set when the id has NOT been confirmed against the provider. Shown in the
   * picker so nobody mistakes a guess for a checked fact.
   */
  unverified?: boolean;
}

export interface GoogleModel extends ModelBase {
  provider: 'google';
  /** Which Google surface serves this model. See Surface. */
  surface: Surface;
}

export interface OpenAiModel extends ModelBase {
  provider: 'openai';
}

/**
 * A UNION RATHER THAN AN OPTIONAL FIELD, so that `surface` cannot be read off a
 * model that has none. `findModel(key)?.surface` used to be how the client
 * decided whether to send `scheduling: 'SILENT'`; on an OpenAI entry that
 * expression would quietly be `undefined`, which reads as "not AI Studio" and
 * is right by accident. Narrowing on `provider` first makes the compiler ask
 * the question instead.
 */
export type ModelChoice = GoogleModel | OpenAiModel;

export const isGoogle = (model: ModelChoice): model is GoogleModel =>
  model.provider === 'google';

export const isOpenAi = (model: ModelChoice): model is OpenAiModel =>
  model.provider === 'openai';

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
 * takes `speechConfig.languageCode`. The first of those is a strong preference
 * and not a guarantee — on 2026-08-27 an AI Studio lesson doubled a turn with
 * `NON_BLOCKING` and `SILENT` both on the wire, when the call landed mid-speech
 * rather than ahead of the turn. See the tool handling in gemini.ts, which now
 * holds such a response back until the turn it would have landed in is over.
 * What it gives up is affective dialog and
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
    provider: 'google',
    surface: 'aistudio',
    teach: {
      label: 'Reliable progress tracking',
      blurb:
        'Counts each question as it is answered, and writes down what the learner said in the language of the lesson.',
    },
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
    provider: 'google',
    surface: 'vertex',
    teach: {
      label: 'Warmer, more expressive',
      blurb: 'Hears the tone the learner speaks in and answers in kind.',
      caution:
        'What the learner said is written down by the model itself, sometimes in the wrong script — the vocabulary list and the end-of-lesson report both read that text. Progress through the questions is counted from a signal this surface answers by making the tutor start its turn again; the repeat is caught and silenced before the learner hears it, which costs a second or two of quiet between turns.',
    },
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
  {
    key: 'gemini-native-audio-studio',
    label: 'Gemini 2.5 Flash Native Audio (AI Studio)',
    id: 'gemini-2.5-flash-native-audio-latest',
    provider: 'google',
    surface: 'aistudio',
    unverified: true,
    teach: {
      label: 'Warmer, and never asks twice',
      blurb:
        'Hears the tone the learner speaks in and answers in kind, and moves between the questions without repeating itself.',
      caution:
        'Runs on a different Google account from the other two, with weaker guarantees about where the audio is processed and who may see it. Prefer the other warm voice for a class whose recordings must stay inside a school agreement. What the learner said is still written down by the model itself, sometimes in the wrong script.',
    },
    // THE SAME MODEL AS THE ENTRY ABOVE, ON THE SURFACE THAT IMPLEMENTS ASYNC
    // TOOL CALLS. Not a duplicate and not a fallback: the two differ in exactly
    // one behaviour a learner can hear, and it is not a behaviour any prompt
    // reaches. `behavior: 'NON_BLOCKING'` and `scheduling: 'SILENT'` are Gemini
    // Developer API features — Vertex has never implemented either, and ignores
    // both in silence rather than refusing them. Without them a tool response
    // restarts generation, and the restart is the turn the tutor has already
    // spoken, said again in different words. Five questions, five doubled
    // turns, every lesson. See the tool handling in gemini.ts, which gates the
    // fields on `surface` and suppresses the repeat where they are unavailable.
    //
    // WHAT IT COSTS IS THE ACCOUNT IT RUNS ON, which is why the caution above
    // is about governance and not about speech. AI Studio is billed on
    // GOOGLE_API_KEY — an ordinary API key, no service account, no IAM, no
    // VPC-SC, no CMEK, no data residency guarantee and no SLA. The paid tier
    // does not train on prompts or responses; the free tier does, and that is
    // a property of the billing on the key rather than of anything in this
    // file. Confirm the key's project has billing enabled before a class runs
    // on this.
    //
    // THE ID HERE IS THE AI STUDIO SPELLING, WHICH IS NOT THE VERTEX ONE. This
    // entry carried `gemini-live-2.5-flash-preview-native-audio-09-2025` — the
    // id the entry above uses, in its dated form — and AI Studio answered every
    // connection with "not found for API version v1alpha". The two surfaces
    // name the same model differently: Vertex puts `live` after `gemini` and
    // `native-audio` at the end, AI Studio does neither and has no `live` in
    // the name at all. A `-latest` alias is only ever an AI Studio thing.
    //
    // Undated on purpose, for the reason spelled out on the entry above: the
    // dated previews (native-audio-preview-09-2025, and its replacement
    // native-audio-preview-12-2025) both exist on this surface today, and a
    // dated preview retires 45 days after its replacement ships. `-latest`
    // tracks whichever is current.
    //
    // UNVERIFIED, AND THAT FLAG IS DOING ITS JOB HERE. ListModels confirms this
    // id exists and does bidiGenerateContent, which is what the 09-2025
    // spelling could not do; it is not proof the socket reaches setupComplete.
    // The Vertex probe at /api/live/models cannot check it either — it asks
    // Vertex — so the flag comes off on a handshake and not before. The cheapest
    // way to ask is AI Studio's own ListModels:
    //   GET https://generativelanguage.googleapis.com/v1beta/models?key=…
  },
  {
    key: 'gpt-realtime-21',
    label: 'GPT Realtime 2.1',
    id: 'gpt-realtime-2.1',
    provider: 'openai',
    teach: {
      label: 'Steadiest turn-taking',
      blurb:
        'Judges when the learner has finished by what they said rather than by counting silence, and can be asked to speak slowly.',
      caution:
        'Costs more per minute of speech than the other two. How much more over a whole lesson is not yet known — it charges far less to re-read the conversation each turn, which is most of what a long lesson pays for, so the end-of-call figure is the one to read.',
    },
    // THE THIRD ENGINE, AND THE FIRST THAT IS NOT GOOGLE'S. Added because 3.1
    // Flash Live is unreliable in ways no prompt reaches: turns spoken twice
    // with `NON_BLOCKING` and `SILENT` both on the wire, answers the endpointing
    // never commits, and one turn whose words arrived six seconds ahead of its
    // sound. See src/realtime/openai.ts, which is a good deal shorter than
    // gemini.ts precisely because none of the tool-scheduling apparatus that
    // fights those has any counterpart here.
    //
    // Two siblings exist and are deliberately not listed yet —
    // gpt-realtime-2.1-mini and gpt-4o-realtime-preview. Both are a line each
    // once this one has been measured on a real lesson; neither is worth
    // offering a teacher on the strength of the flagship working.
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

/**
 * What /teach offers, in order. A subset of the picker, not the same list.
 *
 * Two filters rather than one because they answer different questions. `hidden`
 * is "may this be dialled at all" — a probe id is allowlisted by the server and
 * kept out of every picker. `teach` is "has anybody written what this means to
 * a teacher", and a model that nobody has is not one to put in front of a
 * teacher with its id showing. Adding a model to the workshop is a line in
 * MODELS; adding it to /teach is that line plus the sentences.
 */
export function teachableModels(): ModelChoice[] {
  return visibleModels().filter((m) => m.teach);
}

export function defaultModelKey(): string {
  return visibleModels()[0].key;
}
