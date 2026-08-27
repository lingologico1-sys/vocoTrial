import { MicCapture, PcmPlayer, decodeBase64, encodeBase64 } from './audio';
import { addUsage, emptyUsage, totalTokens, type UsageTotals } from './cost';
import { UnauthorizedError, checkSession, reportExpired } from './auth';
import type { SessionConfig, SessionHandlers, VoiceSession } from './types';
import { findModel } from './models';
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
  /** The upstream socket's longest quiet since the last pong. See onRelay. */
  googleMaxGapMs?: number;
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
   */
  const silentResponses = findModel(modelKey)?.surface === 'aistudio';

  const mic = new MicCapture();
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

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (pings !== null) {
      clearInterval(pings);
      pings = null;
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
        handlers.onRelay?.({
          rttMs: Date.now() - message.pong,
          upgradeMs: typeof message.upgradeMs === 'number' ? message.upgradeMs : undefined,
          googleMaxGapMs:
            typeof message.googleMaxGapMs === 'number' ? message.googleMaxGapMs : undefined,
        });
        return;
      }

      // Usage rides alongside whatever else the frame carries, including the
      // frames we return early from below, so it is read first.
      if (message.usageMetadata) recordUsage(message.usageMetadata);

      if (message.setupComplete) {
        handlers.onStatus('live');
        /*
         * The pings start here rather than at `onopen`, so every sample is
         * taken on a socket carrying a live call. One goes out immediately —
         * a call that dies in its first ten seconds is exactly the one worth
         * having a reading for — and the rest follow on the interval.
         */
        const ping = () => {
          if (socket.readyState !== WebSocket.OPEN) return;
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

        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              toolResponse: {
                functionResponses: calls.map((call) => ({
                  id: call.id,
                  name: call.name,
                  // Acknowledged, with nothing to say. The tutor is told in the
                  // prompt that this produces no reply to read out; an object
                  // with prose in it is prose a model will sometimes speak. The
                  // scheduling rides inside the response object rather than
                  // beside it, which is where the Live API reads it from.
                  response: silentResponses ? { ok: true, scheduling: 'SILENT' } : { ok: true },
                })),
              },
            }),
          );
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
      }

      if (content.inputTranscription?.text) {
        heardLearner = true;
        handlers.onTranscript({ role: 'user', text: content.inputTranscription.text, done: false });
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

  try {
    await ready;
  } catch (error) {
    cleanup();
    throw error;
  }

  try {
    await mic.start(
      (pcm) => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(
          JSON.stringify({
            realtimeInput: {
              audio: { mimeType: 'audio/pcm;rate=16000', data: encodeBase64(pcm) },
            },
          }),
        );
      },
      // Passed straight through. Nothing on this side has an opinion about what
      // the user starting to talk means — the socket does not need to know, and
      // the gesture it feeds is the face's business.
      (active) => handlers.onVoice?.(active),
    );
  } catch {
    cleanup();
    throw new Error('Microphone permission denied');
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
