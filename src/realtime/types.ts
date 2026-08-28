import type { SessionSettings } from './settings';
import type { UsageTotals } from './cost';
import type { AudioGap, AudioTap } from './audio';

export type { AudioGap, AudioTap };

/**
 * What the user configured, on its way to Google.
 *
 * Both fields are optional and both are the client's to write — see
 * instructions.ts on why the prompt is no longer server-only. Neither one
 * chooses a model or a language: those still travel as keys the Worker looks
 * up, because they are what decide the spend.
 */
export interface SessionConfig {
  instructions?: string;
  settings?: SessionSettings;
  /**
   * Words the transcriber should expect to hear. OpenAI only.
   *
   * A THIRD FIELD RATHER THAN SOMETHING DERIVED FROM THE FIRST, because the
   * first is the wrong source. `instructions` is a composed prompt — thousands
   * of characters of manner, rules and protocol — and keywords drawn from it
   * would be overwhelmingly words about how to teach rather than words the
   * lesson is about. The page that has the questions is the page that builds
   * this; see `lessonKeywords` in functions/api/live/_setup.ts for what is
   * kept, and `vocabulary` on VocoSession for the half a teacher may add.
   *
   * Ignored on Gemini, which has no counterpart. Sent anyway rather than gated
   * in the browser: the Worker knows which model this is and the browser is not
   * the place to decide what a provider accepts.
   */
  keywords?: string[];
}

export type SessionStatus = 'idle' | 'connecting' | 'live' | 'closed' | 'error';

export interface TranscriptDelta {
  role: 'user' | 'agent';
  /**
   * Which turn the text belongs to. Transcription can lag well behind the
   * conversation — a batch model only transcribes the user once they stop
   * talking, by which point the agent has answered — so a delta carrying an id
   * lands in that turn wherever it already sits in the log. Without one it can
   * only extend the turn still open at the end.
   */
  id?: string;
  /** Text to append to that turn. */
  text: string;
  /** True when the turn is finished and the next delta starts a new one. */
  done: boolean;
  /**
   * When this text will be *heard*, on the session's AudioTap clock.
   *
   * Only the agent side. Its audio is queued seconds ahead of real time, and
   * the transcript arrives on the same socket without waiting for it, so text
   * rendered on arrival races the voice. A consumer that wants them together
   * holds each delta until `tap.now()` reaches this.
   *
   * Absent means "no better information than now": render it immediately.
   */
  at?: number;
}

/**
 * How much of one microphone open actually left this browser.
 *
 * THE LEG NOTHING WATCHED, AND THE CHEAP PLACE TO WATCH IT. The `floor` lines
 * say the microphone was open for 15.7s, and that is the local detector on the
 * local audio — it is true whether or not a single frame reached the wire. On
 * 2026-08-27 a learner's 15.7-second answer produced no transcription at all,
 * and nothing anywhere could say whether the audio had been sent and ignored
 * or never sent. This is the half of that question the browser can answer
 * about itself, for the cost of one addition per chunk.
 *
 * IT IS COUNTED AT THE SEND, past the readyState check, so a socket that is
 * not open contributes nothing and the discrepancy shows. `seconds` is exact
 * rather than estimated, and exact at the rate the microphone is *actually*
 * running at rather than the one it was asked for — see `bytesPerSecond` on
 * MicCapture, which matters because the two providers ask for different rates
 * and a browser may honour neither.
 *
 * WHAT IT CANNOT SAY is whether Google received any of it. `send()` hands a
 * frame to the runtime and returns; it is not a delivery receipt. A full count
 * here clears this browser and moves the question downstream, which is all it
 * claims to do. The relay's own byte counter is the next instrument if this
 * one ever reads clean across a lost answer — deliberately not built yet,
 * because it costs Worker CPU on every frame and this does not.
 */
export interface MicSpan {
  /** Raw PCM bytes handed to the socket while this open lasted. */
  bytes: number;
  /** Those bytes as seconds of speech. */
  seconds: number;
}

export interface SessionHandlers {
  onStatus: (status: SessionStatus, detail?: string) => void;
  onTranscript: (delta: TranscriptDelta) => void;
  /** The agent started or stopped speaking — drives the level indicator. */
  onSpeaking?: (speaking: boolean) => void;
  /**
   * The microphone started or stopped hearing a voice.
   *
   * The one signal here that describes the user rather than the agent, and the
   * only one measured locally rather than reported upstream. Google offers
   * nothing usable: it says nothing at all about input until the transcript
   * arrives, which is after the utterance rather than at the start of it. See
   * MicCapture, which measures the chunks already on their way out.
   *
   * Debounced at the source — see VOICE_RELEASE_MS — so this is "somebody is
   * talking" and not "there is energy in this chunk".
   *
   * `span` rides the falling edge only, and says how much of that open reached
   * the socket. See MicSpan.
   */
  onVoice?: (active: boolean, span?: MicSpan) => void;
  /**
   * The user talked over the agent, and every unplayed sound was dropped.
   *
   * Distinct from onSpeaking(false), which also fires when a turn simply ends.
   * Anything holding agent output back to match the audio — see `at` above —
   * has to discard what it was holding here, or it will go on to display words
   * that were cut off and never spoken.
   */
  onInterrupted?: () => void;
  /**
   * The audio queue thinned or ran dry, so the voice is about to break up or
   * just did.
   *
   * THE ONLY FAULT HERE THE LEARNER CAN HEAR AND NOBODY ELSE CAN SEE. Every
   * other signal on this interface describes something said; this one describes
   * the pipe it was said down, and a pause in the middle of a sentence looks
   * from the outside exactly like a tutor hesitating. The two have nothing in
   * common and one of them is ours.
   *
   * A consumer is expected to write it down rather than show it. There is
   * nothing to do about it while the call is running — the cushion cannot be
   * raised mid-sentence, and a learner told their connection is poor is a
   * learner distracted from the lesson — but a report that says the voice broke
   * off twice is the difference between fixing this and guessing at it.
   */
  onAudioGap?: (gap: AudioGap) => void;
  /**
   * The first audio of a tutor turn has arrived, with the cushion ahead of it.
   *
   * WHAT IT IS FOR IS A SUBTRACTION NOBODY COULD DO BEFORE. The transcript
   * stamps the tutor at the moment the words became audible — the right clock
   * for reading a conversation, and useless for reading a silence, because a
   * ten-second hole looks the same whether the sound was ten seconds late
   * arriving or arrived at once and sat in a queue. This fires on arrival, and
   * `leadSeconds` is how long the queue will hold it. Arrival plus lead is the
   * audible stamp; so the two together say which half of the wait was ours.
   *
   * Once per turn, not once per chunk: a turn's first frame is the one that
   * answers the question, and the rest are the pipe keeping up.
   *
   * `afterTextMs` IS THE THIRD NUMBER, AND IT WAS MISSING. Arrival plus lead
   * splits a silence into pipe and queue only while the words and the sound of
   * them arrive together, which is what Google does and what everything here
   * assumed it always does. On 2026-08-27 one turn's words came six seconds
   * ahead of its sound and the assumption broke silently: the account showed
   * the tutor speaking at a moment the learner heard nothing, because the text
   * had been stamped against a drained queue. This is that distance, zero on
   * every ordinary turn and the whole story on the turn that goes wrong.
   */
  onTurnAudio?: (turn: { leadSeconds: number; afterTextMs?: number }) => void;
  /**
   * The relay answered a ping, and how long the round trip took.
   *
   * THE ONE MEASUREMENT OF THE DETOUR ITSELF. Audio does not go browser to
   * Google here; it goes browser to Cloudflare to Google, and until this
   * existed there was no number anywhere for what those extra hops cost. That
   * mattered the first time a call took nine seconds to say hello: the relay
   * was the obvious suspect and there was nothing to convict or clear it with.
   *
   * `rttMs` is the browser-to-Worker leg, measured against this browser's own
   * clock at both ends. `upgradeMs` is the Worker's own reach to Google, taken
   * once at the handshake and repeated on every pong because the Worker has
   * nowhere else to volunteer it. Their sum bounds the whole detour.
   *
   * NEITHER OF THEM WATCHES THE SOCKET THE CALL IS ACTUALLY ON, which is the
   * hole `upstreamMaxGapMs` fills. `rttMs` measures browser to Worker and back;
   * `upgradeMs` is the cost of opening a *fresh* connection to the provider,
   * not the health of the live one carrying this lesson. So a stall on the far
   * leg was invisible to both, and on 2026-08-27 a call whose worst relay
   * sample was 23ms still had six seconds where Google sent nothing mid-turn.
   * This is the longest run of quiet on that upstream socket since the last
   * pong, measured at the Worker, which is the only place that can see it.
   *
   * NAMED FOR THE LEG AND NOT FOR THE COMPANY. It was `googleMaxGapMs` while
   * there was one upstream; the measurement was never about whose server it
   * was, and there are two now.
   *
   * IT IS NOT A FAULT ON ITS OWN. Google legitimately sends nothing while the
   * learner is talking, so a large gap between turns is the protocol working.
   * A large gap *inside* a turn is the thing worth finding, and the turn
   * boundaries live in the browser — so this reports the raw quiet and lets the
   * account it lands in supply the context.
   *
   * `direct` SEPARATES THE TWO PONGS EVERY PING NOW GETS. One leaves the Worker
   * immediately and one queues behind Google's frames, and which of them
   * arrives is the diagnosis: both is a healthy relay, direct alone is a wedged
   * forwarder chain, neither is a Worker that has stopped running. Only the
   * queued one measures the path the audio actually takes, so it is the one the
   * best/worst summary is built from.
   */
  onRelay?: (sample: {
    rttMs: number;
    direct: boolean;
    upgradeMs?: number;
    upstreamMaxGapMs?: number;
  }) => void;
  /**
   * Pings are going out and the relay has stopped answering, but not yet for
   * long enough to hang up on.
   *
   * The onset of the failure, on the timeline, for the call that recovers and
   * the call that does not alike. `missed` is how many have gone unanswered.
   * The hang-up itself arrives as an `error` status with its own reason — see
   * RELAY_DEAD_PINGS in gemini.ts.
   */
  onRelaySilent?: (missed: number) => void;
  /**
   * A model turn ended having produced no audio at all.
   *
   * THE DEAD-AIR CASE, STATED BY THE PROVIDER RATHER THAN INFERRED. A turn
   * spent entirely on a bookkeeping call leaves the tutor mute, and the stall
   * watchdog in useVoiceCall currently finds that out by waiting ten seconds
   * and concluding it. This is the same fact arriving on the socket, and if it
   * arrives reliably it is worth ten seconds of every learner's lesson.
   *
   * REPORTED, NOT ACTED ON, and deliberately. Nothing has ever recorded whether
   * `turnComplete` is even sent for a turn like that, and a watchdog rebuilt on
   * a frame that turns out not to arrive is a tutor that goes quiet for good.
   * One lesson's account with these lines in it settles it — an AI Studio one,
   * which is what the tutor runs on. See `turnBeganAt` in gemini.ts for the
   * footnote about the other surface.
   *
   * `tookMs` runs from the first evidence the model was answering; `generatedMs`
   * is where `generationComplete` fell inside that, when it came at all.
   * `textMs` is how long the turn's words had been waiting on sound that never
   * arrived — absent on a turn that produced no words either, which is the
   * bookkeeping case this was built for, and present on the other one.
   */
  onSilentTurn?: (turn: { tookMs: number; generatedMs?: number; textMs?: number }) => void;
  /**
   * Running totals for the call so far, pushed every time Google reports usage
   * rather than once at the end. A call that dies mid-flight never sends a
   * final figure, so the last push is the only record we get to keep.
   */
  onUsage?: (usage: UsageTotals) => void;
  /**
   * The model called a tool — any tool, by whatever name, before anything has
   * been made of it.
   *
   * THE RAW EVENT, AND THAT IS THE ENTIRE POINT. `onQuestionDone` below is an
   * interpretation: it fires for one name and is silent for every other, which
   * means a model calling a tool this build does not implement produces no
   * signal anywhere. That is not a hypothetical gap. A prompt that asks for a
   * tool which no longer exists gets called anyway, every call is answered
   * because an unanswered one leaves a tutor silent, and on a surface without
   * non-blocking calls each answer restarts the model into a turn spoken on top
   * of the last — so the learner hears every question twice, and nothing in the
   * account of the call says why.
   *
   * Fires for every call in the frame, including the recognised one, so the
   * account carries what actually arrived rather than what was understood. What
   * is done about a call is a separate line in the log from the call itself, and
   * a gap between the two is exactly the sort of thing worth being able to see.
   *
   * `args` is whatever the model sent, unvalidated. It is for reading, not for
   * acting on: a diagnostic that can print `questionDone {"number":1}` twice in
   * four seconds has answered the question a transcript cannot.
   *
   * `spoken` says whether the model had already said something in the turn it
   * called from. It is a fact and not a verdict: on this model the call
   * routinely arrives first and the speech follows a second later, so a false
   * here is usually nothing at all and occasionally a turn that will stay
   * silent for good. Only a reader willing to wait can tell those apart — see
   * the stall watchdog in useVoiceCall, which is the one that waits.
   */
  onToolCall?: (name: string, args?: Record<string, unknown>, spoken?: boolean) => void;
  /**
   * The tutor reported that one more question on its list has been answered.
   *
   * The only structured thing a call ever says about its own progress — see
   * _setup.ts on why it is a tool rather than something read out of the
   * transcript, and PROGRESS_TOOL in tutorPrompt.ts on why there is one of
   * these per question rather than a single claim at the end.
   *
   * THE TUTOR'S CLAIM AND NOT A FACT, and this is the layer that says so
   * loudest: it fires for whatever the model sent, unfiltered and uncounted.
   * A model can report a question the learner deflected, report the same one
   * twice, report five in a single turn, or send a number that is not on the
   * list at all. Deciding which of those to believe is useVoiceCall's job —
   * see `acceptProgress` — and the separation is deliberate, because the run
   * that prompted it was a lesson ended by one unexamined tool call.
   *
   * ONE FRAME, ONE CALL OF THIS HANDLER, carrying every number the frame held.
   * The tutor catches its bookkeeping up in a single breath — two reports in
   * one frame, out of order, is ordinary observed behaviour — and a frame has
   * no internal chronology to preserve, because the model emitted all of it at
   * once. Splitting them made two halves of one decision look like two
   * decisions arriving too close together.
   *
   * Each entry is the question's position in the list, counting from 1, or
   * undefined when the model called the tool without one.
   */
  onQuestionDone?: (numbers: Array<number | undefined>) => void;
}

/**
 * The handle a page holds on a running call.
 *
 * IT KEPT ITS SHAPE THROUGH THE YEARS IT HAD ONE IMPLEMENTATION, and now has
 * two again — startGeminiSession and startOpenAiSession, picked between by
 * startSession in start.ts. The note that stood here said it stayed an
 * interface because two pages consume it and neither should have to know how
 * the socket works, "not because a second transport is expected back". The
 * second transport came back anyway, and the discipline is why porting it cost
 * two files instead of the whole call stack: nothing above this line was
 * touched.
 */
export interface VoiceSession {
  setMuted: (muted: boolean) => void;
  stop: () => void;
  /**
   * Says something to the tutor as though the learner had said it, without it
   * appearing in the transcript.
   *
   * The only way to steer a call already in progress. The clock lives in the
   * page — a model cannot see one and invents elapsed time when asked to — so
   * when the lesson's minutes are up, the page is what tells the tutor to
   * close. See TIME_UP_SIGNAL in tutorPrompt.ts, and KEEP_GOING_SIGNAL beside
   * it, which is the other thing a page has ever needed to say. A lesson that
   * finishes its list needs nothing said at all: the tutor closes that one
   * itself.
   *
   * Not shown to the learner and not recorded: the transcript is built from
   * `inputTranscription`, which is what the microphone heard, and this never
   * goes near the microphone. So the report reads a conversation that ended
   * naturally rather than one with a stage direction in the middle of it.
   */
  say: (text: string) => void;
  /** The agent's audio output, for anything that has to move in time with it. */
  readonly tap?: AudioTap | null;
}
