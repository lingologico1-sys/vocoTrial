import {
  GEMINI_INPUT_RATE,
  MicCapture,
  PcmPlayer,
  decodeBase64,
  encodeBase64,
} from './audio';
import { addUsage, emptyUsage, totalTokens, type UsageTotals } from './cost';
import { UnauthorizedError, checkSession, reportExpired } from './auth';
import type { SessionConfig, SessionHandlers, VoiceSession } from './types';
import { findModel, isGoogle } from './models';
import { PROGRESS_TOOL } from './tutorPrompt';

/**
 * Gemini Live, through our own Worker.
 *
 * The socket is same-origin: functions/api/live/gemini.ts relays it to Google
 * with the API key attached, because Google's ephemeral tokens are refused as
 * credentials on this account and so cannot be handed to a browser. The Worker
 * also sends the setup message, so this file never does — it streams audio and
 * listens.
 *
 * There is no WebRTC doing the media work here, so this file owns the whole
 * loop: mic -> int16 -> base64 -> socket, and socket -> base64 -> int16 ->
 * scheduled playback. See src/realtime/audio.ts for both halves.
 */

function liveSocketUrl(modelKey: string, language: string): string {
  const url = new URL('/api/live/gemini', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  // Short, fixed-vocabulary keys, so the query string is the natural place for
  // them. The prompt and the settings are not: a system instruction runs to
  // thousands of characters, and URL length limits are exactly the kind of
  // ceiling that holds in testing and fails on someone's longer prompt. Those
  // go in the opening frame instead — see the send on open below.
  url.searchParams.set('model', modelKey);
  url.searchParams.set('language', language);
  return url.toString();
}

/** One entry of promptTokensDetails / responseTokensDetails. */
interface ModalityTokenCount {
  modality?: string;
  tokenCount?: number;
}

interface UsageMetadata {
  totalTokenCount?: number;
  promptTokensDetails?: ModalityTokenCount[];
  responseTokensDetails?: ModalityTokenCount[];
  /**
   * Vertex spells the response side "candidates" where the Gemini API says
   * "response". Both are read so the switch to Vertex does not silently zero
   * the output half of every estimate.
   */
  candidatesTokensDetails?: ModalityTokenCount[];
}

/** One function call from the model, as Live sends it. */
interface LiveFunctionCall {
  id?: string;
  name?: string;
  args?: Record<string, unknown>;
}

interface LiveMessage {
  setupComplete?: Record<string, never>;
  usageMetadata?: UsageMetadata;
  /**
   * The model calling a tool. See _setup.ts for the one it is given.
   *
   * Every call must be answered, even when the answer is nothing: an
   * unanswered call leaves the model waiting for a result it will never get,
   * and it stops talking. That is why the handling below responds before it
   * does anything with the arguments.
   */
  toolCall?: { functionCalls?: LiveFunctionCall[] };
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    /**
     * The model has finished generating, which is not the same as finished
     * talking. Audio is produced faster than real time, so this lands while
     * seconds of it are still queued — see `turnComplete`, which is the frame
     * that follows and the one everything else in here keys off.
     */
    generationComplete?: boolean;
    turnComplete?: boolean;
  };
  goAway?: { timeLeft?: string };
  /**
   * The relay answering a ping of ours. Never Google — see the Worker.
   *
   * Carries back the stamp that was sent, so the round trip is measured against
   * this browser's own clock at both ends and no clock has to agree with any
   * other. `upgradeMs` rides along because the Worker has no other moment to
   * volunteer it and it costs nothing to repeat.
   */
  pong?: number;
  upgradeMs?: number;
  /**
   * True on the pong that left the Worker immediately, false or absent on the
   * one that queued behind Google's frames. Two arrive per ping and the gap
   * between them is the whole diagnosis — see the relay Worker.
   */
  direct?: boolean;
  /** The upstream socket's longest quiet since the last pong. See onRelay. */
  upstreamMaxGapMs?: number;
}

/**
 * Folds a usageMetadata frame into billing buckets.
 *
 * Unrecognised modalities are priced as audio. Google documents the details
 * arrays as modality-tagged but does not enumerate the tags, and every other
 * caveat on this readout already errs low — the Worker leg is unbilled, a dead
 * socket loses the tail — so the one unknown left is rounded the expensive way
 * rather than quietly dropped.
 */
function readUsage(meta: UsageMetadata): UsageTotals {
  const usage = emptyUsage();

  for (const entry of meta.promptTokensDetails ?? []) {
    const count = entry.tokenCount ?? 0;
    if (entry.modality === 'TEXT') usage.textInput += count;
    else usage.audioInput += count;
  }

  for (const entry of meta.responseTokensDetails ?? meta.candidatesTokensDetails ?? []) {
    const count = entry.tokenCount ?? 0;
    if (entry.modality === 'TEXT') usage.textOutput += count;
    else usage.audioOutput += count;
  }

  return usage;
}

export async function startGeminiSession(
  handlers: SessionHandlers,
  modelKey: string,
  language: string,
  config: SessionConfig = {},
): Promise<VoiceSession> {
  handlers.onStatus('connecting');

  /*
   * Whether this model's surface implements `scheduling` on a tool response.
   * See the tool-call handling below. Unknown keys resolve to false, which is
   * the reading that sends nothing rather than the one that hopes.
   *
   * THE PROVIDER IS CHECKED FIRST, and not for tidiness. This used to read
   * `findModel(modelKey)?.surface === 'aistudio'`, which on an OpenAI entry
   * would compare `undefined` and come out false — the right answer, reached
   * without ever asking the question, and only right until somebody wrote an
   * OpenAI surface. Nothing should reach this file with an OpenAI key at all;
   * `isGoogle` is what says so out loud.
   */
  const chosen = findModel(modelKey);
  const silentResponses = !!chosen && isGoogle(chosen) && chosen.surface === 'aistudio';

  const mic = new MicCapture(GEMINI_INPUT_RATE);
  // The player reports its own queue running out, straight through to whoever
  // is keeping the account of the call — the one fault in here the learner
  // hears and no log the developer can reach ever records.
  const player = new PcmPlayer((gap) => handlers.onAudioGap?.(gap));
  // Creating the output context inside the click that started the session is
  // what keeps autoplay policy from suspending it later. Nothing may be awaited
  // before this line, or the resume lands in a later task than the click.
  await player.resume();

  /**
   * The session cookie is checked here rather than being left to the upgrade.
   *
   * A WebSocket upgrade rejected with a 401 reaches the browser as an untyped
   * error event with no status attached — the spec withholds it — so a lapsed
   * cookie would otherwise surface as "could not reach the Gemini Live socket"
   * and send someone debugging the relay instead of signing back in.
   */
  const { authed } = await checkSession();
  if (!authed) {
    player.close();
    reportExpired();
    throw new UnauthorizedError();
  }

  /**
   * Cumulative or per-turn? Google's docs do not say.
   *
   * "The total number of consumed tokens" reads cumulative, and the field name
   * agrees, but nothing in the reference commits to it — and the two readings
   * differ by the whole length of the call. So both are accumulated and the
   * stream itself decides: totals that only ever climb are a running total and
   * the last frame wins; a total that drops proves the frames are per-turn, and
   * from then on the sum is the answer.
   */
  let perTurn = false;
  let summed = emptyUsage();
  let latest = emptyUsage();
  let highWater = 0;

  const recordUsage = (meta: UsageMetadata) => {
    const frame = readUsage(meta);
    const total = meta.totalTokenCount ?? totalTokens(frame);
    if (total < highWater) perTurn = true;
    highWater = Math.max(highWater, total);

    summed = addUsage(summed, frame);
    latest = frame;
    handlers.onUsage?.(perTurn ? summed : latest);
  };

  /**
   * Whether the model is part-way through an answer.
   *
   * It exists to close the *user's* turn. Google marks the end of the model's
   * turn and never the learner's, so the only thing on the wire that says they
   * have finished talking is the tutor starting to talk back — which is exactly
   * the judgement the server's own voice detection has just made, and the
   * earliest honest moment to act on it.
   *
   * The alternative, and what this used to do, was to close the user on
   * `turnComplete`. That is not when the learner stopped speaking; it is when
   * the model finished *generating* a reply it will then spend several more
   * seconds saying. Audio is generated faster than real time, so the learner's
   * own sentence appeared while the tutor was already mid-answer — long after
   * the moment they were looking for it.
   *
   * IT HAS A SECOND READER NOW, and one that must not read too much into it.
   * A tool call arriving while this is false was made before the model had said
   * anything in that turn — which is usually just the order this model works in,
   * and occasionally a turn that will never speak at all. Only the layer that
   * can wait finds out which. It is reported, not acted on: see the tool
   * handling below.
   */
  let answering = false;

  /**
   * Whether the learner has said anything in the turn now being answered.
   *
   * THE CLOSE BELOW USED TO GO OUT UNCONDITIONALLY, and a turn the learner
   * never spoke in was closed as though they had: the greeting is a model turn
   * answering the page's own opening note, so every lesson began by crediting
   * the learner with a turn they had not taken. Nothing on screen showed it —
   * an empty turn appends nothing — but `learnerTurns` in useVoiceCall counted
   * it, and that count is the ceiling on what the tutor is allowed to claim.
   * A ceiling one higher than the truth is one unearned progress report per
   * lesson, which is the one thing that number exists to refuse.
   */
  let heardLearner = false;

  /**
   * Whether any audio has arrived on the socket for the turn now being spoken.
   *
   * FOR ONE LINE IN THE ACCOUNT, AND IT IS THE LINE THAT SPLITS THE BLAME. Every
   * tutor stamp in the diagnostic is the moment the words were *heard*, which is
   * the right clock for reading a conversation and the wrong one for reading a
   * ten-second silence: it cannot say whether the sound was late arriving or
   * merely late playing. So the first audio frame of each turn is reported as it
   * lands, with the cushion it will wait behind — see onTurnAudio. Two numbers,
   * and the difference between them is the whole of what this browser added.
   */
  let audioThisTurn = false;

  /**
   * Whether the learner has said anything since the tutor last made a sound.
   *
   * THE DISCRIMINATOR THE ECHO PREDICTION ACTUALLY WANTED. It used to ask
   * whether the completing turn had spoken, on the reasoning that a turn spent
   * entirely on bookkeeping has produced nothing for a restart to duplicate —
   * so there the restart must be the tutor's only speech on that question. On
   * 2026-08-28 that reading cost a lesson: a bookkeeping-only turn completed at
   * +0:16.5 *after* the tutor had already asked question three at +0:14.0, so
   * its restart was surplus rather than the only speech, and what it said was
   * question four to a learner who had answered two.
   *
   * What separates the two is not whether the finished turn made a sound. It is
   * whether anybody is owed a reply: if the learner has spoken since the tutor
   * last did, the next turn is theirs and must not be dropped; if they have
   * not, the tutor has already had its say and a further turn is the restart.
   */
  let learnerSinceAudio = false;

  /**
   * When this turn's first words arrived, and those words while the sound of
   * them has not caught up.
   *
   * THE INVARIANT THIS EXISTS TO CATCH BREAKING. Google sends a turn's words
   * alongside the sound of them, in the same frame, and the whole of the
   * transcript's timing rests on it: agent text is stamped with where the audio
   * queue had reached, so the bubble and the voice arrive together. On
   * 2026-08-27 a turn's words arrived six seconds ahead of its first audio and
   * nothing in the account said so — the diagnostic stamped the words as heard
   * on an empty queue, which reads as "now" and was wrong by all six seconds.
   * The learner read half a question in silence, said "allô", and the tutor
   * apologised for a connection problem it has no way to observe.
   *
   * So the words wait here for the sound they belong to. `firstTextAt` is the
   * arrival stamp and the split is reported on the audio line; `pendingText` is
   * held back rather than rendered against a schedule that describes no audio
   * at all. See `flushPendingText` and onTurnAudio in types.ts.
   */
  let firstTextAt = 0;
  let pendingText = '';

  /**
   * Lets a turn's held-back words go, stamped with the audio they belong to.
   *
   * `at` is read from the player *before* the chunk that prompted the flush is
   * enqueued, for the reason the old inline stamp was: a schedule read after
   * the enqueue is when that sound ends rather than when it starts.
   */
  const flushPendingText = (at: number) => {
    if (!pendingText) return;
    handlers.onTranscript({ role: 'agent', text: pendingText, done: false, at });
    pendingText = '';
  };

  /**
   * When the turn now being answered began, and when generation finished.
   *
   * FOR THE ONE TURN WORTH REPORTING, which is a turn that completes having
   * produced no sound at all. On AI Studio — which is where the tutor actually
   * runs, since 3.1 Flash Live has no Vertex build — a tool response is
   * answered `SILENT`, see the tool handling below. So a turn spent entirely on
   * bookkeeping schedules no generation and ends the tutor mute until something
   * asks it to carry on. The stall watchdog in useVoiceCall waits ten seconds
   * and then guesses at exactly that.
   *
   * `turnComplete` on a turn with no audio in it would not be a guess: it is
   * the provider saying the turn is over. Whether it actually arrives in that
   * case is the open question, and it is open because nothing has ever written
   * it down. So this measures it and reports it, and nothing acts on it yet.
   *
   * A SECOND READING EXISTS ON THE OTHER SURFACE, and it is a footnote rather
   * than the case to design for: the house model is AI Studio's, which honours
   * `scheduling`, so an empty completed turn there is final. The Vertex native
   * audio model is also publishable and ignores `scheduling` — its tool response
   * restarts the model, and the same frame is only a pause. Anything built on
   * this reads `silentResponses` too, but it is the AI Studio behaviour that
   * decides whether it is worth building.
   */
  let turnBeganAt = 0;
  let generatedAt = 0;

  /**
   * Emitted once per model turn: their turn ended when this one began.
   *
   * IT CLOSES THE LEARNER ONLY IF THE LEARNER SPOKE. `answering` still flips
   * either way — it is the flag the stall watchdog reads, and a silent turn is
   * exactly what that watches for — but a turn with no learner speech in it has
   * no turn of theirs to end. See `heardLearner`.
   */
  const answerBegins = () => {
    if (answering) return;
    answering = true;
    turnBeganAt = Date.now();
    generatedAt = 0;
    if (!heardLearner) return;
    heardLearner = false;
    handlers.onTranscript({ role: 'user', text: '', done: true });
  };

  let stopped = false;
  /**
   * Whether the far end has accepted the setup frame.
   *
   * THE GATE ON THE MICROPHONE, now that it opens before this is true. Live
   * refuses a `realtimeInput` frame that arrives ahead of the setup handshake,
   * and the socket is OPEN well before Google has answered — so `readyState`
   * alone stopped being enough the moment the two were unhitched. Audio caught
   * in that window is dropped rather than queued: it is the half-second before
   * the tutor has said hello, and nobody is answering a question yet.
   */
  let setupDone = false;
  const socket = new WebSocket(liveSocketUrl(modelKey, language));
  socket.binaryType = 'arraybuffer';

  /**
   * How often the relay is pinged, and it is deliberately not often.
   *
   * The measurement wanted is the shape of the path over a whole call, not a
   * moment of it, and ten seconds gives a lesson a dozen samples — enough for a
   * worst case to mean something and few enough that the frames are lost in the
   * noise beside fifty audio chunks a second. A ping is about thirty bytes and
   * the Worker answers it without waking Google, so the cost of one is the CPU
   * to parse it.
   */
  const PING_EVERY_MS = 10_000;
  let pings: number | null = null;

  /**
   * How many pings have gone out since the relay last answered anything.
   *
   * WHAT IT IS FOR IS A LEARNER TALKING TO NOTHING. On 2026-08-27 the relay
   * stopped forwarding at about fifteen seconds and the socket stayed OPEN
   * throughout: no close frame, no error, so the page went on pumping
   * microphone audio into it and showing a loader while a beginner said "allô"
   * five times and eventually gave up and hung up. Seventy-five seconds, and
   * nothing anywhere said the call was dead.
   *
   * A pong is answered by the Worker itself and never reaches Google, so it is
   * the one frame whose absence means the relay and not the model. Missing one
   * is a bad ten seconds; missing three in a row, with the socket still open,
   * is not something a working relay does.
   *
   * THREE AND NOT TWO, because of what the two mistakes cost. Firing late
   * leaves a learner in silence a further ten seconds, which is the failure
   * already happening. Firing early hangs up a lesson that was fine. Two would
   * be twenty seconds and defensible; three is thirty and chosen for the same
   * reason STALL_NUDGE_MS is set clear of its measurement rather than snug
   * against it. The line at two is on the timeline either way, so an account
   * shows the onset even when the call recovers.
   */
  const RELAY_DEAD_PINGS = 3;
  let unanswered = 0;

  /**
   * The longest a tool response is held back waiting for the turn to finish.
   *
   * A BOUND ON A DEADLOCK THAT SHOULD NOT EXIST. `behavior: 'NON_BLOCKING'`
   * means the model does not stop for the result, so the turn it is speaking
   * completes whether or not this has gone out — and every call measured so
   * far behaves that way. If it ever does not, the model is waiting for a
   * frame this file is waiting to send it, and nothing else in the call breaks
   * that circle. So the hold expires.
   *
   * Five seconds because `turnComplete` is a server signal paced by
   * generation, not by playback: audio is produced faster than real time, so
   * it lands within a second or two of a turn starting even when the tutor has
   * five seconds of speech to get through. A hold that reaches five has not
   * met the case it was written for, and sending then is exactly what this
   * file did before — late, but never worse than the behaviour it replaced.
   */
  const RESPONSE_HOLD_MS = 5_000;
  /** Tool responses waiting for the turn in flight to end. See the tool call. */
  let heldResponses: unknown[] = [];
  let responseHold: number | null = null;

  /**
   * The next model turn is the one the tool response caused, and nobody hears it.
   *
   * ONLY EVER SET WHERE `SILENT` IS UNAVAILABLE. On AI Studio a tool response
   * schedules no generation, so there is no restart to catch and this stays
   * false for the whole call. Vertex implements neither `behavior:
   * 'NON_BLOCKING'` nor `scheduling: 'SILENT'` and ignores both rather than
   * refusing them, so delivering a result *is* a reason to generate. What it
   * generates is sometimes the turn it has already spoken, reworded — five
   * questions, five doubled turns, in the diagnostics this was written for —
   * and sometimes not a repeat at all but the *next* question, because the
   * prompt says every turn ends with one. That second shape is the worse of the
   * two and the reason the gate below changed: a duplicate is a tutor saying
   * something twice, while a turn ahead is a tutor asking question four of a
   * learner who has answered two, generated from context that predates a word
   * of their answer.
   *
   * WHY SUPPRESSION AND NOT SOMETHING CLEVERER. There is nothing cleverer
   * available. The fields are the mechanism, the mechanism is not on this
   * surface, and withholding the response instead leaves a blocking call
   * unanswered — which is the model stopped mid-lesson, a far worse failure
   * than a turn said twice. So the response goes out, on time, and the turn it
   * buys is dropped on this side.
   *
   * WHAT MAKES IT SAFE IS THE GATE, NOT THE GUESS, and the gate is whether
   * anybody is owed a reply. It arms at `turnComplete` when the learner has not
   * spoken since the tutor last made a sound: the tutor has already had its
   * say, so a further turn is the restart. When they *have* spoken — a
   * bookkeeping-only turn landing between their answer and the tutor's reply —
   * the restart is that reply, and arming would swallow the lesson rather than
   * the echo. That case sends the response and stays disarmed. See
   * `learnerSinceAudio`.
   *
   * IT IS A PREDICTION, AND IT EXPIRES ON A CLOCK RATHER THAN ON THEM. A
   * barge-in invalidates it, because a cut-off turn buys no restart. The
   * learner merely talking does not: the restart was bought when the response
   * went out and is generated from the context of that moment, so nothing they
   * say afterwards is in it. Believing otherwise is what let a duplicate
   * through at +0:13.7 on 2026-08-28. The failure it can still have is a Vertex
   * call that declines to restart, where one genuine turn is lost — bounded by
   * ECHO_WAIT_MS, and written down rather than silently discarded either way.
   * See onEchoTurn, and read the timeline before trusting this.
   */
  let echoArmed = false;
  /** When it was armed, for the expiry below. */
  let echoAt = 0;
  /** Whether the turn being dropped has actually said anything yet. */
  let echoSubstantive = false;

  /**
   * The longest the prediction waits for the restart it predicted.
   *
   * THE RESTART IS NOT PROMPT. Measured at 5.6 seconds once — the response
   * flushed at +0:08.0 and the duplicate's first audio landed at +0:13.7, with
   * the relay's socket to Google quiet for 4.8s of that. So the window has to
   * be generous or the prediction expires just before the thing it was waiting
   * for and lets it through, which is the failure it was armed against.
   *
   * Eight seconds, and it sits under STALL_NUDGE_MS deliberately: a Vertex call
   * that declines to restart costs one genuine turn, and the nudge is what asks
   * for another. Expiring first is what keeps that from being a lesson.
   */
  const ECHO_WAIT_MS = 8_000;

  const sendResponses = (responses: unknown[]) => {
    if (!responses.length || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
  };

  /** Lets go of anything held, whatever released it. */
  const flushResponses = () => {
    if (responseHold !== null) {
      clearTimeout(responseHold);
      responseHold = null;
    }
    const waiting = heldResponses;
    heldResponses = [];
    sendResponses(waiting);
  };

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (pings !== null) {
      clearInterval(pings);
      pings = null;
    }
    if (responseHold !== null) {
      clearTimeout(responseHold);
      responseHold = null;
    }
    mic.stop();
    player.close();
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };

  const ready = new Promise<void>((resolve, reject) => {
    /**
     * The opening frame carries the configuration, and nothing else does.
     *
     * The Worker holds the upstream socket unconfigured until this arrives,
     * then composes the `setup` itself: it still owns the model id and the key,
     * so what goes in here is the prompt and the knobs, not the spend. A raw
     * `setup` frame sent from this side is dropped on arrival.
     */
    socket.onopen = () => {
      socket.send(JSON.stringify({ config }));
    };

    socket.onerror = () => {
      reject(new Error('Could not reach the Gemini Live socket'));
    };

    socket.onclose = (event) => {
      if (!stopped) {
        // 1000 is a clean close; anything else ended the call unexpectedly and
        // the reason is the only clue the user gets.
        if (event.code === 1000) handlers.onStatus('closed');
        else handlers.onStatus('error', event.reason || `Socket closed (${event.code})`);
      }
      cleanup();
      reject(new Error(event.reason || 'Socket closed before setup completed'));
    };

    socket.onmessage = async (event) => {
      const raw =
        event.data instanceof Blob
          ? await event.data.text()
          : typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);

      let message: LiveMessage;
      try {
        message = JSON.parse(raw) as LiveMessage;
      } catch {
        return;
      }

      /*
       * The relay's own answer, which is not part of the conversation at all.
       * Read before everything else and returned from, so nothing downstream
       * has to know this frame exists.
       */
      if (typeof message.pong === 'number') {
        // Either pong is proof the relay is running: the direct one because it
        // left before the queue, the queued one because it got through it.
        unanswered = 0;
        handlers.onRelay?.({
          rttMs: Date.now() - message.pong,
          direct: message.direct === true,
          upgradeMs: typeof message.upgradeMs === 'number' ? message.upgradeMs : undefined,
          upstreamMaxGapMs:
            typeof message.upstreamMaxGapMs === 'number' ? message.upstreamMaxGapMs : undefined,
        });
        return;
      }

      // Usage rides alongside whatever else the frame carries, including the
      // frames we return early from below, so it is read first.
      if (message.usageMetadata) recordUsage(message.usageMetadata);

      if (message.setupComplete) {
        // Before anything else in this branch: it is what lets the microphone,
        // which has been open and discarding since the socket connected, start
        // putting the learner on the wire.
        setupDone = true;
        handlers.onStatus('live');
        /*
         * The pings start here rather than at `onopen`, so every sample is
         * taken on a socket carrying a live call. One goes out immediately —
         * a call that dies in its first ten seconds is exactly the one worth
         * having a reading for — and the rest follow on the interval.
         */
        const ping = () => {
          if (socket.readyState !== WebSocket.OPEN) return;
          unanswered += 1;
          /*
           * Reported before the send, so the count describes pings already gone
           * unanswered rather than including the one now leaving.
           */
          if (unanswered === RELAY_DEAD_PINGS) {
            handlers.onStatus(
              'error',
              `The relay stopped answering — ${RELAY_DEAD_PINGS - 1} pings went out with no ` +
                `reply and the socket never closed. Nothing was reaching this page; whether ` +
                `anything was still reaching Google, the pong cannot say.`,
            );
            cleanup();
            return;
          }
          if (unanswered === RELAY_DEAD_PINGS - 1) {
            handlers.onRelaySilent?.(unanswered - 1);
          }
          socket.send(JSON.stringify({ ping: Date.now() }));
        };
        ping();
        pings = window.setInterval(ping, PING_EVERY_MS);
        resolve();
        return;
      }

      /*
       * Tool calls, answered first and interpreted second.
       *
       * The response goes back whatever happens — an unknown tool name, a
       * handler that throws — because a blocking call leaves the model stopped
       * until it arrives. A tutor silently going quiet mid-lesson is a far
       * worse failure than a miscounted lesson, and this is the ordering that
       * makes the second one impossible to cause.
       *
       * `scheduling: 'SILENT'` is what keeps answering a call from becoming a
       * turn. Without it the result restarts the model, and the restart is a
       * fresh turn spoken on top of the one it had already spoken — which is
       * what made a tutor ask every question twice for as long as progress was
       * reported per question. It is a Gemini Developer API field: AI Studio
       * honours it, Vertex ignores it in silence. Sent only to the surface that
       * implements it, for the reason _setup.ts sends `behavior` only there —
       * a field the far end drops is a claim this file would otherwise be
       * making falsely about how the next turn will behave.
       *
       * IT LEAVES DEAD AIR BEHIND WHEN THE TURN IS ONLY THE CALL, and that is
       * the cost rather than a reason to drop it. A model that spends a whole
       * turn on the call and says nothing has, under SILENT, nothing left that
       * will ever make it speak again: the result goes into context, no
       * generation is scheduled, and the tutor is mute until the learner gives
       * up and talks first. Seen once, on question four of five — the call
       * arrived alone, the learner said their answer a second time into the
       * silence, then answered the next question themselves off the screen.
       *
       * WHAT DOES NOT WORK IS PREDICTING IT FROM `answering`. This briefly
       * answered WHEN_IDLE wherever the model had not spoken yet, on the
       * reasoning that a call arriving before any audio is a turn about to be
       * silent. The very next lesson measured it: all five calls arrived before
       * the model said anything, and all five turns then spoke perfectly
       * normally 0.8 seconds later. The test does not separate a turn that will
       * stay silent from a turn that has not started — this model simply emits
       * its bookkeeping first — so predicting from it scheduled a spare
       * generation on every question of the lesson, which is the doubled turn
       * SILENT is here to prevent.
       *
       * SO THE RECOVERY WAITS FOR THE SILENCE INSTEAD OF GUESSING AT IT. The
       * response is SILENT as it always was, and whether the model had spoken
       * when it called is passed up as a fact rather than acted on here — see
       * the stall watchdog in useVoiceCall, which arms on that and is disarmed
       * by the tutor speaking. Silence that actually happens is evidence;
       * silence that has not happened yet is a guess, and this file made it
       * once already.
       */
      if (message.toolCall?.functionCalls?.length) {
        const calls = message.toolCall.functionCalls;
        // Read before the response goes out, because answering it is exactly
        // what can make the model start talking.
        const spoken = answering;

        const responses = calls.map((call) => ({
          id: call.id,
          name: call.name,
          // Acknowledged, with nothing to say. The tutor is told in the
          // prompt that this produces no reply to read out; an object
          // with prose in it is prose a model will sometimes speak. The
          // scheduling rides inside the response object rather than
          // beside it, which is where the Live API reads it from.
          response: silentResponses ? { ok: true, scheduling: 'SILENT' } : { ok: true },
        }));

        /*
         * A call that arrived mid-speech is answered after the speech, not into
         * it.
         *
         * THE DOUBLED TURN CAME BACK, ON THE SURFACE THAT IMPLEMENTS SILENT. On
         * 2026-08-27 the tutor spoke "Moi ça va super bien, merci ! Dis-moi,
         * qui sont tes camarades de chambre cette année ?", called questionDone
         * 1.5s into that turn, finished it, and then said the identical
         * sentence again from a fresh set of audio frames. Both mitigations
         * were on the wire: `behavior: 'NON_BLOCKING'` on the declaration and
         * `scheduling: 'SILENT'` in the response, gated to AI Studio, which is
         * where this ran. So the note in models.ts that calls this a Vertex
         * problem is too strong — it happens here too, intermittently, and a
         * call landing 1.3s into a turn on an earlier lesson did not double.
         *
         * WHAT IS DEFERRED IS THE DELIVERY, NOT THE SCHEDULING, and that
         * distinction is the whole reason this is not the mistake recorded
         * above. Predicting a *value* from `answering` failed because the flag
         * does not separate a turn that will stay silent from one that has not
         * started. This reads the other flag — `spoken`, which is whether the
         * model had actually produced speech — and changes only when the same
         * SILENT response goes out. Every response is still sent, unchanged.
         *
         * SO THE BOOKKEEPING-FIRST TURN IS UNTOUCHED. On this model the call
         * usually arrives before a word of the turn, `spoken` is false, and it
         * is answered immediately exactly as before — that pattern has never
         * doubled. Only the mid-speech call waits, and it waits for the turn it
         * would otherwise land inside.
         *
         * NOTHING THE PAGE COUNTS MOVES. The report is dispatched below on the
         * frame that carried it, and `answerBegins` closes the learner's turn
         * there too; both read the call arriving, not the answer leaving. This
         * changes what Google is told and when, and nothing else.
         *
         * It is a hypothesis with two lessons behind it rather than a proof.
         * If doubling survives this, the next suspect is SILENT itself.
         */
        /*
         * ON A RESTART SURFACE, EVERY RESPONSE WAITS, AND `spoken` DOES NOT
         * DECIDE IT. Above, the hold is a mitigation for a mid-speech landing
         * and the ordinary bookkeeping-first call is answered at once. Here the
         * hold is load-bearing for a different reason: the restart is coming
         * whenever the response goes out, and the only question worth asking
         * about it — did this turn make a sound — cannot be answered until the
         * turn is over. Answering early does not avoid the doubled turn, it
         * just means arriving at `turnComplete` with the duplicate already in
         * flight and nothing left to decide.
         *
         * So the response is held to the end of the turn on this surface
         * always, and the arming happens where the answer is known.
         */
        if ((silentResponses && spoken) || !silentResponses) {
          heldResponses.push(...responses);
          if (responseHold === null) {
            responseHold = window.setTimeout(() => {
              responseHold = null;
              flushResponses();
            }, RESPONSE_HOLD_MS);
          }
        } else {
          sendResponses(responses);
        }

        // Reported before it is interpreted, and reported whatever the name is.
        // A tool this build does not implement is answered above and would
        // otherwise vanish without trace — which is precisely the call that
        // wrecks a conversation, because answering it is what restarts the model
        // into a turn it has already spoken. See onToolCall in types.ts.
        for (const call of calls) {
          handlers.onToolCall?.(call.name ?? '(unnamed)', call.args, spoken);
        }
        /*
         * Passed on as the frame carried them: all of it, unfiltered, in one
         * handoff. The believing happens in useVoiceCall.
         *
         * A FRAME IS ONE DECISION, WHICH IS WHY THEY GO TOGETHER. This used to
         * dispatch each call separately, on the reasoning that five calls is
         * five reports and collapsing them would be deciding something without
         * evidence. Measuring it showed the opposite: the tutor catches its
         * bookkeeping up in a single breath — `questionDone(2)` and
         * `questionDone(1)` arrived in one frame, then `(3)` and `(4)` in
         * another — and there is no order within a frame to respect, since the
         * model emitted them at once. Handing them over one at a time made them
         * look like separate moments and invited the layer above to hold the
         * second against the first for arriving too soon.
         */
        /*
         * The learner's turn ends here, and not when the tutor starts talking.
         *
         * A TOOL CALL IS THIS TURN BEGINNING. The rule above `answerBegins` is
         * that the only thing on the wire saying the learner has stopped is the
         * model starting to answer — the server's own voice detection, read at
         * the earliest honest moment. A frame of bookkeeping is the model
         * answering: it is generated in response to that same judgement, and on
         * this model it arrives first, about eight tenths of a second ahead of
         * the audio. So it is the earlier honest moment, and the one to use.
         *
         * WITHOUT THIS THE REPORT IT CARRIES CANNOT BE BELIEVED. `acceptProgress`
         * refuses a report the learner has not spoken enough times to have
         * earned, and the tutor is now told to report a question as the learner
         * finishes answering it — so the report for question five arrives while
         * the fifth answer is still, on this side, an open turn. It would be
         * refused, never repaired, and the lesson would run to the cap with
         * every question answered. Closing the turn here is what makes the
         * count and the claim describe the same moment.
         *
         * AFTER `spoken` IS READ, NEVER BEFORE. That flag is the evidence the
         * stall watchdog arms on, and it has to mean "had the model said
         * anything when it called" rather than "has this turn begun".
         */
        answerBegins();

        const numbers = calls
          .filter((call) => call.name === PROGRESS_TOOL)
          .map((call) => (call.args as { number?: unknown } | undefined)?.number)
          .map((number) => (typeof number === 'number' ? number : undefined));
        if (numbers.length) handlers.onQuestionDone?.(numbers);
        return;
      }

      const content = message.serverContent;
      if (!content) return;

      // Barge-in. Everything already queued is audio the user talked over, so
      // dropping it is the whole point — without this the agent keeps talking
      // for seconds after being interrupted.
      if (content.interrupted) {
        player.clear();
        handlers.onSpeaking?.(false);
        handlers.onInterrupted?.();
        // The turn was cut off rather than completed, so no turnComplete is
        // coming to reset these. Whatever the model says next is a new answer,
        // and it has a new user turn in front of it to close.
        answering = false;
        audioThisTurn = false;
        turnBeganAt = 0;
        generatedAt = 0;
        // Dropped rather than flushed, which is the same judgement `player.clear()`
        // just made about the sound: words still waiting on audio that has been
        // thrown away were never heard, and showing them would put a sentence on
        // screen that the learner is certain no voice ever said.
        firstTextAt = 0;
        pendingText = '';
        // A cut-off turn buys no restart, and whatever comes next is a fresh
        // answer, so the prediction below has nothing left to catch. This is
        // the one thing other than the turn itself that spends the arming —
        // the learner merely speaking no longer does. See the transcription
        // branch below.
        echoArmed = false;
        echoSubstantive = false;
      }

      if (content.inputTranscription?.text) {
        heardLearner = true;
        learnerSinceAudio = true;
        /*
         * THE LEARNER SPEAKING NO LONGER DISARMS THIS, and that reversal is the
         * whole fix. The old rule read their speech as proof that the next
         * model turn would answer them rather than repeat anyone — true on a
         * surface where a tool response schedules nothing, and false here. The
         * restart is bought at the moment the response goes out and is
         * generated from the context that existed then; what the learner says
         * afterwards does not reach it. On 2026-08-28 the tutor's turn at
         * +0:14.0 opened 0.3s before the microphone even closed and commented
         * on "amis musiciens", a phrase nowhere in the learner's answer —
         * generation that predated a word of it, let through because they had
         * started talking at +0:11.9 and disarmed the catch.
         *
         * So the arming is spent by the turn it predicted or by the clock, and
         * never by them. See ECHO_WAIT_MS.
         */
        handlers.onTranscript({ role: 'user', text: content.inputTranscription.text, done: false });
      }

      /*
       * The duplicate turn, dropped whole.
       *
       * NOTHING IS PARTIALLY SUPPRESSED, which is why this sits above every
       * consumer rather than being threaded through them. The words, the sound,
       * the turn-audio line, the speaking flag and the transcript's own
       * end-of-turn marker are one turn between them; suppressing the audio and
       * letting the text through would put a sentence on screen no voice ever
       * said, which is the exact failure `pendingText` exists to prevent.
       *
       * The turn is still counted where counting matters. A tool call in here
       * would be handled above this line — the branch returns before reaching
       * it — and progress was reported off the original turn in any case.
       */
      if (echoArmed) {
        /*
         * AN EMPTY `turnComplete` IS NOT THE RESTART, and letting one count as
         * it is how the duplicate got through at +0:13.7 on 2026-08-28: the
         * arming was spent 100ms after the flush — far too soon for Vertex to
         * have generated anything — by a trailing frame belonging to the turn
         * that had just ended. So the prediction is only spent by a turn that
         * actually said something, and a bare stamp passes through unspent.
         */
        if (Date.now() - echoAt > ECHO_WAIT_MS) {
          // The restart never came. One genuine turn is worth more than a
          // catch that has stopped catching anything, so this lets go.
          echoArmed = false;
          echoSubstantive = false;
        } else {
          if (
            content.outputTranscription?.text ||
            (content.modelTurn?.parts ?? []).some((part) => part.inlineData?.data)
          ) {
            echoSubstantive = true;
          }
          if (content.turnComplete && echoSubstantive) {
            echoArmed = false;
            echoSubstantive = false;
            handlers.onEchoTurn?.();
          }
          return;
        }
      }

      if (content.outputTranscription?.text) {
        answerBegins();
        if (!firstTextAt) firstTextAt = Date.now();
        if (audioThisTurn) {
          handlers.onTranscript({
            role: 'agent',
            text: content.outputTranscription.text,
            done: false,
            /**
             * Read *before* the audio in this same frame is enqueued below, so
             * the stamp is when that audio starts rather than when it ends. The
             * two describe the same moment of speech — Google sends the words
             * alongside the sound of them — and the queue is what makes them
             * arrive early together.
             */
            at: player.scheduledAt(),
          });
        } else {
          /*
           * NOTHING HAS SOUNDED FOR THIS TURN YET, so there is no honest answer
           * to when these words will be heard, and the queue's own answer is
           * the dishonest one: `scheduledAt()` on a drained queue says "now",
           * which is a promise that the voice is already playing. Held until
           * the audio arrives and can say. See `firstTextAt`.
           */
          pendingText += content.outputTranscription.text;
        }
      }

      for (const part of content.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (!data) continue;
        // Belt and braces with the transcription above: the words and the sound
        // of them travel in the same frame, but nothing promises which field a
        // turn opens with, and a turn that opened on audio alone would leave
        // the learner's own sentence uncommitted.
        answerBegins();
        if (!audioThisTurn) {
          audioThisTurn = true;
          // The tutor has had its say on whatever they last told it, so from
          // here nobody is owed a reply until they speak again.
          learnerSinceAudio = false;
          // Before the enqueue, or the schedules read here are the time the
          // chunk *ends* rather than the time it starts.
          const tap = player.tap();
          const at = player.scheduledAt();
          handlers.onTurnAudio?.({
            leadSeconds: tap ? tap.scheduledAt() - tap.now() : 0,
            // Zero on the ordinary turn, whose words are in this same frame.
            // Anything else is the split — see `firstTextAt`.
            afterTextMs: firstTextAt ? Date.now() - firstTextAt : undefined,
          });
          // The words this turn opened with, if they arrived ahead of its sound.
          flushPendingText(at);
        }
        handlers.onSpeaking?.(true);
        player.enqueue(decodeBase64(data), () => handlers.onSpeaking?.(false));
      }

      // Nothing but a stamp. The turn is not over — seconds of audio may still
      // be queued behind this — and the only reader is the line below.
      if (content.generationComplete && !generatedAt) generatedAt = Date.now();

      if (content.turnComplete) {
        /*
         * A turn that finished without making a sound, reported as a fact.
         *
         * THE ONLY TURN THAT EARNS A LINE. Every turn completes, and a line per
         * turn would double the length of an account whose whole value is that
         * somebody reads it to the end. A turn that completed silently is the
         * one that carries information: it is the dead-air case the stall
         * watchdog spends ten seconds guessing at, and if this frame really
         * does arrive for it then the guess can be replaced by the fact. See
         * `turnBeganAt`.
         */
        if (!audioThisTurn && turnBeganAt) {
          handlers.onSilentTurn?.({
            tookMs: Date.now() - turnBeganAt,
            generatedMs: generatedAt ? generatedAt - turnBeganAt : undefined,
            // A silent turn that still produced words is a different animal
            // from one that produced nothing: the tutor said something and no
            // sound of it ever came, rather than the tutor spending the turn on
            // bookkeeping. Only the second is the SILENT-scheduling case the
            // stall watchdog was built for.
            textMs: firstTextAt ? Date.now() - firstTextAt : undefined,
          });
        }

        /*
         * A turn can end with words still waiting on sound that never came —
         * the silent-turn line above is that fact. Unlike a barge-in there is
         * nothing dishonest about showing them: no audio was discarded, the
         * turn is simply over, and the words are the learner's only record of
         * what the tutor meant to say. Stamped now, because now is when the
         * page found out.
         */
        flushPendingText(player.scheduledAt());

        answering = false;
        audioThisTurn = false;
        turnBeganAt = 0;
        generatedAt = 0;
        firstTextAt = 0;
        pendingText = '';
        /*
         * The turn a mid-speech tool response was waiting to be clear of is
         * over, so it goes now. After `answering` is cleared rather than
         * before: a response arriving on this frame must not be read as
         * landing inside the turn it just closed.
         *
         * AND ON A RESTART SURFACE, THIS IS WHERE THE ECHO IS PREDICTED. The
         * response about to go out will buy a turn, and what decides whether
         * that turn is surplus is whether anybody is owed a reply — see
         * `learnerSinceAudio`, which is read rather than `audioThisTurn`
         * because a bookkeeping-only turn arriving after the tutor has already
         * asked its question buys a restart just as surplus as an audible
         * one's.
         */
        if (!silentResponses && heldResponses.length && !learnerSinceAudio) {
          echoArmed = true;
          echoAt = Date.now();
          echoSubstantive = false;
        }
        flushResponses();
        // The queue is about to run dry because the agent has stopped talking,
        // not because anything failed to arrive. Saying so keeps the player's
        // underrun logging honest — see PcmPlayer.endTurn.
        player.endTurn();
        // Stamped like the words were, so a consumer holding the turn back to
        // match the audio closes it when the audio ends rather than when the
        // socket says so — which is seconds earlier.
        handlers.onTranscript({ role: 'agent', text: '', done: true, at: player.scheduledAt() });
      }
    };
  });

  /**
   * PCM bytes sent since the microphone last opened. See MicSpan.
   *
   * Counted after the send rather than before it, so a socket that is not
   * open counts nothing — which is the whole point: an open microphone whose
   * span reports no audio is this browser failing to put the learner on the
   * wire, and that is a different fault from Google ignoring them.
   */
  let spanBytes = 0;
  /** Set if the microphone never opened, for the throw below to prefer. */
  let micError: string | null = null;

  /*
   * THE MICROPHONE OPENS ALONGSIDE THE SOCKET, NOT BEHIND IT.
   *
   * This used to be awaited after `ready`, which put `getUserMedia` and the
   * worklet fetch inside the silence before the tutor's greeting: the page
   * sends its opening note once `connect` resolves, and `connect` could not
   * resolve until the microphone was live. On a warm browser that is invisible
   * — two tenths of a second — but on the Chromebook in the 2026-08-27 set it
   * was 2.9s of dead air on a call that had been connected the whole time,
   * and a beginner meeting silence assumes the thing is broken or that they
   * are. Cheap to fix and the hardware it costs most on is the hardware a
   * class actually uses.
   *
   * NOT AWAITED AT ALL, which is the part that buys the time. Overlapping the
   * two would only save the shorter of them; returning without the microphone
   * means the greeting is asked for the instant the socket is ready. Nothing
   * is lost by that: the tutor speaks for seconds before anyone answers, and
   * `setupDone` above holds the audio until it would be accepted anyway.
   *
   * THE FAILURE PATH IS THE WHOLE COST OF IT. A denied permission used to be a
   * throw out of this function with the call not yet returned. Now it can land
   * either side of that line, so it does both: before setup it is remembered
   * and thrown by the `ready` handler below, and after it there is no throw
   * left to make and the status is the only channel back to the page.
   */
  void mic
    .start(
      (pcm) => {
        if (!setupDone || socket.readyState !== WebSocket.OPEN) return;
        // Read before the send: encodeBase64 copies rather than detaching, but
        // the length is free here and this way the count cannot depend on that
        // staying true. Same care MicCapture takes handing the buffer over.
        const bytes = pcm.byteLength;
        socket.send(
          JSON.stringify({
            realtimeInput: {
              audio: {
                mimeType: `audio/pcm;rate=${GEMINI_INPUT_RATE}`,
                data: encodeBase64(pcm),
              },
            },
          }),
        );
        spanBytes += bytes;
      },
      /*
       * The edge, and on the falling one what went up during it.
       *
       * Nothing here has an opinion about what the user starting to talk means
       * — the gesture it feeds is the face's business. The accounting is this
       * file's, because this file owns the socket the audio is counted against.
       *
       * MicCapture calls this from `listen`, which runs *before* `onChunk` for
       * the same chunk, so the closing chunk lands in the next span rather than
       * this one. That is one chunk — 128ms — misattributed at each edge, and
       * far below anything the line it feeds is read for.
       */
      (active) => {
        if (active) {
          spanBytes = 0;
          handlers.onVoice?.(true);
          return;
        }
        const bytes = spanBytes;
        spanBytes = 0;
        handlers.onVoice?.(false, { bytes, seconds: bytes / mic.bytesPerSecond });
      },
    )
    .then(() => {
      // The call was torn down while permission was still being asked for, so
      // the stream this just opened has nobody left to belong to. `cleanup`
      // already ran its own `mic.stop()` against a capture that had not
      // started yet, and that one did nothing.
      if (stopped) mic.stop();
    })
    .catch(() => {
      micError = 'Microphone permission denied';
      // After setup there is no throw left to make — the session has been
      // handed back and the page is showing a live call. Before it, the
      // rejection below carries this instead, so it is not said twice.
      if (setupDone) handlers.onStatus('error', micError);
      cleanup();
    });

  try {
    await ready;
  } catch (error) {
    cleanup();
    // A microphone that never opened closes the socket underneath the
    // handshake, so the rejection that arrives says the socket closed before
    // setup — true, and not the reason anybody needs.
    throw micError ? new Error(micError) : error;
  }

  return {
    // Non-null by here: resume() built the context before anything was awaited.
    tap: player.tap(),
    /*
     * `turnComplete: true`, so the model answers rather than waiting for more.
     * Sent as a user turn because that is the only role Live accepts from a
     * client; the learner never sees it, since what they see is built from the
     * microphone's own transcription.
     */
    say: (text: string) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(
        JSON.stringify({
          clientContent: {
            turns: [{ role: 'user', parts: [{ text }] }],
            turnComplete: true,
          },
        }),
      );
    },
    setMuted: (muted) => mic.setMuted(muted),
    stop: () => {
      cleanup();
      handlers.onStatus('closed');
    },
  };
}
