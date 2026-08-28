import { MicCapture, PcmPlayer, decodeBase64, encodeBase64 } from './audio';
import { addUsage, emptyUsage, type UsageTotals } from './cost';
import { UnauthorizedError, checkSession, reportExpired } from './auth';
import type { SessionConfig, SessionHandlers, VoiceSession } from './types';
import { PROGRESS_TOOL } from './tutorPrompt';

/**
 * OpenAI realtime, through our own Worker.
 *
 * THE SIBLING OF gemini.ts, AND DELIBERATELY SHORTER. Everything above the
 * socket is shared — SessionHandlers is the whole contract, and useVoiceCall,
 * Eleve, the reveal queue and the face have no idea which of these two files is
 * running. What differs is the wire, and the wire is simpler here in the one
 * place that has cost this project the most: tool calls.
 *
 * WHAT IS NOT IN THIS FILE, and the absence is the point. Gemini's tool
 * handling carries `scheduling: 'SILENT'`, a five-second deferral queue, a
 * held-response list and roughly two hundred lines of commentary, all of it
 * fighting one behaviour: answering a tool call restarts the model into a turn
 * spoken on top of the one it already spoke. That cannot happen here. A
 * function call is an item in a response the model has already finished, and
 * returning its output schedules nothing at all. The turn continues only if we
 * ask for one — see the `response.done` handling, which asks exactly when the
 * turn produced no audio, and knows rather than guesses.
 *
 * There is no WebRTC doing the media work here either, so this file owns the
 * whole loop: mic -> int16 -> base64 -> socket, and socket -> base64 -> int16
 * -> scheduled playback. See src/realtime/audio.ts for both halves, and
 * functions/api/live/openai.ts for why WebRTC was available and declined.
 */

/**
 * The rate this provider's raw PCM must be at, in both directions.
 *
 * Gemini takes 16 kHz in and gives 24 kHz back; this is 24 kHz both ways, which
 * makes the output side a coincidence rather than a simplification — PcmPlayer
 * was already running at OUTPUT_SAMPLE_RATE. The input side is the one that
 * matters: `audio/pcm` is documented at 24000 alone here.
 */
const OPENAI_INPUT_RATE = 24_000;

function liveSocketUrl(modelKey: string, language: string): string {
  const url = new URL('/api/live/openai', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  // Short, fixed-vocabulary keys, so the query string is the natural place for
  // them. The prompt, the settings and the keywords are not — those go in the
  // opening frame. Same split as the Gemini client, and the same reason.
  url.searchParams.set('model', modelKey);
  url.searchParams.set('language', language);
  return url.toString();
}

/** One item in a finished response. Audio, text, or a function call. */
interface ResponseItem {
  type?: string;
  id?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  content?: Array<{ type?: string }>;
}

/**
 * What `response.done` reports. `cached_tokens` is a *subset* of the text and
 * audio input counts, not a seventh bucket — see reshapeUsage.
 */
interface RealtimeUsage {
  input_token_details?: {
    text_tokens?: number;
    audio_tokens?: number;
    cached_tokens?: number;
    cached_tokens_details?: { text_tokens?: number; audio_tokens?: number };
  };
  output_token_details?: { text_tokens?: number; audio_tokens?: number };
}

interface RealtimeEvent {
  type?: string;
  /** The conversation item the event belongs to — our transcript turn key. */
  item_id?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  response?: {
    usage?: RealtimeUsage;
    output?: ResponseItem[];
    status?: string;
  };
  /** The relay answering a ping of ours. Never OpenAI — see the Worker. */
  pong?: number;
  upgradeMs?: number;
  direct?: boolean;
  upstreamMaxGapMs?: number;
}

/**
 * Turns one response's usage into disjoint billing buckets.
 *
 * RECOVERED RATHER THAN REWRITTEN. This function was correct when it was
 * deleted with the WebRTC path and is correct now; git is a better source than
 * a second derivation, and the subtlety below is exactly what a rewrite would
 * have got wrong.
 *
 * Cached tokens are subtracted out of the counts that contain them, so nothing
 * is priced twice. When the API reports a `cached_tokens` total without the
 * per-modality split, the cached share is apportioned across text and audio in
 * the same ratio as the input itself — guessing "all audio" would misprice by a
 * wide margin, and the two rates are eighty times apart on this model.
 *
 * IT MATTERS FAR MORE HERE THAN IT USED TO. Cached audio input is $0.40 per
 * million against $32 uncached, and a realtime API re-sends the whole
 * conversation as input on every turn — so on a fifteen-minute lesson the
 * cached bucket is most of the tokens and almost none of the bill. Reading it
 * as uncached would overstate a lesson's cost by roughly the length of the
 * lesson. See cost.ts, which has the comparison this makes possible.
 */
function reshapeUsage(usage: RealtimeUsage): UsageTotals {
  const input = usage.input_token_details ?? {};
  const output = usage.output_token_details ?? {};

  const text = input.text_tokens ?? 0;
  const audio = input.audio_tokens ?? 0;

  let cachedText = input.cached_tokens_details?.text_tokens ?? 0;
  let cachedAudio = input.cached_tokens_details?.audio_tokens ?? 0;

  if (!input.cached_tokens_details && input.cached_tokens) {
    const total = text + audio;
    const audioShare = total > 0 ? audio / total : 0;
    cachedAudio = Math.round(input.cached_tokens * audioShare);
    cachedText = input.cached_tokens - cachedAudio;
  }

  return {
    textInput: Math.max(0, text - cachedText),
    cachedTextInput: Math.min(cachedText, text),
    audioInput: Math.max(0, audio - cachedAudio),
    cachedAudioInput: Math.min(cachedAudio, audio),
    textOutput: output.text_tokens ?? 0,
    audioOutput: output.audio_tokens ?? 0,
  };
}

export async function startOpenAiSession(
  handlers: SessionHandlers,
  modelKey: string,
  language: string,
  config: SessionConfig = {},
): Promise<VoiceSession> {
  handlers.onStatus('connecting');

  const mic = new MicCapture(OPENAI_INPUT_RATE);
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
   * cookie would otherwise surface as "could not reach the socket" and send
   * someone debugging the relay instead of signing back in.
   */
  const { authed } = await checkSession();
  if (!authed) {
    player.close();
    reportExpired();
    throw new UnauthorizedError();
  }

  /**
   * Summed across responses, which is what the bill does too.
   *
   * NO CUMULATIVE-OR-PER-TURN DETECTION HERE, and gemini.ts's is not a bug this
   * file inherited a fix for — it is a real ambiguity in Google's docs, which
   * do not say which their totals are. This API is unambiguous: `response.done`
   * reports that response. Every response re-sends the whole conversation as
   * input and is charged for it, discounted where the prefix cached, so
   * reporting only the last would understate a long call by most of its cost.
   */
  let usage = emptyUsage();

  /**
   * Items whose transcript arrived as deltas, so the completion event knows not
   * to append the same words a second time.
   *
   * Only the streaming transcription models populate it; whisper-1, which is
   * what openAiSession pins unless a bench asks otherwise, leaves it empty for
   * the whole call and sends every utterance whole.
   *
   * THERE IS NO `heardLearner` FLAG BESIDE IT, and there was one briefly.
   * gemini.ts needs that flag because the only thing on its wire saying the
   * learner has finished is the model starting to answer, which also happens
   * for the greeting — a turn the learner never took. Nothing here closes a
   * learner turn except a transcription of one, so there is no turn to guard
   * against crediting.
   */
  const streamed = new Set<string>();

  /** Whether any audio has arrived on the socket for the turn now being spoken. */
  let audioThisTurn = false;
  /** The assistant item now speaking, for a truncate to name. */
  let speakingItemId: string | null = null;
  /** When this turn's first words arrived, and those words while sound has not. */
  let firstTextAt = 0;
  let pendingText = '';
  let turnBeganAt = 0;

  const flushPendingText = (at: number) => {
    if (!pendingText) return;
    handlers.onTranscript({ role: 'agent', text: pendingText, done: false, at });
    pendingText = '';
  };

  let stopped = false;
  /**
   * Whether the far end has accepted our session configuration.
   *
   * THE GATE ON THE MICROPHONE, and it guards something Gemini's does not.
   * There, a `realtimeInput` frame arriving before setup is refused, so the
   * gate stops audio being thrown away. Here the session is *live* the moment
   * the socket opens — running on OpenAI's own defaults, with no instructions,
   * no tool and no voice — so audio sent before `session.updated` would be
   * answered by a tutor that is not the lesson's. Dropped rather than queued:
   * it is the half-second before the greeting and nobody is answering yet.
   */
  let setupDone = false;
  const socket = new WebSocket(liveSocketUrl(modelKey, language));
  socket.binaryType = 'arraybuffer';

  /** See gemini.ts — the relay health protocol is shared and unchanged. */
  const PING_EVERY_MS = 10_000;
  let pings: number | null = null;
  const RELAY_DEAD_PINGS = 3;
  let unanswered = 0;

  const send = (payload: unknown) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(payload));
  };

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

  /**
   * The learner talked over the tutor. Stop the sound, and correct the record.
   *
   * THE SECOND HALF IS THE ONE GEMINI CANNOT DO. Dropping the queued audio is
   * what both providers do, and it is why the tutor stops mid-word. `truncate`
   * is what tells the *model* it stopped mid-word: without it, the transcript
   * it reasons from for the rest of the lesson contains sentences the learner
   * never heard, and it will refer back to them. See `heardMs` on PcmPlayer.
   *
   * READ BEFORE THE CLEAR, because clearing resets the turn clock this asks
   * for. That ordering is the whole of the correctness here.
   */
  const bargeIn = () => {
    const itemId = speakingItemId;
    const heard = player.heardMs();
    player.clear();
    handlers.onSpeaking?.(false);
    handlers.onInterrupted?.();
    if (itemId) {
      send({
        type: 'conversation.item.truncate',
        item_id: itemId,
        content_index: 0,
        audio_end_ms: heard,
      });
    }
    speakingItemId = null;
    audioThisTurn = false;
    turnBeganAt = 0;
    // Dropped rather than flushed, which is the same judgement `player.clear()`
    // just made about the sound: words still waiting on audio that has been
    // thrown away were never heard, and showing them would put a sentence on
    // screen that the learner is certain no voice ever said.
    firstTextAt = 0;
    pendingText = '';
  };

  const ready = new Promise<void>((resolve, reject) => {
    /**
     * The opening frame carries the configuration, and nothing else does.
     *
     * The Worker holds the session unconfigured until this arrives, then
     * composes the `session.update` itself: it owns the model id and the key,
     * so what goes in here is the prompt, the knobs and the lesson's keywords,
     * not the spend. A `session.update` sent from this side is dropped on
     * arrival.
     */
    socket.onopen = () => {
      send({ config });
    };

    socket.onerror = () => {
      reject(new Error('Could not reach the OpenAI realtime socket'));
    };

    socket.onclose = (event) => {
      if (!stopped) {
        if (event.code === 1000) handlers.onStatus('closed');
        else handlers.onStatus('error', event.reason || `Socket closed (${event.code})`);
      }
      cleanup();
      reject(new Error(event.reason || 'Socket closed before the session was configured'));
    };

    socket.onmessage = async (event) => {
      const raw =
        event.data instanceof Blob
          ? await event.data.text()
          : typeof event.data === 'string'
            ? event.data
            : new TextDecoder().decode(event.data as ArrayBuffer);

      let message: RealtimeEvent;
      try {
        message = JSON.parse(raw) as RealtimeEvent;
      } catch {
        return;
      }

      // The relay's own answer, which is not part of the conversation at all.
      if (typeof message.pong === 'number') {
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

      switch (message.type) {
        case 'session.updated': {
          if (setupDone) return;
          setupDone = true;
          handlers.onStatus('live');
          const ping = () => {
            if (socket.readyState !== WebSocket.OPEN) return;
            unanswered += 1;
            if (unanswered === RELAY_DEAD_PINGS) {
              handlers.onStatus(
                'error',
                `The relay stopped answering — ${RELAY_DEAD_PINGS - 1} pings went out with no ` +
                  `reply and the socket never closed. Nothing was reaching this page; whether ` +
                  `anything was still reaching OpenAI, the pong cannot say.`,
              );
              cleanup();
              return;
            }
            if (unanswered === RELAY_DEAD_PINGS - 1) handlers.onRelaySilent?.(unanswered - 1);
            send({ ping: Date.now() });
          };
          ping();
          pings = window.setInterval(ping, PING_EVERY_MS);
          resolve();
          return;
        }

        /*
         * The server heard the learner start. Two quite different jobs.
         *
         * A barge-in, when the tutor was speaking — which the server has
         * already acted on its own side, so the truncate below is us catching
         * its record up with what was actually audible rather than us asking
         * for anything.
         *
         * And, either way, the earliest the *provider* says the learner is
         * talking. MicCapture says it sooner and locally, which is what drives
         * the face; this is the corroboration that separates "this browser
         * heard them" from "the audio arrived". gemini.ts has no counterpart
         * and infers the whole thing — see `answerBegins` there.
         */
        case 'input_audio_buffer.speech_started':
          if (audioThisTurn || speakingItemId) bargeIn();
          return;

        /*
         * The learner stopped talking, and the server has closed their audio
         * buffer. Recorded, and deliberately not acted on.
         *
         * IT IS TEMPTING AND IT IS THE WRONG MOMENT. This looks like the event
         * gemini.ts spends forty lines approximating — there, nothing on the
         * wire says the learner stopped, so the closest honest moment is the
         * model beginning to answer. Here the fact arrives directly, and using
         * it to close the turn puts the close *ahead of the words*: whisper-1
         * is a batch transcriber, so the transcript of this utterance has not
         * been produced when this fires.
         *
         * WHAT THAT COSTS IS THE WHOLE TURN. `append` in useVoiceCall merges
         * text into the last *unfinished* turn of a role and never reopens a
         * closed one — a rule written for a good reason, since a two-word tail
         * arriving late must not overwrite an answer the learner is reading. So
         * a turn closed here is closed empty, and the transcript that follows
         * opens a second one that nothing ever closes. That is exactly the bug
         * the comment above `append` describes, arrived at from the other side.
         *
         * So the close lives on `...transcription.completed` below, which is
         * the moment the turn is both over and known. This case stays, empty,
         * because the next person reading the event list will have the same
         * good idea.
         */
        case 'input_audio_buffer.committed':
          return;

        case 'conversation.item.input_audio_transcription.delta':
          if (message.item_id) streamed.add(message.item_id);
          handlers.onTranscript({
            id: message.item_id,
            role: 'user',
            text: message.delta ?? '',
            done: false,
          });
          return;

        /*
         * The learner's turn, finished and transcribed.
         *
         * whisper-1 is the default here — see openAiSession — and it sends no
         * deltas at all: the whole utterance arrives here or not at all. The
         * streaming models send both, and would otherwise have every word
         * written down twice, so `streamed` remembers which items already
         * arrived piecemeal and this contributes only the close for those.
         *
         * THIS IS THE TURN BOUNDARY THE PROGRESS GUARD COUNTS IN. `done` here
         * increments `learnerTurns`, which is the ceiling `acceptProgress`
         * refuses reports against, so it must fire once per utterance and only
         * for utterances that happened. It does: an item is transcribed because
         * audio was committed for it, and the opening note this page sends is
         * text and commits nothing.
         */
        case 'conversation.item.input_audio_transcription.completed': {
          const already = message.item_id ? streamed.has(message.item_id) : false;
          if (message.item_id) streamed.delete(message.item_id);
          handlers.onTranscript({
            id: message.item_id,
            role: 'user',
            text: already ? '' : (message.transcript ?? ''),
            done: true,
          });
          return;
        }

        /*
         * The transcriber failed on an utterance the learner did speak.
         *
         * THE LOST ANSWER, STATED RATHER THAN INFERRED. useVoiceCall works this
         * out by noticing that the microphone was open for a good two seconds
         * and no transcription ever arrived — a sound inference which takes as
         * long as the silence it is inferring from. Here it is an event. The
         * turn is still closed, because it happened and the tutor is about to
         * answer it; it is closed empty, which is what `unheard` keys off.
         */
        case 'conversation.item.input_audio_transcription.failed':
          handlers.onTranscript({ id: message.item_id, role: 'user', text: '', done: true });
          return;

        case 'response.created':
          if (!turnBeganAt) turnBeganAt = Date.now();
          return;

        case 'response.output_audio_transcript.delta': {
          if (!turnBeganAt) turnBeganAt = Date.now();
          if (!firstTextAt) firstTextAt = Date.now();
          const text = message.delta ?? '';
          if (!text) return;
          if (audioThisTurn) {
            handlers.onTranscript({
              role: 'agent',
              text,
              done: false,
              // Read *before* any audio in flight is enqueued, so the stamp is
              // when that audio starts rather than when it ends.
              at: player.scheduledAt(),
            });
          } else {
            /*
             * NOTHING HAS SOUNDED FOR THIS TURN YET, so there is no honest
             * answer to when these words will be heard, and the queue's own
             * answer is the dishonest one: `scheduledAt()` on a drained queue
             * says "now", which is a promise that the voice is already playing.
             * Held until the audio arrives and can say. Same guard as
             * gemini.ts, written for a turn whose words beat its sound by six
             * seconds — a failure recorded on Gemini and not yet seen here,
             * kept because the queue lies the same way on both.
             */
            pendingText += text;
          }
          return;
        }

        case 'response.output_audio.delta': {
          const data = message.delta;
          if (!data) return;
          if (!turnBeganAt) turnBeganAt = Date.now();
          // The item this turn is speaking, remembered for a possible truncate.
          if (message.item_id) speakingItemId = message.item_id;
          if (!audioThisTurn) {
            audioThisTurn = true;
            // Before the enqueue, or the schedules read here are the time the
            // chunk *ends* rather than the time it starts.
            const tap = player.tap();
            const at = player.scheduledAt();
            handlers.onTurnAudio?.({
              leadSeconds: tap ? tap.scheduledAt() - tap.now() : 0,
              afterTextMs: firstTextAt ? Date.now() - firstTextAt : undefined,
            });
            flushPendingText(at);
          }
          handlers.onSpeaking?.(true);
          player.enqueue(decodeBase64(data), () => handlers.onSpeaking?.(false));
          return;
        }

        /*
         * The turn is over, and everything that has to be decided about it is
         * decided here from facts rather than from timers.
         *
         * THIS ONE FRAME REPLACES FOUR MECHANISMS IN gemini.ts. Whether the
         * turn spoke, whether a tool was called, whether the model is waiting
         * on anything, and whether the tutor is about to sit in silence — all
         * of it is in `response.output`, complete, at the moment the turn ends.
         * On the other provider those are, respectively: an audio flag, a
         * separate toolCall frame, a five-second deferral timer, and a
         * ten-second stall watchdog guessing after the fact.
         */
        case 'response.done': {
          if (message.response?.usage) {
            usage = addUsage(usage, reshapeUsage(message.response.usage));
            handlers.onUsage?.(usage);
          }

          const items = message.response?.output ?? [];
          const calls = items.filter((item) => item.type === 'function_call');
          /*
           * Whether this turn actually said anything, which is the fact the
           * whole decision below turns on.
           *
           * Read off the response's own items rather than off `audioThisTurn`.
           * They agree in every ordinary case; they disagree exactly when the
           * learner barged in, which cleared the flag — and a turn that was
           * interrupted did speak, however little of it was heard.
           */
          const spoke =
            audioThisTurn ||
            items.some((item) => item.type === 'message' || item.type === 'audio');

          /*
           * Every call is answered, and answering is all it does.
           *
           * The response object is minimal for the reason gemini.ts's is: the
           * tutor is told in the prompt that this produces no reply to read
           * out, and an object with prose in it is prose a model will sometimes
           * speak. There is no `scheduling` field and none is needed — see the
           * note at the top of this file.
           */
          for (const call of calls) {
            send({
              type: 'conversation.item.create',
              item: {
                type: 'function_call_output',
                call_id: call.call_id,
                output: JSON.stringify({ ok: true }),
              },
            });
          }

          /*
           * A turn spent entirely on bookkeeping is the one turn that needs
           * asking to continue.
           *
           * THE DEAD-AIR CASE, ANSWERED RATHER THAN WAITED OUT. A model that
           * calls its tool and says nothing has, on either provider, nothing
           * left that will make it speak again: the result goes into context
           * and no generation is scheduled. On Gemini that is unrecoverable
           * from the wire — `scheduling: 'SILENT'` means what it says — so
           * useVoiceCall arms a ten-second watchdog and nudges. Here it is one
           * message, sent at the moment the turn ends rather than ten seconds
           * later, and sent on a fact rather than on a silence that might yet
           * have been the model thinking.
           *
           * AND ONLY THEN. A response that spoke *and* called the tool needs
           * nothing further; asking for a turn there is precisely how the
           * doubled turn happens, which is the failure that cost this project
           * the most on the other provider. The condition is `!spoke`, it is
           * knowable, and it is knowable here and nowhere earlier.
           */
          if (calls.length && !spoke) {
            send({ type: 'response.create' });
          }

          // Reported before it is interpreted, and reported whatever the name
          // is. A tool this build does not implement is answered above and
          // would otherwise vanish without trace. See onToolCall in types.ts.
          for (const call of calls) {
            let args: Record<string, unknown> | undefined;
            try {
              args = call.arguments
                ? (JSON.parse(call.arguments) as Record<string, unknown>)
                : undefined;
            } catch {
              // The model sent something that is not JSON. Worth reporting the
              // call anyway — a malformed argument list is exactly the sort of
              // thing an account of a call should carry.
            }
            handlers.onToolCall?.(call.name ?? '(unnamed)', args, spoke);
          }

          const numbers = calls
            .filter((call) => call.name === PROGRESS_TOOL)
            .map((call) => {
              try {
                const parsed = call.arguments
                  ? (JSON.parse(call.arguments) as { number?: unknown })
                  : undefined;
                return typeof parsed?.number === 'number' ? parsed.number : undefined;
              } catch {
                return undefined;
              }
            });
          if (numbers.length) handlers.onQuestionDone?.(numbers);

          /*
           * A turn that finished without making a sound, reported as a fact.
           * Same line as gemini.ts writes, from a frame that unambiguously
           * arrives — which there was an open question on that provider.
           */
          if (!audioThisTurn && turnBeganAt) {
            handlers.onSilentTurn?.({
              tookMs: Date.now() - turnBeganAt,
              textMs: firstTextAt ? Date.now() - firstTextAt : undefined,
            });
          }

          // No audio was discarded, the turn is simply over, and the words are
          // the learner's only record of what the tutor meant to say.
          flushPendingText(player.scheduledAt());

          audioThisTurn = false;
          speakingItemId = null;
          turnBeganAt = 0;
          firstTextAt = 0;
          pendingText = '';
          // The queue is about to run dry because the agent has stopped
          // talking, not because anything failed to arrive.
          player.endTurn();
          // Stamped like the words were, so a consumer holding the turn back to
          // match the audio closes it when the audio ends rather than when the
          // socket says so — which is seconds earlier.
          handlers.onTranscript({ role: 'agent', text: '', done: true, at: player.scheduledAt() });
          return;
        }

        case 'error':
          handlers.onStatus('error', message.error?.message ?? 'Realtime error');
          return;
      }
    };
  });

  /** PCM bytes sent since the microphone last opened. See MicSpan. */
  let spanBytes = 0;
  /** Set if the microphone never opened, for the throw below to prefer. */
  let micError: string | null = null;

  /*
   * THE MICROPHONE OPENS ALONGSIDE THE SOCKET, NOT BEHIND IT.
   *
   * The argument is gemini.ts's in full and is not repeated here: awaiting the
   * microphone before returning puts `getUserMedia` and the worklet fetch
   * inside the silence before the tutor's greeting, which measured 2.9 seconds
   * of dead air on the Chromebook a class actually uses. `setupDone` above is
   * the gate, and audio caught before it is dropped rather than queued.
   */
  void mic
    .start(
      (pcm) => {
        if (!setupDone || socket.readyState !== WebSocket.OPEN) return;
        // Read before the send: encodeBase64 copies rather than detaching, but
        // the length is free here and this way the count cannot depend on that
        // staying true.
        const bytes = pcm.byteLength;
        send({ type: 'input_audio_buffer.append', audio: encodeBase64(pcm) });
        spanBytes += bytes;
      },
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
      // The call was torn down while permission was still being asked for.
      if (stopped) mic.stop();
    })
    .catch(() => {
      micError = 'Microphone permission denied';
      if (setupDone) handlers.onStatus('error', micError);
      cleanup();
    });

  try {
    await ready;
  } catch (error) {
    cleanup();
    // A microphone that never opened closes the socket underneath the
    // handshake, so the rejection that arrives says the socket closed before
    // the session was configured — true, and not the reason anybody needs.
    throw micError ? new Error(micError) : error;
  }

  return {
    // Non-null by here: resume() built the context before anything was awaited.
    tap: player.tap(),
    /*
     * Says something to the tutor as though the learner had said it.
     *
     * TWO MESSAGES WHERE GEMINI SENDS ONE, and the second is the one that makes
     * it happen: adding an item to the conversation does not ask for a reply,
     * so a note sent without `response.create` would sit in context until the
     * learner next spoke. That is the same asymmetry the tool handling above
     * turns to advantage — nothing here generates unless it is asked to.
     *
     * Sent as a user turn because that is the role a note has to wear to be
     * answered; the learner never sees it, since what they see is built from
     * the input transcription and this never goes near the microphone.
     */
    say: (text: string) => {
      send({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
      });
      send({ type: 'response.create' });
    },
    setMuted: (muted) => mic.setMuted(muted),
    stop: () => {
      cleanup();
      handlers.onStatus('closed');
    },
  };
}
