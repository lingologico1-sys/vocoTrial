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
import { geminiSetup } from '../functions/api/live/_setup';
import { defaultInstructions } from '../src/realtime/instructions';
import { LANGUAGES, findLanguage } from '../src/realtime/languages';
import { findModel } from '../src/realtime/models';
import { patienceSettings } from '../src/realtime/settings';
import {
  LESSON_DONE_SIGNAL,
  PROGRESS_TOOL,
  composeTutorPrompt,
  openingSignal,
} from '../src/realtime/tutorPrompt';

/** The model the student page dials. Not a parameter: that is the point. */
const MODEL_KEY = 'gemini-flash-31';

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
};

/**
 * The learner, scripted — and scripted badly on purpose.
 *
 * A learner who answers every question in a full sentence tests nothing: the
 * failure being watched for is a tutor that takes a shrug for an answer and
 * moves on, so the script opens with the shrugs that were in the transcript
 * ("Ça va bien", "Pas grand-chose") and only expands when pushed. The last few
 * lines are deliberately generous, so a run that reaches them can distinguish
 * "the tutor never got there" from "the learner never gave it anything".
 *
 * Twelve lines for five questions. A tutor asking one follow-up per question
 * needs about that many; a tutor that runs out has been asking too many.
 */
const LEARNER = [
  'Ça va bien, merci.',
  'Pas grand-chose.',
  "J'ai dix-sept ans.",
  'Oui, je suis au lycée, en première.',
  "Je viens de Manchester, en Angleterre.",
  "C'est une grande ville, il pleut beaucoup mais j'aime bien.",
  "J'aime jouer au football avec mes amis le week-end.",
  "On joue dans le parc, et après on mange une pizza ensemble.",
  "Je n'aime pas faire mes devoirs, surtout les maths.",
  "Parce que c'est difficile et je préfère être dehors avec mes amis.",
  "Oui, c'est vrai.",
  "Merci beaucoup, au revoir!",
];

/** How long to wait for the model to finish a turn before giving up on it. */
const TURN_TIMEOUT_MS = 45_000;

// --- Reading the key, which is the one thing here that is not in the repo.

function apiKey(): string {
  const fromEnv = process.env.GOOGLE_API_KEY;
  if (fromEnv) return fromEnv;

  try {
    const vars = readFileSync('.dev.vars', 'utf8');
    const found = vars.match(/^GOOGLE_API_KEY=(.+)$/m)?.[1]?.trim();
    if (found) return found;
  } catch {
    // Falls through to the message below, which says what to do about it.
  }

  console.error(
    'No GOOGLE_API_KEY. Put one in .dev.vars or the environment — an AI Studio\n' +
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
  return geminiSetup(model, aiStudioModel(model.id), findLanguage('fr')!, prompt, {
    voice: PERSONA.voice,
    ...patienceSettings('patient'),
  });
}

// --- The socket.

interface LiveFrame {
  setupComplete?: unknown;
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> };
  serverContent?: {
    outputTranscription?: { text?: string };
    turnComplete?: boolean;
    interrupted?: boolean;
  };
}

/** One thing that happened, in the order it happened. */
interface Event {
  at: number;
  kind: 'tutor' | 'learner' | 'tool' | 'note';
  text: string;
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
      const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), TURN_TIMEOUT_MS);
      const settle = (finish: () => void) => {
        clearTimeout(timer);
        onFrame = null;
        waiting = null;
        finish();
      };
      waiting = (error) => settle(() => reject(error));
      onFrame = (frame) => {
        const hit = test(frame);
        if (hit !== undefined) settle(() => resolve(hit));
      };
    });

  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error('could not open the socket'));
  });
  socket.send(JSON.stringify({ setup }));
  await waitFor((frame) => (frame.setupComplete ? true : undefined), 'setupComplete');

  /**
   * Says something and collects everything the tutor says back.
   *
   * Tool calls are answered here rather than reported upwards and answered
   * later, for the reason the app answers them immediately: a blocking call
   * leaves the model stopped until the response arrives, and a probe that
   * paused to think about it would be measuring its own latency.
   */
  const say = async (text: string, kind: Event['kind']): Promise<string> => {
    events.push({ at: Date.now() - started, kind, text });
    socket.send(
      JSON.stringify({
        clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
      }),
    );

    let spoken = '';
    await waitFor((frame) => {
      const calls = frame.toolCall?.functionCalls;
      if (calls?.length) {
        for (const call of calls) {
          const args = call.args ? ` ${JSON.stringify(call.args)}` : ' (no arguments)';
          events.push({ at: Date.now() - started, kind: 'tool', text: `${call.name}${args}` });
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

      const said = frame.serverContent?.outputTranscription?.text;
      if (said) spoken += said;
      return frame.serverContent?.turnComplete ? true : undefined;
    }, 'the tutor to finish a turn');

    events.push({ at: Date.now() - started, kind: 'tutor', text: spoken.trim() });
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

function check(events: Event[]): Finding[] {
  const findings: Finding[] = [];
  const tools = events.filter((event) => event.kind === 'tool');
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

  const inOrder = numbers.every((number, index) => index === 0 || number >= numbers[index - 1]);
  findings.push({ ok: inOrder, what: 'reports arrive in order', detail: numbers.join(', ') || 'none' });

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
   * A tutor that says goodbye before the closing note has ended the lesson on
   * its own authority, which is the thing the page is supposed to decide.
   */
  const beforeClose = events.slice(0, events.findIndex((event) => event.text === LESSON_DONE_SIGNAL));
  const earlyGoodbye = beforeClose.find(
    (event) => event.kind === 'tutor' && /au revoir|à bientôt|bonne journée/i.test(event.text),
  );
  findings.push({
    ok: !earlyGoodbye,
    what: 'the tutor waits to be told to close',
    detail: earlyGoodbye ? earlyGoodbye.text.slice(0, 80) : 'it never said goodbye early',
  });

  return findings;
}

// --- The three ways to run.

async function runLesson(): Promise<number> {
  const prompt = buildPrompt();
  const events: Event[] = [];
  const call = await connect(buildSetup(prompt), events);

  await call.say(openingSignal('morning'), 'note');
  for (const line of LEARNER) {
    const reply = await call.say(line, 'learner');
    // A tutor with nothing left to say has finished early — every turn is meant
    // to end on a question, so an empty one is worth stopping on rather than
    // feeding another eight lines into.
    if (!reply) break;
    if (events.filter((event) => event.kind === 'tool').length >= LESSON.questions.length) break;
  }
  await call.say(LESSON_DONE_SIGNAL, 'note');
  call.close();

  for (const event of events) {
    const seconds = (event.at / 1000).toFixed(1).padStart(6);
    const label = event.kind.toUpperCase().padEnd(8);
    const text = event.kind === 'note' ? `${event.text.slice(0, 60)}…` : event.text;
    console.log(`+${seconds}s  ${label}${text}`);
  }

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
  const setup = buildSetup(prompt);
  console.log(`--- THE PROMPT (${prompt.length} characters) ---\n`);
  console.log(prompt);
  console.log('\n--- THE SETUP FRAME ---\n');
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
