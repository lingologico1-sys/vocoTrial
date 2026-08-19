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
   * The one word on the call button, which is now the only control in the pill
   * that is not the microphone. Four states, and the third is why it is derived
   * here rather than inside LearnerPill: `lastCallMs` is the page's memory of
   * whether this learner has already had a conversation, and nothing in the
   * pill has any business knowing that.
   */
  const callLabel = call.busy
    ? FR.starting
    : call.live
      ? FR.hangUp
      : call.lastCallMs === null
        ? FR.start
        : FR.again;

  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'evaluation', label: FR.tabEvaluation },
    { id: 'dictionary', label: FR.tabDictionary },
    { id: 'vocab', label: FR.tabVocab },
  ];

  return (
    <div className="lingo-light flex h-screen flex-col overflow-hidden bg-lingo-paper font-lingo text-lingo-ink">
      <header className="flex h-14 shrink-0 items-center justify-between border-b-4 border-lingo-rule bg-lingo-bar px-6">
        <div className="flex items-center gap-2">
          {/*
            Chock A Block draws the tile box as part of each glyph, so the
            wordmark is text with a stroke rather than text on a fill — a CSS
            background would cover the whole inline box and turn the blocks'
            transparent interiors opaque. Cream on this blue is about 1.3:1, so
            the stroke is doing the real work.
          */}
          <div
            className="flex gap-0.5 font-lingo-block text-xl leading-none"
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

          <div className="ml-1.5 flex items-center gap-1.5">
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[5px] border-2 border-lingo-stroke bg-lingo-accent shadow-lingo-pop-sm">
              <Mic size={12} className="text-lingo-paper" strokeWidth={2.5} />
            </span>
            <span
              className="font-lingo-brand text-[17px] leading-none text-lingo-accent"
              style={{ WebkitTextStroke: '0.07em #311706', paintOrder: 'stroke fill' }}
            >
              Voco
            </span>
          </div>

          <span className="mx-2 h-4 w-px bg-lingo-paper/30" />
          <span className="font-lingo-hand text-[15px] leading-none text-lingo-paper/75">
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
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_360px] overflow-hidden">
          <div className="flex min-h-0 flex-col overflow-y-auto border-r border-lingo-border px-8 py-8">
            <TutorStage
              session={session}
              kit={kit}
              agentText={agentText}
              learnerText={learnerText}
              tap={call.tap}
              speaking={call.speaking}
              heard={call.heard}
              muted={call.muted}
              live={call.live}
              tiltCue={call.tiltCue}
              callLabel={callLabel}
              callBusy={call.busy}
              onCall={() => (call.live ? call.hangUp() : start())}
              onToggleMute={call.toggleMute}
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

          <aside className="flex min-h-0 flex-col overflow-hidden bg-lingo-paper">
            <div className="flex shrink-0 border-b border-lingo-border">
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  className={`flex-1 select-none border-b-2 py-2.5 text-[13px] font-semibold transition-colors ${
                    tab === entry.id
                      ? 'border-lingo-accent text-lingo-accent'
                      : 'border-transparent text-lingo-muted hover:text-lingo-ink'
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
