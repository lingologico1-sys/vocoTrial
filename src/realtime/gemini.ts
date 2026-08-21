import { MicCapture, PcmPlayer, decodeBase64, encodeBase64 } from './audio';
import { addUsage, emptyUsage, totalTokens, type UsageTotals } from './cost';
import { UnauthorizedError, checkSession, reportExpired } from './auth';
import type { SessionConfig, SessionHandlers, VoiceSession } from './types';
import { COMPLETE_TOOL } from './vocoSessions';

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
    turnComplete?: boolean;
  };
  goAway?: { timeLeft?: string };
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

  const mic = new MicCapture();
  const player = new PcmPlayer();
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
   */
  let answering = false;

  /** Emitted once per model turn: their turn ended when this one began. */
  const answerBegins = () => {
    if (answering) return;
    answering = true;
    handlers.onTranscript({ role: 'user', text: '', done: true });
  };

  let stopped = false;
  const socket = new WebSocket(liveSocketUrl(modelKey, language));
  socket.binaryType = 'arraybuffer';

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
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

      // Usage rides alongside whatever else the frame carries, including the
      // frames we return early from below, so it is read first.
      if (message.usageMetadata) recordUsage(message.usageMetadata);

      if (message.setupComplete) {
        handlers.onStatus('live');
        resolve();
        return;
      }

      /*
       * Tool calls, answered first and interpreted second.
       *
       * The response goes back whatever happens — an unknown tool name, a
       * handler that throws — because on Vertex every call is blocking and the
       * model is stopped until it arrives. A tutor silently going quiet
       * mid-lesson is a far worse failure than a miscounted lesson, and this is
       * the ordering that makes the second one impossible to cause.
       *
       * Sending it does restart the model into a fresh turn, and nothing here
       * can prevent that — `scheduling: 'SILENT'` is the field for it and Vertex
       * does not implement it. That restart is why the one tool left is called
       * once, at the end, where the turn it produces is followed by the closing
       * note anyway. See COMPLETE_TOOL in vocoSessions.ts.
       */
      if (message.toolCall?.functionCalls?.length) {
        const calls = message.toolCall.functionCalls;
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({
              toolResponse: {
                functionResponses: calls.map((call) => ({
                  id: call.id,
                  name: call.name,
                  // Acknowledged, with nothing to say. The tutor is told in the
                  // prompt that this produces no reply to read out; an object
                  // with prose in it is prose a model will sometimes speak.
                  response: { ok: true },
                })),
              },
            }),
          );
        }

        if (calls.some((call) => call.name === COMPLETE_TOOL)) handlers.onLessonComplete?.();
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
        // coming to reset this. Whatever the model says next is a new answer,
        // and it has a new user turn in front of it to close.
        answering = false;
      }

      if (content.inputTranscription?.text) {
        handlers.onTranscript({ role: 'user', text: content.inputTranscription.text, done: false });
      }

      if (content.outputTranscription?.text) {
        answerBegins();
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
      }

      for (const part of content.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (!data) continue;
        // Belt and braces with the transcription above: the words and the sound
        // of them travel in the same frame, but nothing promises which field a
        // turn opens with, and a turn that opened on audio alone would leave
        // the learner's own sentence uncommitted.
        answerBegins();
        handlers.onSpeaking?.(true);
        player.enqueue(decodeBase64(data), () => handlers.onSpeaking?.(false));
      }

      if (content.turnComplete) {
        answering = false;
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
