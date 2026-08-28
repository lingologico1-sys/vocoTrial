/**
 * Runs a whole lesson against the live model, without anybody speaking French
 * at a laptop.
 *
 * WHY THIS EXISTS. The only way to find out whether a tutor behaves was to
 * publish a lesson, open /eleve, talk to it for five minutes and read the
 * diagnostic afterwards — which costs a real conversation per iteration and
 * cannot be repeated identically. The faults worth catching are protocol
 * faults: a tool that arrives before the learner has answered anything, a
 * lesson that ends at question three, a turn spoken twice because answering a
 * tool call restarted the model. All of those are visible in a scripted
 * conversation of typed text, and none of them need audio.
 *
 * WHAT IT CANNOT TELL YOU. Audio, endpointing and transcription — the three
 * things that need a microphone. A learner's turn arrives here as text on the
 * same socket the microphone would feed, so the model's *reasoning* about the
 * conversation is under test and its hearing is not. `--languages` is the one
 * exception, and it only asks whether a language code is accepted at all.
 *
 * IT USES THE REAL COMPOSER AND THE REAL SETUP FRAME, imported from the app
 * rather than restated here. A probe with its own copy of the prompt tests a
 * prompt nobody ships. That is also why it runs through esbuild: these modules
 * import each other without file extensions, which Node's own TypeScript
 * stripping will not resolve. See the `probe` script in package.json.
 *
 * IT TALKS TO AI STUDIO DIRECTLY rather than through the Pages relay, on
 * GOOGLE_API_KEY out of .dev.vars. The relay forwards frames verbatim and adds
 * a credential; going straight at the surface removes a login from the loop
 * without changing the frame under test, since the frame is built by the same
 * geminiSetup the relay calls.
 *
 *   npm run probe              a whole lesson, with the protocol asserted
 *   npm run probe -- --dry     compose and print, open no socket
 *   npm run probe -- --languages   which BCP-47 codes the surface accepts
 */

import { readFileSync } from 'node:fs';

import { aiStudioModel, AISTUDIO_LIVE_URL } from '../functions/api/_aistudio';
import { geminiSetup, openAiSession } from '../functions/api/live/_setup';
import { defaultInstructions } from '../src/realtime/instructions';
import { LANGUAGES, findLanguage } from '../src/realtime/languages';
import { findModel } from '../src/realtime/models';
import { lessonKeywords } from '../src/realtime/vocoSessions';
import { DEFAULT_OPENAI_VOICE, patienceSettings } from '../src/realtime/settings';
import {
  PROGRESS_TOOL,
  TIME_UP_SIGNAL,
  composeTutorPrompt,
  openingSignal,
} from '../src/realtime/tutorPrompt';

/** The model the student page dials. Not a parameter: that is the point. */
/**
 * Which model this run drives, and therefore which protocol.
 *
 * `npm run probe` runs the default Gemini model, as it always has.
 * `npm run probe -- --openai` runs the same scripted lesson against
 * gpt-realtime-2.1. Everything between those two — the lesson, the persona,
 * the learner's replies, the checks at the end — is identical, which is the
 * point: the two runs differ in the provider and in nothing else, so a
 * difference in the findings is a difference in the model.
 */
const OPENAI_MODE = process.argv.slice(2).includes('--openai');
const MODEL_KEY = OPENAI_MODE ? 'gpt-realtime-21' : 'gemini-flash-31';

/**
 * The lesson under test, which is the one that failed.
 *
 * Verbatim from the diagnostic that prompted this rewrite — five questions on
 * introducing yourself, the same targets, the same persona. A fixture nobody
 * has ever seen go wrong is a fixture that proves nothing.
 */
const LESSON = {
  questions: [
    'Comment ça va?',
    'Quel âge as-tu?',
    "D'où viens tu?",
    "Qu'est-ce que tu aimes faire?",
    "Qu'est-ce que tu n'aimes pas faire?",
  ],
  targets: ['le présent', 'les expressions comme "bonjour" et "enchanté(e)"'],
};

const PERSONA = {
  fullName: 'Théo Dubois',
  bio: "My name is Théo Dubois, and I'm 24 years old. I grew up and still live in Lyon, which I absolutely adore. I work at a community center here, helping to organize local cultural events and workshops.",
  voice: 'Orus',
  // The same character on the other provider, picked the way a face's is —
  // asked rather than mapped. Orus reads as a man in his twenties and cedar is
  // the nearest thing OpenAI publishes; nothing derives one from the other.
  openAiVoice: 'cedar',
};

/**
 * The learner, who answers the question they were actually asked.
 *
 * A FIXED SCRIPT MEASURED THE SCRIPT, NOT THE TUTOR. The first version was a
 * list of twelve lines played in order, and it fell out of step on the second
 * turn: the tutor asked an age, the script replied "Pas grand-chose", and every
 * turn after that was the tutor coping with a learner who answers questions
 * nobody asked. It then looked like a tutor asking two questions at once and
 * losing its place — which is exactly the fault being investigated, arriving
 * for a reason that lives in this file rather than in the prompt. A probe that
 * manufactures the bug it is looking for is worse than no probe.
 *
 * MATCHED ON THE TUTOR'S LAST TURN, crudely and on purpose: the point is a
 * conversation that stays coherent, not a learner simulator. Each topic holds
 * two replies — a short one and a fuller one — so a tutor that asks a good
 * follow-up gets rewarded with the longer answer, and one that moves straight
 * on never sees it. That difference is the thing worth measuring.
 *
 * THE FIRST REPLY TO EVERY TOPIC IS SHORT, because the failure being watched
 * for is a tutor that takes a shrug for an answer and reports the question
 * finished. Give it nothing but full sentences and it cannot show that.
 *
 * The negative pattern is tested before the positive one: "qu'est-ce que tu
 * n'aimes pas faire" contains "aimes faire", and matching that first would
 * answer question five with question four's answer for the whole run.
 */
const TOPICS: Array<{ asks: RegExp; replies: string[] }> = [
  {
    asks: /n['’]aimes pas|n['’]aime pas|détest|pas envie/i,
    replies: [
      "Je n'aime pas faire mes devoirs.",
      "Surtout les maths, parce que c'est difficile et je préfère être dehors avec mes amis.",
    ],
  },
  {
    asks: /aimes faire|aimes-tu faire|loisir|temps libre|passe-temps|métier|dans la vie/i,
    replies: [
      "J'aime le football.",
      "Je joue dans le parc avec mes amis le week-end, et après on mange une pizza ensemble.",
    ],
  },
  {
    asks: /âge|ans\b|quel age/i,
    replies: ["J'ai dix-sept ans.", 'Oui, je suis au lycée, en première.'],
  },
  {
    asks: /d['’]où|viens|habites|ville|région|pays/i,
    replies: [
      'Je viens de Manchester.',
      "C'est une grande ville en Angleterre, il pleut beaucoup mais j'aime bien y vivre.",
    ],
  },
  {
    asks: /ça va|comment vas|en forme|bien dormi|aujourd['’]hui/i,
    replies: ['Ça va bien, merci.', 'Je suis un peu fatigué, mais content de parler français.'],
  },
];

/** When nothing matched: keep talking without answering anything specific. */
const SHRUGS = [
  'Pas grand-chose.',
  'Oui, je pense.',
  'Je ne sais pas trop.',
  "Peut-être, oui.",
  "Oui, c'est vrai.",
];

/**
 * The most turns to take before giving up on the list.
 *
 * Five questions with a follow-up apiece is ten or eleven exchanges. Sixteen
 * leaves room for a tutor that asks two follow-ups and still finishes; a tutor
 * that has not finished in sixteen is the finding, not a run that was cut off.
 */
const MAX_EXCHANGES = 16;

/**
 * How long to wait for the model to finish a turn before giving up on it.
 *
 * NINETY RATHER THAN FORTY-FIVE, because audio streams in something close to
 * real time: a turn is not slow because the model is thinking, it is slow
 * because it is talking, and a tutor that has decided to say a paragraph takes
 * a paragraph's worth of seconds to say it. Forty-five was tripping on turns
 * that were still arriving, which reads as a hang and is a tutor being
 * long-winded — itself worth seeing, and only visible if the wait outlasts it.
 */
const TURN_TIMEOUT_MS = 90_000;

/**
 * Bytes of output audio per millisecond of speech: 24 kHz, 16-bit, mono.
 *
 * The rate is OUTPUT_SAMPLE_RATE in audio.ts and the format is what
 * PcmPlayer.enqueue is handed. Restated rather than imported because that
 * module is built on AudioContext and this one runs in Node.
 */
const AUDIO_BYTES_PER_MS = (24_000 * 2) / 1_000;

/**
 * The longest playout this will sit through before answering anyway.
 *
 * A turn whose audio runs past a minute is a tutor delivering a monologue,
 * which is a finding rather than a reason to stall the run — and the checks
 * below can only report it if the run reaches them.
 */
const MAX_PLAYOUT_MS = 60_000;

/**
 * A goodbye, in the words this tutor actually uses to say one.
 *
 * ONE PATTERN FOR TWO READERS, and it has to be: the loop below stops on it and
 * the checks measure it, and a run that kept talking past an ending the checks
 * then called an ending would be measuring two different lessons.
 */
const GOODBYE = /au revoir|à bientôt|bonne journée|bonne continuation|salut/i;

/** A person's beat before replying. Not a fudge factor: see `say`. */
const HUMAN_BEAT_MS = 700;

/**
 * How long to keep listening after generation ends, for the sound of it.
 *
 * `generationComplete` can land before a single audio frame has, and a turn
 * measured at that instant measures as silent — which is a barge-in dressed up
 * as arithmetic. The drain closes on the first quiet stretch, so an ordinary
 * turn costs the quiet window and nothing more; the budget is the ceiling for
 * a turn whose audio never comes at all.
 */
const DRAIN_QUIET_MS = 600;
const DRAIN_BUDGET_MS = 8_000;

// --- Reading the key, which is the one thing here that is not in the repo.

/**
 * The shortest thing that could be a key, for telling one from a placeholder.
 *
 * AI Studio keys are around forty characters and open with "AIza". The value
 * that sent this probe looking for a bug in its own socket handling was three
 * characters long — a placeholder somebody typed to make a file parse — and
 * Google's answer to it is "API key not valid. Please pass a valid API key.",
 * which reads as a key that has been revoked rather than one that was never
 * filled in. Twenty is well under any real key and well over any placeholder.
 */
const KEY_LOOKS_REAL = 20;

function apiKey(): string {
  const found = (() => {
    if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY;
    try {
      return readFileSync('.dev.vars', 'utf8').match(/^GOOGLE_API_KEY=(.+)$/m)?.[1]?.trim() ?? '';
    } catch {
      return '';
    }
  })();

  if (found.length >= KEY_LOOKS_REAL) return found;

  console.error(
    found
      ? `GOOGLE_API_KEY is ${found.length} characters, which is a placeholder rather than\n` +
          'a key — a real AI Studio key is around forty and starts with "AIza". Google\n' +
          'answers one of these with "API key not valid", which sounds like a revoked\n' +
          'key and is not.\n\n' +
          'Get one from https://aistudio.google.com/apikey and put it in .dev.vars. An\n' +
          'AI Studio key, not a Vertex one: this probe talks to the surface 3.1 Flash\n' +
          'Live is published on, and the two are different accounts. See\n' +
          'functions/api/_aistudio.ts.\n\n' +
          'The same secret is set separately in the Pages dashboard, and the student\n' +
          'page needs it there: /eleve dials a model only AI Studio carries.'
      : 'No GOOGLE_API_KEY. Put one in .dev.vars or the environment — an AI Studio\n' +
          'key, not a Vertex one: this probe talks to the surface 3.1 Flash Live is\n' +
          'published on. See functions/api/_aistudio.ts.',
  );
  process.exit(2);
}

// --- The parts under test, composed exactly as the student page composes them.

function buildPrompt(): string {
  const french = findLanguage('fr')!;
  return composeTutorPrompt({
    style: defaultInstructions(french),
    persona: PERSONA,
    questions: LESSON.questions,
    targets: LESSON.targets,
  });
}

function buildSetup(prompt: string): Record<string, unknown> {
  const model = findModel(MODEL_KEY)!;
  if (model.provider !== 'google') throw new Error('buildSetup is the Gemini path');
  const setup = geminiSetup(model, aiStudioModel(model.id), findLanguage('fr')!, prompt, {
    voice: PERSONA.voice,
    ...patienceSettings('patient', model),
  });

  /*
   * An experiment the app cannot run, bolted on here rather than in _setup.ts.
   *
   * `thinkingLevel` is not in SETTING_FIELDS and should not be until something
   * measured says it earns a place — this is where that measuring happens. The
   * documented default for gemini-3.1-flash-live-preview is `minimal`, chosen
   * for latency, so pinning it is expected to change nothing; a run that says
   * otherwise means the default is not what the docs claim, which is the whole
   * reason to ask a socket instead of a doc page.
   *
   *   THINKING=minimal|low|medium|high npm run probe
   *
   * Absent sends no field at all, which is settings.ts's rule and the only way
   * to keep a control run honest.
   */
  const level = process.env.THINKING;
  if (level) {
    const generationConfig = setup.generationConfig as Record<string, unknown>;
    generationConfig.thinkingConfig = { thinkingLevel: level };
    console.log(`  (thinkingLevel pinned to "${level}")`);
  }

  return setup;
}

// --- The socket.

interface LiveFrame {
  setupComplete?: unknown;
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> };
  serverContent?: {
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
    generationComplete?: boolean;
    interrupted?: boolean;
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> };
  };
  usageMetadata?: unknown;
}

/** A frame in a few words, for the account of a wait that gave up. */
function describe(frame: LiveFrame): string {
  const content = frame.serverContent;
  if (!content) return Object.keys(frame).join('+') || 'empty';
  const parts = Object.entries({
    audio: !!content.modelTurn,
    words: !!content.outputTranscription?.text,
    generationComplete: !!content.generationComplete,
    turnComplete: !!content.turnComplete,
    interrupted: !!content.interrupted,
  })
    .filter(([, present]) => present)
    .map(([name]) => name);
  return parts.length ? parts.join('+') : 'serverContent (nothing in it)';
}

/** One thing that happened, in the order it happened. */
interface Event {
  at: number;
  kind: 'tutor' | 'learner' | 'tool' | 'note';
  text: string;
}

/**
 * Records an event and prints it immediately.
 *
 * PRINTED AS IT HAPPENS, NOT COLLECTED AND PRINTED AT THE END, which is how
 * this was written and was wrong in the way that matters: the first run to
 * reach the API spent nine minutes talking to the model, hit a timeout on one
 * turn, and printed a single line saying so — throwing away every turn before
 * it. A probe whose output survives only the successful runs is a probe that
 * goes quiet in exactly the cases somebody runs it for, which is the same
 * mistake the tool logging in useVoiceCall.ts was added to fix.
 */
function note(events: Event[], at: number, kind: Event['kind'], text: string): void {
  events.push({ at, kind, text });
  const seconds = (at / 1000).toFixed(1).padStart(6);
  const shown = kind === 'note' ? `${text.slice(0, 64)}…` : text;
  console.log(`+${seconds}s  ${kind.toUpperCase().padEnd(8)}${shown}`);
}

async function frameText(data: unknown): Promise<string> {
  if (typeof data === 'string') return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  return String(data);
}

/**
 * Opens the socket, sends the setup, and hands back something to talk into.
 *
 * The turn loop is a promise per turn rather than a stream of callbacks: a
 * scripted conversation is strictly alternating, and "say this, then wait for
 * the whole reply" is what the script above reads as.
 */
async function connect(setup: Record<string, unknown>, events: Event[]) {
  const socket = new WebSocket(`${AISTUDIO_LIVE_URL.replace(/^https:/, 'wss:')}?key=${apiKey()}`);
  const started = Date.now();

  let onFrame: ((frame: LiveFrame) => void) | null = null;
  /**
   * Whoever is waiting, so a close can reach them.
   *
   * IT HAS TO BE A HANDLE AND NOT A FLAG. This was a `closed` string checked on
   * the next frame to arrive, which works only if another frame arrives — and
   * the whole point of a close is that none will. A rejected key closes the
   * socket with 1007 and says why in the reason, and the flag version turned
   * that into a 45-second timeout with the reason thrown away: the one message
   * that explains the failure, dropped in favour of the one that does not.
   */
  let waiting: ((error: Error) => void) | null = null;

  socket.onmessage = async (message) => {
    let frame: LiveFrame;
    try {
      frame = JSON.parse(await frameText(message.data)) as LiveFrame;
    } catch {
      return;
    }
    onFrame?.(frame);
  };
  socket.onclose = (event) => {
    const why = `socket closed ${event.code} ${String(event.reason || '').slice(0, 200)}`.trim();
    waiting?.(new Error(why));
  };

  const waitFor = <T,>(test: (frame: LiveFrame) => T | undefined, what: string): Promise<T> =>
    new Promise((resolve, reject) => {
      /**
       * What did arrive while we were waiting, for the message that says we
       * gave up.
       *
       * "Timed out waiting for the tutor to finish a turn" is true and useless:
       * a model that said nothing, a model that spoke and never closed the
       * turn, and a model whose generation was cancelled all produce it, and
       * they are three different bugs. Naming the frames separates them.
       */
      const seen: string[] = [];
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `timed out waiting for ${what}. Frames that did arrive: ${
                seen.length ? seen.join(', ') : 'none at all'
              }`,
            ),
          ),
        TURN_TIMEOUT_MS,
      );
      const settle = (finish: () => void) => {
        clearTimeout(timer);
        onFrame = null;
        waiting = null;
        finish();
      };
      waiting = (error) => settle(() => reject(error));
      onFrame = (frame) => {
        seen.push(describe(frame));
        const hit = test(frame);
        if (hit !== undefined) settle(() => resolve(hit));
      };
    });

  /**
   * Keeps reading frames after a turn has ended, until they stop coming.
   *
   * Same two handles `waitFor` uses and never at the same time as it: a turn
   * is either being waited for or being drained. `onEach` is handed every
   * frame, and says `true` when it has seen enough — which for `say` is a
   * `turnComplete` that may or may not ever arrive.
   */
  const drain = (onEach: (frame: LiveFrame) => boolean): Promise<void> =>
    new Promise((resolve) => {
      let quiet: ReturnType<typeof setTimeout> | null = null;
      const stop = () => {
        clearTimeout(budget);
        if (quiet) clearTimeout(quiet);
        onFrame = null;
        waiting = null;
        resolve();
      };
      const budget = setTimeout(stop, DRAIN_BUDGET_MS);
      // A closed socket has no more frames to give, which is a drain that is
      // finished rather than one that failed.
      waiting = () => stop();
      onFrame = (frame) => {
        if (onEach(frame)) return stop();
        if (quiet) clearTimeout(quiet);
        quiet = setTimeout(stop, DRAIN_QUIET_MS);
      };
    });

  await new Promise<void>((resolve, reject) => {
    // A socket that neither opens nor errors would otherwise wait for ever:
    // every other wait here is bounded and this one was not.
    const timer = setTimeout(() => reject(new Error('the socket never opened')), 15_000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error('could not open the socket'));
    };
  });
  socket.send(JSON.stringify({ setup }));
  await waitFor((frame) => (frame.setupComplete ? true : undefined), 'setupComplete');
  console.log(`+   0.0s  SETUP   accepted — ${MODEL_KEY} is live on AI Studio\n`);

  /**
   * Says something and collects everything the tutor says back.
   *
   * Tool calls are answered here rather than reported upwards and answered
   * later, for the reason the app answers them immediately: a blocking call
   * leaves the model stopped until the response arrives, and a probe that
   * paused to think about it would be measuring its own latency.
   */
  const say = async (text: string, kind: Event['kind']): Promise<string> => {
    note(events, Date.now() - started, kind, text);
    socket.send(
      JSON.stringify({
        clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
      }),
    );

    let spoken = '';
    /*
     * How much speech this turn produced, and when it started arriving.
     *
     * WHY A PROBE WITH NO SPEAKERS COUNTS AUDIO. `turnComplete` says the model
     * has finished *generating*, and the server goes on streaming the sound of
     * it in something close to real time — so the turn is over on this socket
     * a second or two before it would be over in the room. Answering at
     * `turnComplete` is therefore a barge-in, and a barge-in cancels generation
     * without closing the turn: the frame says `interrupted`, the reply is
     * thrown away, and the run fills with tutor turns that said nothing.
     *
     * That is what most of the dead air and the repeated `questionDone` reports
     * in the runs before this were — the probe interrupting its own tutor and
     * then reporting it as a fault of the tutor's. A probe that manufactures
     * the bug it is looking for is worse than no probe, which this file has
     * had to learn once already; see TOPICS.
     *
     * The fixed 1.5-second pause that used to stand in for this was a guess at
     * the length of a sentence, and it is a bad one twice over: too long after
     * "Ah, super !" and far too short after a turn that comments on an answer
     * before asking the next question. Counting the bytes is not an estimate.
     */
    let audioMs = 0;
    let firstAudioAt: number | null = null;
    const countAudio = (frame: LiveFrame) => {
      for (const part of frame.serverContent?.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (!data) continue;
        if (firstAudioAt === null) firstAudioAt = Date.now();
        // Base64 without decoding it: four characters carry three bytes, less
        // whatever the padding claims. Nothing here needs the samples.
        const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
        audioMs += ((data.length / 4) * 3 - padding) / AUDIO_BYTES_PER_MS;
      }
    };
    /*
     * The partial is printed if the wait gives up, and that is not a nicety.
     * A turn that never closes is the one case where the words are the whole
     * evidence — a model reading a note out, a model rambling past the audio
     * budget, and a model genuinely hung all look identical from the frame
     * types alone, and quite different from what it was saying at the time.
     */
    const partial = () => {
      if (spoken.trim()) note(events, Date.now() - started, 'tutor', `${spoken.trim()} …[turn never closed]`);
    };
    await waitFor((frame) => {
      const calls = frame.toolCall?.functionCalls;
      if (calls?.length) {
        for (const call of calls) {
          const args = call.args ? ` ${JSON.stringify(call.args)}` : ' (no arguments)';
          note(events, Date.now() - started, 'tool', `${call.name}${args}`);
        }
        socket.send(
          JSON.stringify({
            toolResponse: {
              functionResponses: calls.map((call) => ({
                id: call.id,
                name: call.name,
                response: { ok: true, scheduling: 'SILENT' },
              })),
            },
          }),
        );
        return undefined;
      }

      if (frame.serverContent?.interrupted) {
        note(events, Date.now() - started, 'tool', '(the tutor was interrupted — generation cancelled)');
      }
      const said = frame.serverContent?.outputTranscription?.text;
      if (said) spoken += said;

      countAudio(frame);

      /*
       * EITHER SIGNAL ENDS THE WAIT, and `generationComplete` is the one that
       * usually arrives. `turnComplete` was the only terminator here until the
       * barge-in above was fixed, which hid this: a probe that interrupted
       * every turn was manufacturing its own turn boundaries, and the first
       * run that let a turn finish on its own sat through the whole 90-second
       * timeout watching audio frames land after a `generationComplete` that
       * no `turnComplete` ever followed.
       *
       * Waiting for both is not available: the model does not promise the
       * second one, and a wait for a frame that may never come is the timeout
       * this just spent. Generation being finished is what the caller needs to
       * know anyway — the sound of it is counted separately and sat through
       * below.
       */
      const content = frame.serverContent;
      return content?.turnComplete || content?.generationComplete ? true : undefined;
    }, 'the tutor to finish a turn').catch((error) => {
      partial();
      throw error;
    });

    /*
     * The tail of the turn, before any of it is measured.
     *
     * `generationComplete` is not a promise that the audio has arrived — it
     * routinely lands first — and a turn measured at that instant measures as
     * silent, which puts the barge-in straight back. So the frames are read
     * until they stop, and the words that arrive with them join the turn.
     */
    const endedAt = Date.now();
    await drain((frame) => {
      countAudio(frame);
      const more = frame.serverContent?.outputTranscription?.text;
      if (more) spoken += more;
      return !!frame.serverContent?.turnComplete;
    });

    // Stamped when generation ended rather than when the draining did, so the
    // timeline keeps saying how long the model took.
    note(events, endedAt - started, 'tutor', spoken.trim() || '(said nothing)');

    /*
     * The rest of the sound, sat through before the caller may speak.
     *
     * Recorded above and waited for here, deliberately in that order: the
     * timeline should say when the turn was generated, which is the number
     * worth having, and the wait is the room rather than the socket. What is
     * left is the audio's own length less however much of it has already
     * streamed while the last frames were arriving.
     */
    const streamed = firstAudioAt === null ? 0 : Date.now() - firstAudioAt;
    const remaining = Math.min(audioMs - streamed, MAX_PLAYOUT_MS);
    if (remaining > 0) await new Promise((resume) => setTimeout(resume, remaining));
    return spoken.trim();
  };

  return { say, close: () => socket.close() };
}

// --- The other provider's socket. Same lesson, same checks, other protocol.

/**
 * The OpenAI key, read the same way the Gemini one is.
 */
function openAiKey(): string {
  const found = (() => {
    if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
    try {
      return readFileSync('.dev.vars', 'utf8').match(/^OPENAI_API_KEY=(.+)$/m)?.[1]?.trim() ?? '';
    } catch {
      return '';
    }
  })();

  if (found.length >= KEY_LOOKS_REAL) return found;

  console.error(
    'No usable OPENAI_API_KEY. Put one in .dev.vars or the environment — the ' +
      'same secret functions/api/live/openai.ts spends, and the same one the ' +
      'Pages dashboard needs for /eleve to dial a GPT model.',
  );
  process.exit(2);
}

function buildOpenAiSession(prompt: string): Record<string, unknown> {
  const model = findModel(MODEL_KEY)!;
  if (model.provider !== 'openai') throw new Error('buildOpenAiSession is the OpenAI path');
  return openAiSession(
    model,
    findLanguage('fr')!,
    prompt,
    {
      voice: PERSONA.openAiVoice ?? DEFAULT_OPENAI_VOICE,
      ...patienceSettings('patient', model),
    },
    lessonKeywords(LESSON.questions),
  );
}

/** Whatever OpenAI sends. Only the fields this probe reads are named. */
interface OpenAiFrame {
  type?: string;
  delta?: string;
  error?: { message?: string };
  response?: {
    output?: Array<{ type?: string; name?: string; call_id?: string; arguments?: string }>;
  };
}

async function connectOpenAi(session: Record<string, unknown>, events: Event[]) {
  /*
   * The key rides as a subprotocol rather than a header.
   *
   * OpenAI names that subprotocol `openai-insecure-api-key`, and the name is
   * accurate about the case it is warning against: a browser bundle, where
   * anything the page holds is public. This is a local script reading the key
   * off .dev.vars, so the key is already on this disk and putting it in a
   * handshake tells nobody anything new. The relay the app actually uses sends
   * a real Authorization header, precisely because a browser cannot — see
   * functions/api/live/openai.ts.
   */
  const socket = new WebSocket(`wss://api.openai.com/v1/realtime?model=${findModel(MODEL_KEY)!.id}`, [
    'realtime',
    `openai-insecure-api-key.${openAiKey()}`,
  ]);
  const started = Date.now();

  let onFrame: ((frame: OpenAiFrame) => void) | null = null;
  let waiting: ((error: Error) => void) | null = null;

  socket.onmessage = async (message) => {
    let frame: OpenAiFrame;
    try {
      frame = JSON.parse(await frameText(message.data)) as OpenAiFrame;
    } catch {
      return;
    }
    onFrame?.(frame);
  };
  socket.onclose = (event) => {
    const why = `socket closed ${event.code} ${String(event.reason || '').slice(0, 200)}`.trim();
    waiting?.(new Error(why));
  };

  const waitFor = <T,>(test: (frame: OpenAiFrame) => T | undefined, what: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const seen: string[] = [];
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `timed out waiting for ${what}. Frames that did arrive: ${
                seen.length ? [...new Set(seen)].join(', ') : 'none at all'
              }`,
            ),
          ),
        TURN_TIMEOUT_MS,
      );
      const settle = (finish: () => void) => {
        clearTimeout(timer);
        onFrame = null;
        waiting = null;
        finish();
      };
      waiting = (error) => settle(() => reject(error));
      onFrame = (frame) => {
        seen.push(frame.type ?? '(untyped)');
        const hit = test(frame);
        if (hit !== undefined) settle(() => resolve(hit));
      };
    });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the socket never opened')), 15_000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error('could not open the socket'));
    };
  });

  socket.send(JSON.stringify({ type: 'session.update', session }));
  await waitFor(
    (frame) =>
      frame.type === 'session.updated'
        ? true
        : frame.type === 'error'
          ? (() => {
              throw new Error(frame.error?.message ?? 'session.update refused');
            })()
          : undefined,
    'session.updated',
  );
  console.log(`+   0.0s  SETUP   accepted — ${MODEL_KEY} is live on OpenAI\n`);

  /**
   * Says something and collects everything the tutor says back.
   *
   * THE SHAPE IS THE GEMINI ONE'S AND THE INSIDE IS NOT. There, a turn ends at
   * `turnComplete` and the sound goes on streaming past it, so the probe has to
   * drain and then sit through the remaining audio or it barges in on its own
   * tutor. Here `response.done` is the end of the response and there is nothing
   * to drain — but the playout wait stays, for the same reason it exists there:
   * answering the instant the socket goes quiet is answering before the room
   * has heard the sentence.
   *
   * THE LOOP IS THE ONE THING THIS PROVIDER ADDS. A response can be nothing but
   * a tool call, and the app then asks for a further turn — see the
   * `response.done` handling in src/realtime/openai.ts. The probe has to do the
   * same or it waits for speech that was never scheduled, so a turn here may be
   * two responses, and the tutor's words are whichever one spoke.
   */
  const say = async (text: string, kind: Event['kind']): Promise<string> => {
    note(events, Date.now() - started, kind, text);
    socket.send(
      JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      }),
    );
    socket.send(JSON.stringify({ type: 'response.create' }));

    let spoken = '';
    let audioMs = 0;
    let firstAudioAt: number | null = null;
    let endedAt = Date.now();

    // Bounded, because "answer the tool, get a silent turn, answer it again" is
    // exactly the shape a livelock would take, and a probe that hangs teaches
    // nothing. Two is one more than any correct run needs.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const done = await waitFor((frame) => {
        if (frame.type === 'response.output_audio_transcript.delta') {
          spoken += frame.delta ?? '';
          return undefined;
        }
        if (frame.type === 'response.output_audio.delta') {
          const data = frame.delta;
          if (data) {
            if (firstAudioAt === null) firstAudioAt = Date.now();
            // Base64 without decoding it: four characters carry three bytes,
            // less whatever the padding claims.
            const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
            audioMs += ((data.length / 4) * 3 - padding) / AUDIO_BYTES_PER_MS;
          }
          return undefined;
        }
        if (frame.type === 'error') {
          note(events, Date.now() - started, 'tool', `error: ${frame.error?.message ?? '(none)'}`);
          return undefined;
        }
        return frame.type === 'response.done' ? frame : undefined;
      }, 'response.done');

      endedAt = Date.now();
      const items = done.response?.output ?? [];
      const calls = items.filter((item) => item.type === 'function_call');
      const spoke = items.some((item) => item.type === 'message' || item.type === 'audio');

      for (const call of calls) {
        const args = call.arguments ? ` ${call.arguments}` : ' (no arguments)';
        note(events, Date.now() - started, 'tool', `${call.name}${args}`);
        socket.send(
          JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'function_call_output',
              call_id: call.call_id,
              output: JSON.stringify({ ok: true }),
            },
          }),
        );
      }

      // The bookkeeping-only turn: answered, and asked to carry on. Anything
      // that spoke is finished with, tool call or not.
      if (calls.length && !spoke) {
        socket.send(JSON.stringify({ type: 'response.create' }));
        continue;
      }
      break;
    }

    note(events, endedAt - started, 'tutor', spoken.trim() || '(said nothing)');

    const streamed = firstAudioAt === null ? 0 : Date.now() - firstAudioAt;
    const remaining = Math.min(audioMs - streamed, MAX_PLAYOUT_MS);
    if (remaining > 0) await new Promise((resume) => setTimeout(resume, remaining));
    return spoken.trim();
  };

  return { say, close: () => socket.close() };
}

// --- What the run is checked against.

interface Finding {
  ok: boolean;
  what: string;
  detail: string;
}

/** How many distinct questions the tutor has reported so far. */
function reported(events: Event[]): number {
  const numbers = events
    .filter((event) => event.kind === 'tool' && event.text.startsWith(PROGRESS_TOOL))
    .map((event) => Number(event.text.match(/"number"\s*:\s*(\d+)/)?.[1]))
    .filter(Number.isFinite);
  return new Set(numbers).size;
}

function check(events: Event[]): Finding[] {
  const findings: Finding[] = [];
  const tools = events.filter(
    (event) => event.kind === 'tool' && event.text.startsWith(PROGRESS_TOOL),
  );
  const numbers = tools.map((event) => {
    const found = event.text.match(/"number"\s*:\s*(\d+)/);
    return found ? Number(found[1]) : NaN;
  });

  findings.push({
    ok: tools.every((event) => event.text.startsWith(PROGRESS_TOOL)),
    what: 'only the declared tool is called',
    detail: tools.length ? tools.map((event) => event.text).join(' · ') : 'no tool was called at all',
  });

  findings.push({
    ok: numbers.length > 0 && numbers.every(Number.isFinite),
    what: 'every report carries a number',
    detail: `${numbers.filter(Number.isFinite).length} of ${numbers.length} did`,
  });

  /*
   * NOT "IN ORDER", WHICH WAS THE WRONG TEST. The tutor catches its bookkeeping
   * up in a single breath — `questionDone(2)` and `questionDone(1)` in one
   * frame — and there is no order inside a frame to violate. What actually
   * matters is that reports stay near the front of the list: a report for
   * question five while three of them are unaccounted for is a tutor that has
   * lost its place, and it is the shape of the failure this whole rewrite came
   * from. This is the same rule `acceptProgress` enforces on the page.
   */
  let ahead = '';
  const counted: number[] = [];
  for (const number of [...numbers].sort((a, b) => a - b)) {
    if (number > counted.length + 1 && !ahead) ahead = `question ${number} with only ${counted.length} counted`;
    counted.push(number);
  }
  findings.push({
    ok: !ahead,
    what: 'no report jumps ahead of the list',
    detail: ahead || numbers.join(', ') || 'none',
  });

  findings.push({
    ok: new Set(numbers).size === numbers.length,
    what: 'no question is reported twice',
    detail: numbers.join(', ') || 'none',
  });

  findings.push({
    ok: new Set(numbers).size === LESSON.questions.length,
    what: `all ${LESSON.questions.length} questions are reported`,
    detail: `${new Set(numbers).size} distinct`,
  });

  /*
   * The doubling, which is the fault non-blocking tool calls exist to prevent.
   * Two consecutive tutor turns opening on the same eight words is what it
   * looked like every time it happened: the model resumed and said its turn
   * again, with a slightly different tail.
   */
  const spoken = events.filter((event) => event.kind === 'tutor').map((event) => event.text);
  const opening = (text: string) => text.toLowerCase().replace(/[^a-zà-ÿ ]/g, '').split(/\s+/).slice(0, 8).join(' ');
  const doubled = spoken.filter((text, index) => index > 0 && opening(text) && opening(text) === opening(spoken[index - 1]));
  findings.push({
    ok: doubled.length === 0,
    what: 'no turn is spoken twice',
    detail: doubled.length ? doubled[0].slice(0, 80) : 'every turn was said once',
  });

  /*
   * ONE QUESTION A TURN, which is the rule a learner actually feels. Asked two,
   * they answer the last one they heard and the first is simply lost — so a
   * turn carrying a follow-up and the next question on the list gets the
   * follow-up dropped, and the answers stay short. Counting question marks is
   * crude and catches exactly this: French writes them where English does.
   */
  const crowded = spoken.filter((text) => (text.match(/\?/g) ?? []).length > 1);
  findings.push({
    ok: crowded.length === 0,
    what: 'one question a turn',
    detail: crowded.length ? `${crowded.length} turns asked more: ${crowded[0].slice(0, 70)}` : 'never more than one',
  });

  /*
   * A TURN THAT SAYS NOTHING IS DEAD AIR ON A VOICE CALL. It happens when the
   * model spends a turn on the tool call alone: `scheduling: 'SILENT'` stops
   * the result becoming a turn of its own, which is what keeps the tutor from
   * repeating itself — and if the model had no speech in that turn to begin
   * with, the learner hears silence after answering. The prompt asks for the
   * call to ride along with a turn that also speaks. This is where that gets
   * measured.
   */
  const silent = events.filter((event) => event.kind === 'tutor' && event.text === '(said nothing)');
  findings.push({
    ok: silent.length === 0,
    what: 'no turn is silent',
    detail: silent.length ? `${silent.length} left the learner with dead air` : 'the tutor spoke every turn',
  });

  /*
   * A tutor that says goodbye before the last question has been answered has
   * ended the lesson early, which is what this watches for.
   *
   * IT USED TO BE WRITTEN THE OTHER WAY ROUND — a goodbye before the page's
   * closing note — and that note is gone. The close moved into the prompt: the
   * tutor flags the last question, then comments and says goodbye in one turn,
   * on its own authority. Waiting to be told is now the fault rather than the
   * rule. So the boundary is the final question's report, and a run that never
   * reported it makes every goodbye an early one. See the deleted
   * LESSON_DONE_SIGNAL in tutorPrompt.ts.
   */
  const finalReport = events.findIndex(
    (event) =>
      event.kind === 'tool' &&
      event.text.startsWith(PROGRESS_TOOL) &&
      Number(event.text.match(/"number"\s*:\s*(\d+)/)?.[1]) === LESSON.questions.length,
  );
  const beforeClose = finalReport === -1 ? events : events.slice(0, finalReport);
  const earlyGoodbye = beforeClose.find(
    (event) => event.kind === 'tutor' && GOODBYE.test(event.text),
  );
  findings.push({
    ok: !earlyGoodbye,
    what: 'no goodbye before the last answer',
    detail: earlyGoodbye ? earlyGoodbye.text.slice(0, 80) : 'it never said goodbye early',
  });

  /*
   * And the other half of the same rule: the list done, it closes itself. The
   * last turn of the run should be a goodbye and should not end on a question
   * — the one turn in the whole lesson exempt from ending on one. A tutor that
   * finishes the list and asks a twelfth question leaves the page hanging up
   * mid-conversation, which the learner experiences as being cut off.
   */
  const last = spoken.at(-1) ?? '';
  findings.push({
    ok: GOODBYE.test(last) && !last.includes('?'),
    what: 'the lesson closes itself',
    detail: last ? last.slice(0, 90) : 'the tutor said nothing at all',
  });

  return findings;
}

// --- The three ways to run.

async function runLesson(): Promise<number> {
  const prompt = buildPrompt();
  const events: Event[] = [];
  const call = OPENAI_MODE
    ? await connectOpenAi(buildOpenAiSession(prompt), events)
    : await connect(buildSetup(prompt), events);

  /**
   * What the learner says next, given what the tutor just said.
   *
   * The used counter per topic is what makes the second visit to a subject give
   * the fuller answer: a tutor that follows up gets more to work with, and one
   * that does not never earns it.
   */
  const used = new Map<RegExp, number>();
  let shrugs = 0;
  const answer = (heard: string): string => {
    const topic = TOPICS.find((entry) => entry.asks.test(heard));
    if (topic) {
      const taken = used.get(topic.asks) ?? 0;
      if (taken < topic.replies.length) {
        used.set(topic.asks, taken + 1);
        return topic.replies[taken];
      }
    }
    return SHRUGS[shrugs++ % SHRUGS.length];
  };

  let closed = false;
  let heard = await call.say(openingSignal('morning'), 'note');
  for (let exchange = 0; exchange < MAX_EXCHANGES; exchange += 1) {
    const line = answer(heard);
    /*
     * A beat before answering, because a person has one.
     *
     * Only the beat now. This used to be 1.5 seconds standing in for the
     * playout as well, which is the barge-in `say` now handles by counting the
     * audio — see it there. What is left is the pause a learner takes after
     * the tutor has actually stopped talking, and it is short on purpose: the
     * endpointing this probe cannot test is the thing that would make it
     * longer.
     */
    await new Promise((resume) => setTimeout(resume, HUMAN_BEAT_MS));
    heard = await call.say(line, 'learner');
    /*
     * A SILENT TURN IS NOT AN ENDING, and reading it as one cost a whole run.
     * The loop used to stop on a tutor turn with no words in it, on the
     * reasonable-sounding theory that a tutor with nothing left to say has
     * finished early. But a turn that carries only a tool call has no words in
     * it by design: `scheduling: 'SILENT'` is what stops the result becoming a
     * turn of its own, so the model reports and says nothing. The probe read
     * that as the end of the lesson, stopped after two learner lines, and
     * reported one question of five — a failure entirely of its own making,
     * sitting in the same output as the real ones.
     */
    if (reported(events) >= LESSON.questions.length) break;

    /*
     * THE OTHER WAY A LESSON ENDS, and leaving it out cost a whole run.
     *
     * The count was the only exit, so a single dropped report — one
     * `questionDone` lost to an interrupted turn — left the probe feeding
     * shrugs to a tutor that had already said goodbye. It said goodbye seven
     * times and re-reported its last question four times, and every one of
     * those went into the findings as a fault: turns spoken twice, questions
     * reported twice, dead air. All of it after the lesson was over.
     *
     * So a goodbye ends the run too, and `closed` remembers which exit was
     * taken — because a tutor that has already closed must not then be handed
     * a note telling it the time ran out.
     */
    if (GOODBYE.test(heard)) {
      closed = true;
      break;
    }
  }

  /*
   * The only note the page still sends from here, and a finished lesson gets
   * none. TIME_UP_SIGNAL is for the run that ends with questions unreported,
   * which is the state it exists for; a run that finished the list has already
   * been closed by the tutor, and a note after that would be the page talking
   * past an ending it asked for. See the deleted LESSON_DONE_SIGNAL.
   */
  const finished = reported(events) >= LESSON.questions.length;
  if (!finished && !closed) await call.say(TIME_UP_SIGNAL, 'note');
  call.close();

  console.log('\n--- WHAT THE RUN SHOWS ---');
  const findings = check(events);
  for (const finding of findings) {
    console.log(`${finding.ok ? '  ok  ' : ' FAIL '} ${finding.what.padEnd(38)} ${finding.detail}`);
  }

  const failed = findings.filter((finding) => !finding.ok).length;
  console.log(failed ? `\n${failed} of ${findings.length} checks failed.` : `\nAll ${findings.length} checks passed.`);
  return failed ? 1 : 0;
}

function runDry(): number {
  const prompt = buildPrompt();
  const setup = OPENAI_MODE ? buildOpenAiSession(prompt) : buildSetup(prompt);
  console.log(`--- THE PROMPT (${prompt.length} characters) ---\n`);
  console.log(prompt);
  console.log(`
--- THE ${OPENAI_MODE ? 'SESSION.UPDATE' : 'SETUP'} FRAME ---
`);
  console.log(JSON.stringify(setup, null, 2));
  return 0;
}

/**
 * Which BCP-47 spellings this surface accepts, one setup per candidate.
 *
 * The point of it is languages.ts: a \`liveCode\` that has not been confirmed is
 * left blank there, because a wrong one is a call that fails at connect rather
 * than a call that mishears a word. This is how a blank one gets filled in —
 * the same posture /api/live/models takes towards model ids.
 */
async function runLanguages(): Promise<number> {
  const model = findModel(MODEL_KEY)!;
  const key = apiKey();
  const url = AISTUDIO_LIVE_URL.replace(/^https:/, 'wss:');

  // Every spelling this app might want, whether or not languages.ts carries it.
  const candidates = [
    ...LANGUAGES.map((entry) => entry.liveCode).filter((code): code is string => !!code),
    'sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'cs-CZ', 'uk-UA', 'ro-RO', 'hu-HU', 'el-GR', 'he-IL',
    'zh-CN', 'cmn-CN', 'pt-PT', 'es-US', 'en-GB',
  ];

  for (const languageCode of [...new Set(candidates)]) {
    const verdict = await new Promise<string>((resolve) => {
      const socket = new WebSocket(`${url}?key=${key}`);
      const done = (text: string) => {
        try {
          socket.close();
        } catch {
          // Already closing; the verdict is what matters.
        }
        resolve(text);
      };
      const timer = setTimeout(() => done('timed out'), 15_000);
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            setup: {
              ...geminiSetup(model, aiStudioModel(model.id), findLanguage('fr')!, 'probe', {}),
              generationConfig: { responseModalities: ['AUDIO'], speechConfig: { languageCode } },
            },
          }),
        );
      socket.onmessage = async (message) => {
        if ((await frameText(message.data)).includes('setupComplete')) {
          clearTimeout(timer);
          done('accepted');
        }
      };
      socket.onclose = (event) => {
        clearTimeout(timer);
        done(`refused ${event.code} ${String(event.reason || '').slice(0, 90)}`);
      };
      socket.onerror = () => {};
    });
    console.log(`${languageCode.padEnd(9)} ${verdict}`);
  }
  return 0;
}

const mode = process.argv.slice(2);
const run = mode.includes('--languages') ? runLanguages : mode.includes('--dry') ? runDry : runLesson;

try {
  process.exitCode = await run();
} catch (error) {
  /*
   * One line, not a stack. Everything that fails here fails for a reason the
   * far end has already stated — a refused key, an unknown model, a language
   * code this surface does not take — and the reason travels in the close
   * frame. A stack trace through the bundler's output buries it.
   */
  console.error(`\nThe probe stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
