import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BrandBar from '../lingo/BrandBar';
import BuildBadge from '../BuildBadge';
import type { FaceKit } from '../facekit/kit';
import { loadBundledKit } from '../facekit/bundled';
import { publishedKit } from '../facekit/store';
import { useWarmKit } from '../facekit/warm';
import { L1_CHOICES, resolveL1 } from '../realtime/l1';
import type { SessionReport } from '../realtime/report';
import type { AdvancedReport } from '../realtime/oralRubric';
import type { MarkingCost } from '../realtime/cost';
import AdvancedPanel from './AdvancedPanel';
import { LESSON_CODE_LENGTH, normaliseLessonCode } from '../realtime/lessonCodes';
import { hasLesson, type PublishedSetup } from '../realtime/session';
import { capMinutesOf } from '../realtime/vocoSessions';
import {
  KEEP_GOING_SIGNAL,
  TIME_UP_SIGNAL,
  composeTutorPrompt,
  openingSignal,
} from '../realtime/tutorPrompt';
import { defaultInstructions } from '../realtime/instructions';
import { findLanguage, defaultLanguageCode } from '../realtime/languages';
import { codeFromUrl, fetchSetup } from '../realtime/sessionStore';
import { defaultModelKey, findModel } from '../realtime/models';
import type { SessionSettings } from '../realtime/settings';
import { useVoiceCall, type Turn } from '../live/useVoiceCall';
import ConsignePanel from './ConsignePanel';
import DiagnosticPanel from './DiagnosticPanel';
import DictionaryPanel, { type LookupRequest } from './DictionaryPanel';
import EvaluationPanel, { EvaluationGate } from './EvaluationPanel';
import TutorStage from './TutorStage';
import VocabPanel from './VocabPanel';
import { FR } from './strings';
import * as vocab from './vocab';
import type { VocabItem } from './vocab';

/**
 * The student page.
 *
 * THE THIRD TIER. tutorBench, faceKit and studio are the workshop — dark,
 * English, every knob exposed, and written for the one person who built the
 * thing. This page is for the person the thing was built for, and it inherits
 * everything and offers nothing: no model, no prompt, no face, no scale. The
 * only control a student has over the tutor is when to start talking to it.
 *
 * IT RUNS ON A PUBLISHED SETUP, NOT ON DEFAULTS. Everything the tutor is comes
 * from R2 — see realtime/session.ts. That is the whole reason the page can be
 * opened on a laptop that has never met the workshop: without it the student
 * would silently get a different tutor from the one that was tuned for them.
 */

/**
 * How long a close gets before the page hangs up on it regardless.
 *
 * The lesson's minutes are the conversation's length, not the call's: closing
 * is a turn or two of speech that has to finish, whether it began on the tutor
 * reaching the last answer or on the page's note at the cap. Forty-five seconds
 * is long enough for a warm goodbye and short enough that a tutor which will
 * not stop — or one whose `speaking` flag is stuck true on a dropped socket —
 * does not leave the call running on the meter.
 *
 * The call can still end sooner than this, and almost always does: the quiet
 * rule below is the ordinary ending, and the idle timer is watching underneath.
 */
const CLOSING_GRACE_MS = 45_000;

/**
 * How long the page waits after a close that is demonstrably finished.
 *
 * THE TURN BEING COMPLETE IS THE REAL SIGNAL, and this is the wait that gets to
 * use it. Everything below measures silence, because silence was all the page
 * had: a `speaking` flag is a claim about an audio queue, and a queue that has
 * momentarily run dry looks exactly like a tutor that has finished. The
 * transcript carries something better — the model marks the end of its own turn
 * — so once the tutor's turn is closed and it came after the learner's last
 * answer, there is nothing more coming.
 *
 * IT WAS TWO SECONDS AND THEY WERE FOR THE LEARNER, a beat to say "au revoir"
 * back into. That beat cost more than it bought. The clock counts the room, so
 * anything the learner said reset it — and what they said also reached a tutor
 * with no questions left, which answered, which started the wait again. A
 * lesson that was over went on for another minute because somebody was polite,
 * or cleared their throat. The microphone is now closed when the close begins
 * (see the effect below), so there is nobody left to wait for.
 *
 * WHAT IS LEFT IS THE SPEAKERS. `done` flips when the reveal queue reaches the
 * end of the audio on the graph's clock, which is a little before that sound
 * has physically left the device — `outputLatency`, tens of milliseconds on
 * built-in speakers and a few hundred over Bluetooth. This is that, with room:
 * long enough that no goodbye is ever clipped, short enough to read as the call
 * ending when the tutor stops talking.
 */
const CLOSING_DONE_MS = 600;

/**
 * How long the tutor has to be quiet, once a close has begun, before the page
 * hangs up on it.
 *
 * FOR A CLOSE THAT NEVER SAYS IT IS FINISHED. The rule above covers the
 * ordinary ending, where the model marks its own turn complete; this is what is
 * left when that mark never arrives — a socket that drops mid-goodbye, a turn
 * the model abandons. All the page has then is silence, so silence is what it
 * measures, from the last sound anyone made.
 *
 * Six seconds rather than two or three, because without the turn mark the gap
 * this must not mistake for the end is a tutor drawing breath mid-close. The
 * cost of waiting too long is a few seconds of silence; the cost of cutting
 * early is hanging up over a goodbye. The ceiling is still overhead, for a
 * `speaking` flag stuck true on a stalled player.
 */
const CLOSING_QUIET_MS = 6_000;

/**
 * The same wait, for a close the tutor has not said a word into.
 *
 * THE RULES ABOVE ARE ABOUT A TUTOR THAT HAS BEEN TALKING. A close that opens
 * on silence is not that: the tutor reported the last question and said
 * nothing, or it was sent the cap's note and has not answered yet, and what the
 * page is waiting for is a turn that has not started. Six seconds is too short
 * for that. The stall watchdog in useVoiceCall takes six before it nudges, and
 * a nudged turn was measured at five seconds from note to audible speech.
 *
 * Twelve is those two with room, and it is a ceiling nobody reaches on a
 * healthy lesson: the tutor closes the last turn itself, which means it is
 * speaking when the count completes. This is what a lesson that has already
 * gone quiet costs, once.
 */
const CLOSING_SILENT_MS = 12_000;

/**
 * How long the room may be silent, with the list unfinished, before the page
 * asks the tutor to carry on.
 *
 * FIFTEEN SECONDS IS CHOSEN AGAINST THE IDLE TIMER, not against a measurement
 * of conversation. This page hangs a call up after thirty seconds with nobody
 * talking, so a silence that reaches fifteen is halfway to being ended without
 * an ending. Waiting longer buys a quieter page and risks spending the rest of
 * that window on nothing; nudging sooner starts talking over a learner who is
 * thinking, and a beginner composing a sentence in a foreign language takes
 * longer than a fluent one would.
 *
 * IT IS NOT THE STALL WATCHDOG. That one lives in useVoiceCall, arms on a
 * bookkeeping call with no speech behind it, and waits two and a half seconds —
 * it is about one turn going missing. This is about the conversation stopping,
 * which is a different silence with a different cause, most often a tutor that
 * decided the lesson was over ahead of the list. Both send KEEP_GOING_SIGNAL,
 * and a tutor that ignores the first gets the second ten seconds later.
 */
const NUDGE_AFTER_MS = 15_000;

/**
 * How many times the page will do that in one call.
 *
 * Two, because the third is not a nudge any more. A tutor that has been asked
 * twice to carry on and has not is not going to, and the honest ending is the
 * idle timer saying so — which at least tells the learner the call stopped
 * rather than leaving them talking into a page that keeps prodding a corpse.
 */
const MAX_NUDGES = 2;

/**
 * The last turn a role took, or none.
 *
 * A loop rather than `findLast`, which this project's ES2020 lib does not
 * carry, and rather than reversing a copy of the transcript on every render.
 */
function lastTurnBy(turns: Turn[], role: Turn['role']): Turn | undefined {
  for (let at = turns.length - 1; at >= 0; at--) if (turns[at].role === role) return turns[at];
  return undefined;
}

/** Where the learner's own language is remembered. Nothing here is a secret. */
const L1_KEY = 'vocotrial.eleve.l1';

/**
 * Which model this lesson dials, and it is the teacher's answer now.
 *
 * IT WAS A CONSTANT HERE, and what the constant was defending is still true —
 * it just stopped being this file's decision to make. Both halves are
 * properties of the surface rather than preferences:
 *
 *  - THIS PAGE COUNTS QUESTIONS from tool calls the tutor makes as it goes, and
 *    per-question reporting is only survivable where `behavior: 'NON_BLOCKING'`
 *    is honoured. Vertex ignores the field, and answering a blocking call
 *    restarts the model into a turn spoken on top of the last one, so the
 *    learner hears a question twice. That ended a five-question lesson at
 *    question three.
 *  - THIS PAGE SHOWS THE LEARNER THEIR OWN WORDS, feeds them to a vocabulary
 *    list and marks them in a report — all from a transcript. A half-cascade
 *    model writes one through a real ASR stage told which language it is
 *    listening to; native audio transcribes its own input with no such stage,
 *    and wrote Arabic script into a French lesson where the learner said "oui".
 *
 * NEITHER IS GUARDED AGAINST HERE, deliberately. A teacher who picks the warmer
 * model is shown both costs in the sentences models.ts writes for them, and the
 * page then does exactly what it does on any other lesson: sends the progress
 * tool, counts, runs the countdown, and reads the transcript it is given. A
 * page that quietly withdrew features according to a dropdown two tiers away
 * would be a page nobody could explain to the teacher on the phone.
 *
 * ABSENT MEANS THE DEFAULT, and so does a key this build does not recognise.
 * Every code handed out before the choice existed has no `modelKey`, and every
 * one of them has been running on `defaultModelKey()` all along — so those
 * lessons carry on unchanged. Note that this ties them to whatever sits first
 * in MODELS: reordering that list moves every legacy lesson with it, which is
 * the correct behaviour for "the model we run by default" and worth knowing
 * before reordering.
 */
function lessonModelKey(setup: PublishedSetup | null): string {
  return findModel(setup?.modelKey ?? '')?.key ?? defaultModelKey();
}

type Tab = 'evaluation' | 'dictionary' | 'vocab';

function loadL1(): string {
  try {
    return window.localStorage.getItem(L1_KEY) ?? L1_CHOICES[0].code;
  } catch {
    return L1_CHOICES[0].code;
  }
}

export default function Eleve() {
  const [session, setSession] = useState<PublishedSetup | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  /*
   * The code, and what came of trying it.
   *
   * `typed` is the box; `codeError` is the answer to the last attempt. They are
   * separate so that a student correcting one character does not have the
   * complaint vanish and reappear on every keystroke — it clears on submit,
   * which is when it stops being true.
   */
  const [typed, setTyped] = useState(codeFromUrl);
  const [codeError, setCodeError] = useState('');
  const [checking, setChecking] = useState(false);
  const [kit, setKit] = useState<FaceKit | null>(null);
  /**
   * Decoded while the learner is still reading the consigne, rather than during
   * the tutor's first sentence — which is where it landed before, and what it
   * cost is written up in warm.ts.
   */
  useWarmKit(kit);

  const [l1, setL1] = useState(loadL1);
  const [tab, setTab] = useState<Tab>('evaluation');

  const [words, setWords] = useState<VocabItem[]>([]);
  const [request, setRequest] = useState<LookupRequest | null>(null);
  const lookupSeq = useRef(0);

  const [report, setReport] = useState<SessionReport | null>(null);
  /**
   * The advanced marker's result, when the teacher picked one.
   *
   * A SECOND SLOT RATHER THAN A UNION, because the two are different objects
   * read by different panels, and only the route decides which one arrives.
   * Held separately, neither renderer has to narrow anything, and the pair
   * being mutually exclusive is enforced in one place — `evaluate` below,
   * which clears the other whichever comes back.
   */
  const [advanced, setAdvanced] = useState<AdvancedReport | null>(null);
  /**
   * What the marking call cost, as the route measured it.
   *
   * KEPT ONLY FOR THE DIAGNOSTIC, and deliberately never rendered on the page —
   * EvaluationPanel's header states the rule and it holds here: a student is
   * never shown what reading their conversation cost. This is the same figure
   * tutorBench prints, and it is here because the two markers run different
   * models against different prompts and nobody could compare them without
   * taking a diagnostic from each.
   */
  const [markingCost, setMarkingCost] = useState<MarkingCost | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  /**
   * The diagnostic, which is open or it is not.
   *
   * NOTHING ELSE ON THE PAGE KNOWS ABOUT IT. It renders over everything, holds
   * no state of its own beyond the snapshot it takes on opening, and closes
   * back to exactly the page that was underneath — a call keeps running while
   * it is up, which is the whole point of being able to take one mid-lesson.
   */
  const [diagnostic, setDiagnostic] = useState(false);

  /** Ticks only while a call is up, so the elapsed line moves. */
  const [now, setNow] = useState(() => Date.now());

  /**
   * Turn-taking and voice, as one value with two readers.
   *
   * IT USED TO BE BUILT INSIDE THE `useVoiceCall` CALL, and lifting it out is
   * what lets the diagnostic report the settings that were actually sent rather
   * than working them out a second time from the same setup. Two derivations of
   * one payload is two things that can disagree, and the one place it would
   * show is a diagnostic quietly describing a call that never happened.
   */
  const settings = useMemo<SessionSettings>(() => {
    if (!session) return {};
    // Absent rather than empty throughout — see settings.ts on why "leave it
    // upstream" and "pin today's default" have to stay distinguishable.
    return {
      ...(session.voice ? { voice: session.voice } : {}),
      ...(session.silenceDurationMs !== undefined
        ? { silenceDurationMs: session.silenceDurationMs }
        : {}),
      ...(session.prefixPaddingMs !== undefined
        ? { prefixPaddingMs: session.prefixPaddingMs }
        : {}),
      ...(session.startSensitivity ? { startSensitivity: session.startSensitivity } : {}),
      ...(session.endSensitivity ? { endSensitivity: session.endSensitivity } : {}),
      ...(session.affectiveDialog !== undefined
        ? { affectiveDialog: session.affectiveDialog }
        : {}),
      ...(session.proactiveAudio !== undefined ? { proactiveAudio: session.proactiveAudio } : {}),
      ...(session.temperature !== undefined ? { temperature: session.temperature } : {}),
      ...(session.maxOutputTokens !== undefined
        ? { maxOutputTokens: session.maxOutputTokens }
        : {}),
    };
  }, [session]);

  /**
   * The system prompt, composed at the moment this page is about to send it.
   *
   * NOT READ OUT OF THE SETUP, which is the change that makes a code handed out
   * last term safe to open today. A published setup carries the lesson as data
   * — the questions, the style prose, the persona — and this is
   * where those become a prompt, using whatever composer this build ships. What
   * the teacher decided is still frozen; what is really an agreement between
   * the prompt and the tools a call declares travels with the code that
   * declares them. See session.ts and composeTutorPrompt.
   *
   * A SETUP WITH NO STYLE FALLS BACK TO THE BUILT-IN, and that is what every
   * setup published before this change has. Those rows carry a composed
   * `instructions` string whose first section was very nearly this same text,
   * so an old code opens onto a tutor of the same manner with its own
   * questions, on today's protocol. Nothing is stranded and nothing needs
   * republishing.
   */
  const instructions = useMemo(() => {
    if (!session) return '';
    /*
     * A setup with no questions is a conversation rather than a lesson, which
     * is the shape of everything published before lessons existed. There is
     * nothing to compose — no list, no protocol to describe — so
     * the prompt it was published with is still exactly the right one, and it
     * is the only thing that still reads that stored text. Composing a lesson
     * prompt with an empty list would be worse than useless: it would tell the
     * tutor to work down nothing and report progress against it.
     */
    if (!session.questions?.length) return session.instructions ?? '';
    const language =
      findLanguage(session.language) ?? findLanguage(defaultLanguageCode())!;
    return composeTutorPrompt({
      style: session.style?.trim() || defaultInstructions(language),
      rules: session.lessonRules,
      persona: session.persona,
      questions: session.questions,
    });
  }, [session]);

  /*
   * Resolved once for the two readers that need it: the call that dials it, and
   * the diagnostic that reports what was dialled. A diagnostic naming a
   * different model from the one in use is worse than one naming none.
   */
  const modelKey = lessonModelKey(session);

  const call = useVoiceCall({
    modelKey,
    language: session?.language ?? 'fr',
    instructions,
    /*
     * The list this call is counted against. Absent means no lesson, and every
     * progress report a tutor makes on such a call is refused — see
     * `acceptProgress` in useVoiceCall.
     */
    questionCount: session?.questions?.length,
    /*
     * Thirty seconds of nobody talking ends the call, where the workshop pages
     * allow ninety.
     *
     * The two numbers are answering different questions. On tutorBench you are
     * reading a prompt or a settings panel with a call open and half a minute
     * of quiet is a normal part of the work. Here a silence that long means the
     * learner has stopped — walked off, or run out of things to say — and the
     * call is billing by the second either way. It is also, now, the thing that
     * closes a session nobody pressed the microphone to end.
     */
    idleTimeoutMs: 30_000,
    idleNotice: FR.idleEnded,
    settings,
  });

  /**
   * Opens a code, and fetches the face it names.
   *
   * ONE PATH IN, whether the code came from the address bar or from the box.
   * A link with `?token=` and a student typing the same six characters have to
   * land in exactly the same state, and two code paths to one state is how they
   * stop doing that.
   */
  const open = useCallback(async (raw: string) => {
    const code = normaliseLessonCode(raw);
    if (!code) {
      setCodeError(FR.codeMalformed);
      return;
    }

    setChecking(true);
    setCodeError('');
    try {
      const found = await fetchSetup(code);
      if (!found) {
        setCodeError(FR.codeUnknown);
        return;
      }
      setSession(found);

      // The artwork is fetched after the setup rather than with it: a kit is
      // megabytes and the page has something to show without it.
      try {
        const worn = found.faceId ? await publishedKit(found.faceId) : await loadBundledKit();
        setKit(worn);
      } catch {
        // The drawn placeholder is a smaller page, not a broken one.
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setChecking(false);
    }
  }, []);

  // --- The published setup, if the address bar already names one.
  useEffect(() => {
    const fromUrl = codeFromUrl();
    if (!fromUrl) {
      // No code is not a failure — it is a student who has not typed one yet,
      // which is the ordinary way to arrive. Straight to the box.
      setLoading(false);
      return;
    }
    void open(fromUrl).finally(() => setLoading(false));
  }, [open]);

  useEffect(() => setWords(vocab.load()), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(L1_KEY, l1);
    } catch {
      // Private browsing. Losing the pick costs one dropdown change.
    }
  }, [l1]);

  useEffect(() => {
    if (!call.live) return;
    // Set once immediately: the elapsed line is rendered the moment the call
    // goes live, and waiting a whole second for the first tick shows a stale
    // `now` against a fresh `connectedAt` — which reads as a negative duration.
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [call.live]);

  /**
   * What the tutor is saying now, and what the learner last finished saying.
   *
   * The two are read differently on purpose. The agent's turn is taken whole —
   * the bubble keeps it and scrolls — because a learner rereads the sentence
   * they half caught. The learner's is taken only when the turn has closed, for
   * the reason in LearnerPill: a partial transcription of a language learner is
   * bad enough that showing it reads as the page mishearing them.
   */
  const agentText = useMemo(() => {
    for (let index = call.turns.length - 1; index >= 0; index--) {
      if (call.turns[index].role === 'agent') return call.turns[index].text;
    }
    return '';
  }, [call.turns]);

  const learnerText = useMemo(() => {
    for (let index = call.turns.length - 1; index >= 0; index--) {
      const turn = call.turns[index];
      if (turn.role === 'user' && turn.done && turn.text.trim()) return turn.text;
    }
    return '';
  }, [call.turns]);

  const askDictionary = useCallback((term: string, context: string) => {
    lookupSeq.current += 1;
    setRequest({ term, context, seq: lookupSeq.current });
    setTab('dictionary');
  }, []);

  const openSaved = useCallback((item: VocabItem) => {
    lookupSeq.current += 1;
    // The stored answer travels with the request, so reopening a saved word
    // costs nothing and works with the network down. See LookupRequest.known.
    setRequest({ term: item.term, context: '', seq: lookupSeq.current, known: item.data });
    setTab('dictionary');
  }, []);

  const refreshWords = useCallback(() => setWords(vocab.load()), []);

  /**
   * The microphone, and the tutor getting the first word.
   *
   * THE GREETING IS SENT FROM HERE RATHER THAN LIVING IN THE PROMPT, because
   * Live only ever answers — a tutor told in its instructions to say hello
   * says hello after the learner does. So the page opens the conversation on
   * their behalf with a note the tutor acts on and never reads out. See
   * `openingSignal`, which is also where the part of the day comes from: the
   * clock is the browser's, because the browser is the thing in the room.
   *
   * AFTER THE AWAIT, NOT BESIDE IT. `connect` resolves once the socket is up
   * and the session has been handed back, and `say` before that lands on a
   * session ref that is still null — a no-op, which would leave exactly the
   * silence this exists to end and nothing at all to say why. A connect that
   * failed resolves too, and there the same no-op is what is wanted: the page
   * is already showing why nobody is talking.
   */
  const start = async () => {
    setReport(null);
    setAdvanced(null);
    setMarkingCost(null);
    setReportError(null);
    await call.connect();
    call.say(openingSignal(), 'opening — greet the learner');
  };

  const evaluate = async () => {
    setReporting(true);
    setReportError(null);
    try {
      const response = await fetch('/api/report/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          languageCode: session?.language,
          l1Code: resolveL1(l1).reportCode,
          evaluatorId: session?.evaluatorId,
          turns: call.turns.map((turn) => ({ role: turn.role, text: turn.text })),
        }),
      });
      /*
        ONE ROUTE, TWO SHAPES. Which one comes back is decided server-side by
        the evaluator id the teacher published, not by anything this page asks
        for — see analyse.ts, which forks before it resolves a scale. So the
        page reads whichever key is present rather than predicting one, and a
        lesson republished onto the other kind of marking needs no change here.
      */
      const answer = (await response.json().catch(() => null)) as
        | {
            report?: SessionReport;
            advanced?: AdvancedReport;
            cost?: MarkingCost;
            error?: string;
          }
        | null;
      if (!response.ok || !(answer?.report || answer?.advanced)) {
        throw new Error(answer?.error || FR.evalFailed);
      }
      if (answer.advanced) {
        setAdvanced(answer.advanced);
        setReport(null);
      } else {
        setReport(answer.report ?? null);
        setAdvanced(null);
      }
      setMarkingCost(answer.cost ?? null);
    } catch (problem) {
      setReportError(problem instanceof Error ? problem.message : FR.evalFailed);
    } finally {
      setReporting(false);
    }
  };

  const elapsedMs = call.connectedAt === null ? null : now - call.connectedAt;

  /**
   * Whether every question on the list has been answered.
   *
   * THE PAGE'S COUNT, NOT THE TUTOR'S CLAIM. The tutor reports one question at
   * a time and `acceptProgress` in useVoiceCall decides which of those reports
   * to believe — a report with no learner turn behind it is refused, and a
   * lesson cannot end on questions nobody was asked. What follows from this is
   * when the call hangs up, and nothing else: the report reads the transcript
   * afterwards and is the authority on what was actually covered.
   *
   * Absent questions means no lesson — a setup published before there were any
   * — and such a conversation can never complete. It runs to the cap, which is
   * what it did before any of this existed.
   */
  const total = session?.questions?.length ?? 0;
  const lessonDone = total > 0 && call.answered.length >= total;

  /**
   * Whether the tutor has finished replying to the last thing the learner said.
   *
   * TWO FACTS, AND THE SECOND ONE IS WHAT MAKES IT MEAN ANYTHING. That the
   * tutor's turn is marked done is the model saying it has stopped — but the
   * turn before an unanswered answer is also marked done, and a page reading
   * only that would hang up on a tutor whose reply had not started. So the turn
   * must also have ended after the learner's last one did: the tutor has heard
   * the last answer, said its piece about it, and closed.
   *
   * An open learner turn — they started talking again after the goodbye — has
   * no `endedAt`, so their `at` stands in and the test reads false while they
   * are speaking. That is the answer that keeps them from being cut off.
   */
  const lastAgentTurn = lastTurnBy(call.turns, 'agent');
  const lastUserTurn = lastTurnBy(call.turns, 'user');
  const closingTurnDone =
    !!lastAgentTurn?.done &&
    (lastAgentTurn.endedAt ?? 0) >= (lastUserTurn?.endedAt ?? lastUserTurn?.at ?? 0);

  /**
   * The two ways a lesson ends, and what the page does about each.
   *
   * THE TUTOR CLOSES A FINISHED LESSON AND THE PAGE ONLY WAITS. The prompt
   * tells it to flag the last question, then comment on the answer and say
   * goodbye in the same turn — so on a healthy lesson nothing is said from out
   * here at all, and the ending is one turn with no gap in the middle of it.
   * What the page kept is the decision it can actually make: it holds the count,
   * and it will not hang up until the count says every question was answered.
   * A tutor that says goodbye at question three of five is talking to a page
   * that is still listening.
   *
   * THAT IS A TRADE AND IT IS WORTH NAMING. The page used to send a note the
   * moment its count completed, which guaranteed a goodbye even from a tutor
   * that had lost its place — and cost every lesson a five-second silence
   * between the comment on the last answer and the goodbye, because the note
   * cannot be sent any earlier. See the deleted LESSON_DONE_SIGNAL in
   * tutorPrompt.ts for why. What replaces the guarantee is `nudge` below.
   *
   * THE CAP IS STILL THE PAGE'S TO SAY, and it is the only note left. The model
   * is told there is no length to fill and told never to guess the time, so it
   * has no clock and is given none: a lesson cut short mid-list can only be
   * ended from here. See TIME_UP_SIGNAL, and vocoSessions.ts above
   * `MIN_CAP_MINUTES`.
   *
   * COMPLETION IS TESTED FIRST, so a lesson that finishes on the very tick the
   * cap lands ends as a finished lesson rather than as one that ran out of time.
   *
   * The refs are what stop this firing every second once a moment has passed:
   * state would re-render before the note was sent and send it again on the next
   * tick. They are cleared when a call ends, so a second conversation gets its
   * own clock rather than closing the instant it connects.
   */
  const closedAt = useRef<number | null>(null);
  /** When the list was first seen complete, which is when the close begins. */
  const doneSince = useRef<number | null>(null);
  /** Whether the tutor has said anything at all since the close began. */
  const spokeInClose = useRef(false);
  /**
   * When the room last went completely silent, and how often that has been
   * nudged. See NUDGE_AFTER_MS.
   */
  const silentSince = useRef<number | null>(null);
  /** Whether the microphone has already been shut for the close. */
  const micClosed = useRef(false);
  const nudges = useRef(0);
  const capMs = session ? capMinutesOf(session) * 60_000 : 0;

  /**
   * Whether the lesson has begun ending. State, not a ref, because three things
   * on screen now change the moment it goes true.
   *
   * IT IS EARLIER THAN THE GOODBYE AND THAT IS THE POINT. The close begins when
   * the count completes, which is the tutor's own report for the last question
   * — and the prompt has it make that call at the *top* of the turn it replies
   * in. Measured on 2026-08-23 the report landed 1.4s before a word of the
   * goodbye was audible. So this is true while the tutor is drawing breath to
   * say farewell, not after it has said it.
   *
   * WHAT IT DOES. The microphone closes, because a learner talking to a tutor
   * with no questions left restarts a conversation that was over. The wait
   * after the goodbye drops to the length of the speaker's own latency, because
   * with the microphone shut there is nobody left to wait for. And the
   * evaluation button appears, because from here the lesson is done and making
   * someone sit through the farewell before they can ask for their mark is a
   * wait with nothing at the end of it.
   */
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (!call.live) {
      closedAt.current = null;
      doneSince.current = null;
      spokeInClose.current = false;
      silentSince.current = null;
      micClosed.current = false;
      nudges.current = 0;
      // Nothing to unmute here: `connect` clears it, so the next call opens
      // with a live microphone whatever this one ended as.
      setClosing(false);
      return;
    }
    if (elapsedMs === null) return;

    // Nobody is making a sound: not the tutor, and not the microphone. Held as
    // one clock because what `nudge` waits for is the room being silent, and
    // either of them talking is the reason not to.
    if (call.speaking || call.heard) silentSince.current = null;
    else if (silentSince.current === null) silentSince.current = Date.now();

    if (lessonDone && doneSince.current === null) {
      doneSince.current = Date.now();
      setClosing(true);
    }

    /*
     * The microphone closes on the first tick the learner is not using it.
     *
     * NOT THE INSTANT THE CLOSE BEGINS, because that moment is the tutor's own
     * report for the last question and the page has no way to check it. The
     * count is the authority everywhere else in this file, but everywhere else
     * the cost of it being wrong is a wait; here it would be cutting somebody
     * off in the middle of their own sentence, which is the rudest thing this
     * page could do and would read as a bug rather than as an ending.
     *
     * So it waits for quiet, which this effect is already watching for and
     * re-checks every second. In the ordinary case there is no wait at all: the
     * report lands at the top of the tutor's reply, which is after the learner
     * has stopped. In the case worth guarding against — a report that arrives
     * early — they get to finish, and the microphone shuts behind them.
     */
    if (closing && !micClosed.current && !call.heard) {
      micClosed.current = true;
      call.mute(true);
    }

    if (!lessonDone && closedAt.current === null) {
      if (capMs && elapsedMs >= capMs) {
        closedAt.current = Date.now();
        // The cap closes a lesson with questions still on the list, and the
        // microphone shuts for the same reason it does on a finished one: what
        // the learner says now cannot be answered, only replied to. Muting is
        // left to the quiet check above, on the next tick — the cap can land
        // in the middle of an answer far more easily than a count can.
        setClosing(true);
        call.say(TIME_UP_SIGNAL, 'closing — out of time, questions unanswered');
        return;
      }

      /*
       * The tutor stopped with the lesson unfinished, and nobody has filled the
       * silence.
       *
       * WHAT IT IS FOR is the cost of letting the tutor own the ending: one
       * that closes at question three has said goodbye to a page that will not
       * hang up, and without this the call runs to the idle timer and tells a
       * learner who was mid-lesson that nobody was talking. It is not specific
       * to that — a tutor that simply stops is the same silence and the same
       * cure — which is why it tests the silence rather than trying to read a
       * goodbye out of the transcript in twenty-eight languages.
       *
       * WHY IT CAN AFFORD TO BE WRONG. The learner sitting and thinking looks
       * exactly like this from out here, and there is no signal that separates
       * them. What makes that acceptable is the alternative already in place:
       * fifteen seconds into a silence, the thirty-second idle timer is halfway
       * to hanging the call up. A tutor asking again is a better use of that
       * window than a countdown the learner cannot see, and if they were
       * thinking, they have been asked the question a second time.
       *
       * TWICE, AND ONLY INTO A FRESH SILENCE. The clock is reset on the nudge,
       * so a second one costs another full fifteen seconds; after that the page
       * has nothing useful left to say and the idle timer is the right answer.
       */
      const silent = silentSince.current === null ? 0 : Date.now() - silentSince.current;
      if (silent >= NUDGE_AFTER_MS && nudges.current < MAX_NUDGES) {
        nudges.current += 1;
        silentSince.current = Date.now();
        call.say(
          KEEP_GOING_SIGNAL,
          `nudge — ${NUDGE_AFTER_MS / 1000}s of silence, ${
            total ? `${call.answered.length} of ${total} answered` : 'and this lesson has no list'
          }`,
        );
      }
      return;
    }

    /*
     * A close is under way. What is left is deciding when it is over.
     *
     * EVERY WAIT BELOW COUNTS THE ROOM AND NOT THE TUTOR, which is a change of
     * its own. The clock restarts on anyone making a sound, the learner
     * included — so a learner who says goodbye back is not hung up on
     * mid-sentence, which the old tutor-only clock would do to them at six
     * seconds whatever they were saying.
     */
    const closingFrom = lessonDone ? doneSince.current : closedAt.current;
    if (closingFrom === null) return;

    if (call.speaking) spokeInClose.current = true;

    /*
     * Which of the three waits applies, and it is a question about evidence
     * rather than about time.
     *
     * `closingTurnDone` is the good case and the ordinary one: the tutor's turn
     * is marked complete and it ended after the learner's last answer, so the
     * goodbye has been said in full and nothing else is coming. Two seconds,
     * for the learner to say it back.
     *
     * Failing that, the tutor has at least been heard during the close and the
     * turn has not closed — a socket that dropped mid-goodbye, or a model that
     * abandoned the turn. Six seconds of silence, on the old rule.
     *
     * Failing even that, the close opened on a tutor that has not spoken at
     * all, and what is being waited for is a turn that has not started. Twelve,
     * which is the stall nudge plus the turn it asks for.
     */
    const wait = closingTurnDone
      ? CLOSING_DONE_MS
      : spokeInClose.current
        ? CLOSING_QUIET_MS
        : CLOSING_SILENT_MS;

    const silent = silentSince.current === null ? 0 : Date.now() - silentSince.current;
    if (silent >= wait) {
      // Nothing shown: the tutor has just said goodbye, and a line of chrome
      // under it would be the page talking over the ending. The account still
      // gets a sentence, which is why `hangUp` takes the two separately.
      call.hangUp(
        undefined,
        closingTurnDone
          ? `closed — the tutor finished its goodbye and the room stayed quiet for ${(silent / 1000).toFixed(1)}s`
          : spokeInClose.current
            ? `closed — the tutor's last turn never closed and the room had been quiet for ${Math.round(silent / 1000)}s`
            : `closed — ${Math.round(silent / 1000)}s into the close and the tutor never spoke`,
      );
      return;
    }

    if (Date.now() - closingFrom >= CLOSING_GRACE_MS) {
      call.hangUp(
        undefined,
        `closed — ${CLOSING_GRACE_MS / 1000}s into the close and the tutor was still talking`,
      );
    }
    // `closing` is listed so the microphone shuts on the tick the close begins
    // rather than on the next one — the poll would get there within a second
    // either way, and a second of open microphone is a second of the thing this
    // is here to prevent.
  }, [
    call,
    call.live,
    call.speaking,
    call.heard,
    closing,
    closingTurnDone,
    elapsedMs,
    capMs,
    lessonDone,
    total,
  ]);

  /**
   * What the arrow in the pill points at when there is no call running.
   *
   * All that survives of a call button that used to say four different things:
   * the microphone is the control now, and the only part of its label the pill
   * cannot work out for itself is whether this is a first conversation or
   * another one. `lastCallMs` is the page's memory of that, and nothing in the
   * pill has any business knowing it.
   */
  const idleHint = call.lastCallMs === null ? FR.pillStart : FR.pillAgain;

  /**
   * When the tutor smiles, which is at the two ends of a conversation and
   * nowhere in the middle of one.
   *
   * THE OPENING IS NOT `!call.live`, and the difference is the whole of the
   * first term. A call is live from the moment the socket connects, which is a
   * second or two before the tutor has drawn breath — a face that dropped its
   * smile there would sit neutral through the wait it was drawn to cover. So it
   * holds until the tutor actually has a turn, and the mouth takes over from
   * there on its own: the smile is ignored the instant the analyser reports
   * anything but rest. See `smiling` in live/Face.tsx.
   *
   * THE CLOSE IS TIMED TO THE AUDIO, NOT TO THE HANG-UP. Three facts, and each
   * of them is load-bearing. `closing` says this is the end of the lesson rather
   * than a gap in it, which is what keeps the smile off every pause a learner
   * leaves while thinking. `closingTurnDone` says the model finished the turn
   * the goodbye was in. And `!call.speaking` says the audio of it has actually
   * drained, which is later than the turn closing and by more than it sounds —
   * the speaker runs behind the socket by design. Together they mean the smile
   * lands on the last word of the farewell rather than two seconds afterwards
   * when the page hangs up, which is a face going warm at the end of a lesson
   * rather than a face reacting to a disconnection.
   *
   * A lesson that ends any other way — the cap, the idle timer, a learner
   * pressing the microphone — never sets `closing`, and gets its smile from the
   * first term as the call goes down. That is the right answer for all three:
   * none of them has a goodbye to be timed against.
   */
  const smiling =
    !call.live || !lastAgentTurn || (closing && closingTurnDone && !call.speaking);

  /**
   * The first tab, which is two things in sequence rather than one thing with a
   * fixed name.
   *
   * Before any conversation has finished it holds the consigne, and calling it
   * Évaluation would name something the student cannot have yet — the tab would
   * promise a reading and deliver a list of questions. Once a call has ended
   * the consigne has been acted on and the reading is what the panel is for, so
   * the label turns over. `lastCallMs` is the page's memory of a finished call
   * and is already what `idleHint` reads; nothing new is tracked for this.
   *
   * The threshold is a call having *ended*, not one having been long enough to
   * evaluate. A student who talks for a minute and stops has finished a
   * conversation, and the tab that then says Consignes while the panel under it
   * counts down to an evaluation is contradicting itself.
   *
   * The id behind both names is unchanged, so nothing else on the page has to
   * know this happens — a tab that renamed its own id would drop the student's
   * selection at the moment a call ends, which is the one moment they are
   * looking at it.
   */
  const consigne = hasLesson(session) && !report && !advanced;
  const firstTab = consigne && call.lastCallMs === null ? FR.tabConsignes : FR.tabEvaluation;

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'evaluation', label: firstTab },
    { id: 'dictionary', label: FR.tabDictionary },
    { id: 'vocab', label: FR.tabVocab },
  ];

  return (
    <div className="lingo-light flex h-screen flex-col overflow-hidden bg-lingo-mat font-lingo text-lingo-ink">
      {/* The stamp, but no Return: a lesson does not offer a student the
          workshop. See ReturnButton.tsx. It is `fixed`, so the column below
          staying `overflow-hidden` costs it nothing. */}
      <BuildBadge look="lingo" />
      <BrandBar tagline={FR.tagline} onTripleTap={() => setDiagnostic(true)}>
        <label className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-lingo-paper/70">
            {FR.l1Label}
          </span>
          <select
            value={l1}
            onChange={(event) => setL1(event.target.value)}
            className="rounded-lg border-2 border-white/20 bg-white/10 px-2.5 py-1 text-[13px] text-lingo-paper outline-none transition-colors hover:border-lingo-accent-light focus:border-lingo-accent-light"
          >
            {L1_CHOICES.map((choice) => (
              <option key={choice.code} value={choice.code} className="bg-lingo-bar">
                {choice.name}
              </option>
            ))}
          </select>
        </label>
      </BrandBar>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-lingo-muted">…</p>
        </div>
      ) : !session ? (
        /*
          The door, and it is the only one.

          A student reaches a lesson by typing the code their teacher read out —
          there is no "whichever was published last" behind this any more, which
          is what used to let one class walk into another's conversation. The
          box is LingoLecto's, deliberately: same six characters, same
          upper-casing as you type, same monospace at a size meant for copying
          off a board across a room. A student who uses both apps types their
          code into the same box twice.
        */
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="w-full max-w-md rounded-2xl border-2 border-lingo-border-strong bg-lingo-surface px-9 py-10 text-center shadow-lingo-pop">
            <h1 className="font-lingo-display text-2xl font-semibold">
              {loadFailed ? FR.loadFailedTitle : FR.codeTitle}
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-lingo-muted">
              {loadFailed ? FR.loadFailedBody : FR.codeBody}
            </p>

            {loadFailed ? (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-6 w-full rounded-xl bg-lingo-accent px-6 py-3 text-[15px] font-semibold text-white shadow-lingo-pop-sm transition-colors hover:bg-lingo-accent-deep"
              >
                {FR.retry}
              </button>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!checking) void open(typed);
                }}
                className="mt-6 flex flex-col gap-3"
              >
                <input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value.toUpperCase())}
                  maxLength={LESSON_CODE_LENGTH}
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="ABC123"
                  aria-label={FR.codeTitle}
                  className="w-full rounded-xl border-2 border-lingo-border-strong bg-lingo-cream px-4 py-3 text-center font-lingo-mono text-[22px] font-bold uppercase tracking-[0.18em] text-lingo-ink outline-none transition-colors placeholder:text-lingo-muted/40 focus:border-lingo-accent"
                />
                <button
                  type="submit"
                  disabled={checking || !typed.trim()}
                  className="w-full rounded-xl bg-lingo-accent px-6 py-3 text-[15px] font-semibold text-white shadow-lingo-pop-sm transition-colors hover:bg-lingo-accent-deep disabled:opacity-40"
                >
                  {checking ? FR.starting : FR.codeAction}
                </button>
                {codeError && (
                  <p className="text-sm leading-relaxed text-lingo-error">{codeError}</p>
                )}
              </form>
            )}
          </div>
        </div>
      ) : (
        /*
          LingoLecto's `.questioner-wrap`: a 1152px cap, 16px of mat as padding
          around the pair and again in the gap between them. Only the right side
          is a card — paper inside a 4px terracotta frame rounded at 24px. The
          note on the left column says why it is not the other one.

          THE CAP COSTS THE LEFT COLUMN NOTHING AND BUYS IT THE DISTANCE. The face
          and the balloon are centred and capped at 36rem already, so on a wide
          monitor they sit on the same pixels either way — what changes is how far
          the end of a spoken line is from the panel that answers for it, which on
          a 1920 screen was most of the width of the desk. That trip is the whole
          interaction of this page, the same way it is the whole interaction of
          LingoLecto's reading view.
        */
        <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 grid-cols-[1fr_360px] gap-4 overflow-hidden p-4">
          {/*
            NO CARD ON THIS SIDE, AND THE CONTRAST IS THE ARGUMENT.

            Everything this column holds is already a finished object with its
            own edge: a 3px ring around the face, a bordered balloon with a
            drawn tail, a bordered pill. A frame around the three of them is a
            fourth concentric edge to get past before the eye reaches the face,
            and it was containing nothing — the right-hand panel is a tab strip
            welded to a scroll area and genuinely needs a boundary, this was a
            backdrop.

            It was also flattening its own contents. The balloon is white and
            the pill is cream, and on `paper` those land at about 1.10:1 and
            1.03:1 — the two things the learner actually reads were held up
            entirely by their borders. On the mat they sit near 1.38:1 and
            1.33:1. Taking the card away separates them rather than setting
            them adrift, which is the opposite of what removing a card usually
            does.

            And it changes what the gap above the pill means. That space is
            deliberate — the spacer in TutorStage keeps the microphone at the
            foot — but framed it read as a mostly empty box, and unframed it
            reads as room between the tutor and the control.

            What this costs: the page is no longer LingoLecto's matched
            `.questioner-wrap` pair. That is on purpose. Two identical frames
            claimed the conversation and the reference panel were peers; they
            are not. The conversation is the page.

            `overflow-hidden`, not `auto`, and the padding stays: the column is
            laid out so that it always fits — the balloon and the spacer between
            them absorb everything that grows — and a scrollbar here would only
            ever appear as the symptom of that having failed. That contract is
            layout rather than decoration, so it survives the frame. See
            TutorStage.
          */}
          <div className="flex min-h-0 flex-col overflow-hidden px-8 py-8">
            <TutorStage
              session={session}
              kit={kit}
              agentText={agentText}
              learnerText={learnerText}
              tap={call.tap}
              speaking={call.speaking}
              heard={call.heard}
              transcribing={call.transcribing}
              live={call.live}
              openingDone={call.openingDone}
              busy={call.busy}
              smiling={smiling}
              tiltCue={call.tiltCue}
              idleHint={idleHint}
              onCall={() => {
                // Nothing to show — the learner pressed the button and knows
                // what it did — but the account has to be able to tell this
                // apart from the page closing a lesson on its own, which from
                // the outside is the same event and from the inside is a
                // different bug. See `hangUp`.
                if (call.live) call.hangUp(undefined, 'the learner pressed the microphone');
                else void start();
              }}
              onWord={askDictionary}
            />

            {/*
              All that is left below the pill, and it stays outside TutorStage
              so the pill keeps the foot of the panel: this line is usually
              absent, and a spacer that reserved room for it would leave a gap
              on every call that goes well.
            */}
            {call.detail && (
              <p className="mx-auto mt-3 max-w-xl shrink-0 text-center text-xs leading-relaxed text-lingo-muted">
                {call.detail}
              </p>
            )}
          </div>

          <aside className="flex min-h-0 flex-col overflow-hidden rounded-3xl border-4 border-lingo-terracotta bg-lingo-paper shadow-lingo-pop">
            {/*
              LingoLecto's tab strip, tile for tile (its `.qr-tabs` / `.qr-tab`).
              A student who reads a text there and then talks about it here meets
              the same three tabs in the same clothes, so the two pages read as
              one product rather than as two tools that happen to share a header.

              The strip is a header, not the top of the scroll area, and three
              things say so together: the warm ground behind it, the terracotta
              rule closing it, and the terracotta hairlines between the tabs. The
              active tab is a filled orange tile rather than an underlined word —
              orange means "this is the thing", and at this size an underline is
              too quiet to find at a glance.

              Its top corners are cut by the card's radius, which is the card's
              doing rather than the strip's: the frame clips, so the strip needs
              no corner of its own and cannot get one wrong when the radius moves.
            */}
            <div className="flex shrink-0 border-b-[3px] border-lingo-terracotta bg-lingo-panel-warm [&>button+button]:border-l-2 [&>button+button]:border-l-lingo-terracotta">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={`flex-1 select-none border-b-2 py-[9px] text-center font-lingo-brand text-[15px] font-normal transition-all duration-150 ${
                    tab === entry.id
                      ? 'border-b-lingo-accent-deep bg-lingo-accent text-lingo-paper'
                      : 'border-b-transparent text-lingo-muted hover:text-lingo-ink'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {/*
              The lifecycle of the first tab, top to bottom.

              The consigne sits above the gate in every state before there is a
              report, INCLUDING while the call is live — a learner three
              questions in wants to check what the fourth one is, and one who
              has to remember the consigne stops following it by the second
              turn. The gate underneath yields instead: `under` collapses it to
              a clock, or to nothing. See EvaluationGate.

              When the report arrives both go, and the reading has the panel to
              itself. Starting another conversation clears the report — see
              `start` — which brings the consigne back with no machinery of its
              own, and is why nothing here tracks a phase.
            */}
            {tab === 'evaluation' && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {advanced ? (
                  <AdvancedPanel report={advanced} />
                ) : report ? (
                  <EvaluationPanel report={report} />
                ) : (
                  <>
                    {consigne && session && (
                      <ConsignePanel session={session} answered={call.answered} />
                    )}
                    {/*
                      THE GATE IS TOLD THE CALL IS OVER BEFORE IT IS, once the
                      close has begun. Both of the props that lie are the same
                      lie: `live` hides the gate behind "your lesson is running"
                      and `lastCallMs` is only written on hang-up, so a page
                      waiting for either makes the learner sit through the
                      goodbye before it will offer them their mark. From the
                      moment the count completes there is nothing left to say
                      that could change the reading, so the gate is shown the
                      call as it will be rather than as it is, and the running
                      clock stands in for the finished one.
                    */}
                    <EvaluationGate
                      live={call.live && !closing}
                      elapsedMs={elapsedMs}
                      lastCallMs={closing ? elapsedMs : call.lastCallMs}
                      complete={lessonDone}
                      busy={reporting}
                      error={reportError}
                      under={consigne}
                      onEvaluate={() => {
                        /*
                          PRESSING IT DOES NOT END THE CALL, and it briefly did.
                          The argument for hanging up was that a learner asking
                          to be marked has heard enough and the call was costing
                          money — but what it actually did was cut the tutor off
                          mid-goodbye, and the goodbye is the turn the prompt
                          goes to the most trouble over: a sentence about their
                          answer, a specific word of praise quoting them back,
                          farewell. Ending it to save three seconds of socket
                          throws away the warmest thing in the lesson.

                          Nothing needs the call closed anyway. The marking runs
                          off the transcript as it stands, which already holds
                          every word the learner said — what is still to come is
                          the tutor talking, and the tutor is not who is being
                          marked. The close effect hangs up on its own a beat
                          after the farewell finishes, exactly as it would have.
                          So the report renders in the panel while the face
                          finishes speaking, and both land in their own time.
                        */
                        void evaluate();
                      }}
                    />
                  </>
                )}
              </div>
            )}

            {tab === 'dictionary' && (
              <DictionaryPanel l1={l1} request={request} onVocabChange={refreshWords} />
            )}

            {tab === 'vocab' && (
              <VocabPanel items={words} onOpen={openSaved} onChange={refreshWords} />
            )}
          </aside>
        </div>
      )}

      {/*
        Last, and outside everything.

        It is `fixed inset-0` and covers the page whatever it is showing, which
        includes the code box — a student who cannot open a code is exactly the
        case where somebody needs to see what the box was told. Rendering it
        inside either branch above would make the diagnostic available only on
        the half of the page that is already working.
      */}
      {diagnostic && (
        <DiagnosticPanel
          onClose={() => setDiagnostic(false)}
          input={{
            setup: session,
            typedCode: typed,
            codeError,
            modelKey,
            settings,
            l1,
            status: call.status,
            detail: call.detail,
            turns: call.turns,
            events: call.events,
            connectedAt: call.connectedAt,
            lastCallMs: call.lastCallMs,
            answered: call.answered,
            usage: call.usage,
            capMinutes: session ? capMinutesOf(session) : null,
            lessonDone,
            report,
            advanced,
            markingCost,
            reportError,
            reporting,
          }}
        />
      )}
    </div>
  );
}
