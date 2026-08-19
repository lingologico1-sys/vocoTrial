import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import type { FaceKit } from '../facekit/kit';
import { loadBundledKit } from '../facekit/bundled';
import { publishedKit } from '../facekit/store';
import { L1_CHOICES, resolveL1 } from '../realtime/l1';
import type { SessionReport } from '../realtime/report';
import type { StudentSession } from '../realtime/session';
import { codeFromUrl, fetchSession } from '../realtime/sessionStore';
import { useVoiceCall } from '../live/useVoiceCall';
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
 * THE THIRD TIER. tutorBench, faceKit and liveTrial are the workshop — dark,
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

/** Below this a conversation has not produced enough to read. Two minutes. */
const MIN_EVAL_MS = 120_000;

/** Where the learner's own language is remembered. Nothing here is a secret. */
const L1_KEY = 'vocotrial.eleve.l1';

type Tab = 'evaluation' | 'dictionary' | 'vocab';

function loadL1(): string {
  try {
    return window.localStorage.getItem(L1_KEY) ?? L1_CHOICES[0].code;
  } catch {
    return L1_CHOICES[0].code;
  }
}

export default function Eleve() {
  const [session, setSession] = useState<StudentSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [kit, setKit] = useState<FaceKit | null>(null);

  const [l1, setL1] = useState(loadL1);
  const [tab, setTab] = useState<Tab>('evaluation');

  const [words, setWords] = useState<VocabItem[]>([]);
  const [request, setRequest] = useState<LookupRequest | null>(null);
  const lookupSeq = useRef(0);

  const [report, setReport] = useState<SessionReport | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  /** Ticks only while a call is up, so the elapsed line moves. */
  const [now, setNow] = useState(() => Date.now());

  const call = useVoiceCall({
    modelKey: 'gemini-native-audio',
    language: session?.language ?? 'fr',
    instructions: session?.instructions ?? '',
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
    settings: useMemo(() => {
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
        ...(session.proactiveAudio !== undefined
          ? { proactiveAudio: session.proactiveAudio }
          : {}),
        ...(session.temperature !== undefined ? { temperature: session.temperature } : {}),
        ...(session.maxOutputTokens !== undefined
          ? { maxOutputTokens: session.maxOutputTokens }
          : {}),
      };
    }, [session]),
  });

  // --- The published setup, and the face it names.
  useEffect(() => {
    let alive = true;

    fetchSession(codeFromUrl())
      .then(async (found) => {
        if (!alive) return;
        setSession(found);
        setLoading(false);
        if (!found) return;

        // The artwork is fetched after the setup rather than with it: a kit is
        // megabytes and the page has something to show without it.
        try {
          const worn = found.faceId ? await publishedKit(found.faceId) : await loadBundledKit();
          if (alive) setKit(worn);
        } catch {
          // The drawn placeholder is a smaller page, not a broken one.
        }
      })
      .catch(() => {
        if (!alive) return;
        setLoading(false);
        setLoadFailed(true);
      });

    return () => {
      alive = false;
    };
  }, []);

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

  const start = () => {
    setReport(null);
    setReportError(null);
    void call.connect();
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
      const answer = (await response.json().catch(() => null)) as
        | { report?: SessionReport; error?: string }
        | null;
      if (!response.ok || !answer?.report) {
        throw new Error(answer?.error || FR.evalFailed);
      }
      setReport(answer.report);
    } catch (problem) {
      setReportError(problem instanceof Error ? problem.message : FR.evalFailed);
    } finally {
      setReporting(false);
    }
  };

  const elapsedMs = call.connectedAt === null ? null : now - call.connectedAt;

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

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'evaluation', label: FR.tabEvaluation },
    { id: 'dictionary', label: FR.tabDictionary },
    { id: 'vocab', label: FR.tabVocab },
  ];

  return (
    <div className="lingo-light flex h-screen flex-col overflow-hidden bg-lingo-mat font-lingo text-lingo-ink">
      {/*
        The bar is full bleed, its contents are not — LingoLecto's
        `.header-inner`, at its own numbers.

        The lockup and the language picker are cut to the same 1152px column
        the two cards below are cut to, with the same 16px gutter, so the
        wordmark starts where the left card starts and the picker ends where
        the right card ends. Without it the lockup hangs off the far corner of
        a wide monitor while everything it belongs to sits in the middle. The
        gutter lives on this inner row rather than on the bar for the reason
        LingoLecto found: on the bar it lands outside the cap, which insets the
        lockup from the column while the cards are inset from the mat instead,
        and the two insets are not the same 16px.
      */}
      <header className="flex h-14 shrink-0 items-center border-b-4 border-lingo-rule bg-lingo-bar">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4">
          {/*
            No `gap` on this row: every piece of the lockup carries its own
            margin, copied one for one from LingoLecto, and a gap here would add
            itself to each of them — which is how the wordmark came to sit 14px
            from `Voco` where LingoLecto puts it at 9.
          */}
          <div className="flex items-center">
            {/*
              Chock A Block draws the tile box as part of each glyph, so the
              wordmark is text with a stroke rather than text on a fill — a CSS
              background would cover the whole inline box and turn the blocks'
              transparent interiors opaque. Cream on this blue is about 1.3:1, so
              the stroke is doing the real work.

              The sizes are LingoLecto's `.brand-lock--inline`, not a fresh guess:
              30px wordmark, 26px badge around a 15px glyph, 22px sub-name, 22px
              divider. That variant exists because its reading view is a 100vh
              flex column where a pixel of header is a pixel of passage, so the
              lockup is grown inside a fixed 56px bar rather than by growing the
              bar — the wordmark plus its stroke is ~32px of the 56, and that is
              the ceiling here, not the font size. This page is the same shape and
              the same bar, so it takes the same numbers; anything smaller and the
              two apps read as different headers, which is what they did.
            */}
            <div
              className="flex gap-0.5 font-lingo-block text-[30px] leading-none"
              role="img"
              aria-label="LingoMondo"
            >
              {'LINGO'.split('').map((letter, index) => (
                <span
                  key={`lingo-${index}`}
                  aria-hidden="true"
                  className="text-lingo-paper"
                  style={{ WebkitTextStroke: '0.03em #311706' }}
                >
                  {letter}
                </span>
              ))}
              {'MONDO'.split('').map((letter, index) => (
                <span
                  key={`mondo-${index}`}
                  aria-hidden="true"
                  className="text-lingo-gold"
                  style={{ WebkitTextStroke: '0.03em #311706' }}
                >
                  {letter}
                </span>
              ))}
            </div>

            <div className="ml-[9px] flex items-center gap-1.5">
              <span className="flex h-[26px] w-[26px] items-center justify-center rounded-md border-2 border-lingo-stroke bg-lingo-accent shadow-lingo-pop-sm">
                <Mic size={15} className="text-lingo-paper" strokeWidth={2.5} />
              </span>
              <span
                className="font-lingo-brand text-[22px] leading-none text-lingo-accent"
                style={{ WebkitTextStroke: '0.07em #311706', paintOrder: 'stroke fill' }}
              >
                Voco
              </span>
            </div>

            <span className="mx-3 h-[22px] w-px bg-lingo-paper/30" />
            <span className="font-lingo-hand text-sm leading-none text-lingo-paper/75">
              {FR.tagline}
            </span>
          </div>

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
        </div>
      </header>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-lingo-muted">…</p>
        </div>
      ) : !session ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="w-full max-w-md rounded-2xl border-2 border-lingo-border-strong bg-lingo-surface px-9 py-10 text-center shadow-lingo-pop">
            <h1 className="font-lingo-display text-2xl font-semibold">
              {loadFailed ? FR.loadFailedTitle : FR.noTutorTitle}
            </h1>
            <p className="mt-2.5 text-sm leading-relaxed text-lingo-muted">
              {loadFailed ? FR.loadFailedBody : FR.noTutorBody}
            </p>
            {loadFailed && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-6 w-full rounded-xl bg-lingo-accent px-6 py-3 text-[15px] font-semibold text-white shadow-lingo-pop-sm transition-colors hover:bg-lingo-accent-deep"
              >
                {FR.retry}
              </button>
            )}
          </div>
        </div>
      ) : (
        /*
          LingoLecto's `.questioner-wrap`: a 1152px cap, 16px of mat as padding
          around the pair and again in the gap between them, and each side a card
          of paper inside a 4px terracotta frame rounded at 24px.

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
            `overflow-hidden`, not `auto`: the column is laid out so that it
            always fits — the balloon and the spacer between them absorb
            everything that grows — and a scrollbar here would only ever appear
            as the symptom of that having failed. See TutorStage.
          */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-3xl border-4 border-lingo-terracotta bg-lingo-paper px-8 py-8 shadow-lingo-pop">
            <TutorStage
              session={session}
              kit={kit}
              agentText={agentText}
              learnerText={learnerText}
              tap={call.tap}
              speaking={call.speaking}
              heard={call.heard}
              live={call.live}
              busy={call.busy}
              tiltCue={call.tiltCue}
              idleHint={idleHint}
              onCall={() => (call.live ? call.hangUp() : start())}
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

            {tab === 'evaluation' && (
              <div className="min-h-0 flex-1 overflow-y-auto">
                {report ? (
                  <EvaluationPanel report={report} />
                ) : (
                  <EvaluationGate
                    live={call.live}
                    elapsedMs={elapsedMs}
                    lastCallMs={call.lastCallMs}
                    minimumMs={MIN_EVAL_MS}
                    busy={reporting}
                    error={reportError}
                    onEvaluate={() => void evaluate()}
                  />
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
    </div>
  );
}
