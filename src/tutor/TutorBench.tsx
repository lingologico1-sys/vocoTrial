import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Radio } from 'lucide-react';
import { startGeminiSession } from '../realtime/gemini';
import { defaultModelKey, findModel, visibleModels } from '../realtime/models';
import { LANGUAGES, defaultLanguageCode, findLanguage } from '../realtime/languages';
import { MAX_INSTRUCTIONS } from '../realtime/instructions';
import { usePromptLibrary } from '../realtime/usePromptLibrary';
import type { SessionSettings } from '../realtime/settings';
import BuildBadge from '../BuildBadge';
import ReturnButton from '../ReturnButton';
import SettingsPanel from './SettingsPanel';
import {
  MIN_PROJECTION_SECONDS,
  RATES_VERIFIED_ON,
  estimateCost,
  formatDuration,
  formatTokens,
  formatUsd,
  projectHour,
  speakingTime,
  totalTokens,
  type UsageTotals,
} from '../realtime/cost';
import type { SessionStatus, TranscriptDelta, VoiceSession } from '../realtime/types';
import type { Evaluator } from '../realtime/evaluators';
import {
  deleteEvaluator,
  lastEvaluatorId,
  listEvaluators,
  newEvaluatorId,
  rememberEvaluator,
  saveEvaluator,
} from '../realtime/evaluatorStore';
import type { SessionReport } from '../realtime/report';
import EvaluatorPanel from './EvaluatorPanel';
import ReportPanel from './ReportPanel';

interface Turn {
  /** Google's id for this turn, when it gives one. See TranscriptDelta. */
  id?: string;
  role: 'user' | 'agent';
  text: string;
  /** Closed turns never take another delta, so a new one starts a new bubble. */
  done: boolean;
}

/**
 * How long a call may go with nobody talking before it hangs itself up.
 *
 * Audio bills per second of connection, not per word, so a forgotten tab costs
 * exactly as much as a conversation. Generous on purpose: this is a language
 * practice app, and a learner assembling a sentence goes quiet for a long time
 * — the timeout is here to catch an abandoned call, not to hurry anyone.
 */
const IDLE_TIMEOUT_MS = 90_000;
/** How often to test the clock. Coarse; nothing here needs to be prompt. */
const IDLE_POLL_MS = 5_000;

/**
 * Where the in-progress prompt and the settings survive a reload.
 *
 * A trial is a sequence of calls you compare, and retyping a prompt between two
 * of them is both tedious and a way to change the thing you were holding
 * constant. Nothing here is a secret — the credentials live in an HttpOnly
 * cookie precisely so that they never touch this store.
 *
 * Distinct from the prompt library in realtime/presets.ts, which holds the
 * prompts you deliberately saved and now lives in R2 so that studio on another
 * machine can publish one. This is the scratch copy: the text in the box right
 * now, whether or not it has a name — and it stays in this browser, because a
 * half-typed prompt is not something another machine should be handed.
 */
const PREFS_KEY = 'vocotrial.prefs.v1';

interface Prefs {
  /**
   * Which preset the saved `instructions` were being written against.
   *
   * Stored so it can be *compared*, not to decide what opens on its own. If it
   * disagrees with the remembered pick, a pick was made somewhere else since
   * this was written and the scratch text belongs to a prompt that is no longer
   * selected; the load below drops it rather than showing it under the wrong
   * name.
   */
  presetKey: string;
  instructions: string;
  edited: boolean;
  settings: SessionSettings;
  /**
   * The learner's own language, which the end-of-call report is written in.
   *
   * Here rather than in the evaluator store because it belongs to the person
   * using the bench, not to the scale — switching scales must not switch the
   * language the report comes back in.
   */
  l1Code?: string;
}

/** Anything malformed is discarded rather than repaired: it is only a cache. */
function loadPrefs(): Partial<Prefs> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  live: 'Live',
  closed: 'Call ended',
  error: 'Error',
};

export default function TutorBench() {
  const [modelKey, setModelKey] = useState(defaultModelKey());
  const [language, setLanguage] = useState(defaultLanguageCode());

  /**
   * The prompt and the knobs. Kept across a model switch on purpose — running
   * both models on the same instructions is the entire point of the bench, and
   * the Worker drops whatever the chosen model does not accept.
   *
   * The page opens on the preset used last, here or on studio. The scratch
   * text from the previous visit comes back with it only if it was written
   * against that same preset — see Prefs.presetKey.
   */
  const [prefs] = useState(loadPrefs);
  /**
   * The prompt, the list it comes out of, and every way of changing them.
   *
   * SHARED WITH STUDIO, which is the point of it living in a hook rather than
   * in this file: studio publishes what is written here as a manner, and until
   * it mounted the same editor over the same store it could only pick from the
   * list and send you back over here to change a word. The scratch copy is
   * still this page's — see Prefs — so the hook is handed what was restored
   * and hands back what to store.
   */
  const library = usePromptLibrary({
    language: findLanguage(language) ?? LANGUAGES[0],
    initial: prefs,
  });
  const { presetKey, instructions, edited, error: presetError } = library;
  const [settings, setSettings] = useState<SessionSettings>(prefs.settings ?? {});

  /**
   * The scale the finished call is read against, and the library it came from.
   *
   * The list is fetched rather than read from a store: evaluators live in R2 so
   * that one authored here reaches a student on another machine, which means
   * the browser cannot know them at first paint. listEvaluators always yields
   * at least the built-in, so there is no empty state to render.
   */
  const [evaluators, setEvaluators] = useState<Evaluator[]>([]);
  const [evaluatorId, setEvaluatorId] = useState('');
  const [evaluatorError, setEvaluatorError] = useState<string | undefined>();
  const [l1Code, setL1Code] = useState(() => prefs.l1Code ?? 'en');

  /** The report for the call just ended. Cleared when the next one starts. */
  const [report, setReport] = useState<SessionReport | null>(null);
  const [reportUsd, setReportUsd] = useState(0);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const [status, setStatus] = useState<SessionStatus>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [usage, setUsage] = useState<UsageTotals | null>(null);
  /**
   * The model the *call* ran on, not the one the picker is showing. The picker
   * unlocks the moment the call ends, so pricing the summary off it would
   * silently reprice a finished call the instant the user browsed the dropdown.
   */
  const [billedModel, setBilledModel] = useState<string | null>(null);
  /**
   * How long the finished call was live, in seconds.
   *
   * Timed from `live` rather than from the button, because the wait for a
   * credential and an SDP round trip bills nothing and would flatter an hourly
   * projection that divides by it.
   */
  const [callSeconds, setCallSeconds] = useState<number | null>(null);

  const session = useRef<VoiceSession | null>(null);
  const log = useRef<HTMLDivElement>(null);
  /**
   * When either side was last known to be talking. A ref, not state: it is
   * written on nearly every audio frame and nothing renders from it.
   */
  const lastActivity = useRef(Date.now());
  /** When the call went live, for the clock above. Null between calls. */
  const wentLive = useRef<number | null>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  // A live session holds the microphone, so it must not survive the component.
  useEffect(() => () => session.current?.stop(), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ presetKey, instructions, edited, settings, l1Code } satisfies Prefs),
      );
    } catch {
      // Private browsing, or a full quota. Losing the cache is not worth an error.
    }
  }, [presetKey, instructions, edited, settings, l1Code]);

  // The evaluator library, once, at mount. A failure leaves the built-in
  // selected and says so beside the panel rather than blocking the page.
  useEffect(() => {
    let live = true;
    void listEvaluators().then(({ evaluators: found, error }) => {
      if (!live) return;
      setEvaluators(found);
      setEvaluatorId(lastEvaluatorId(found));
      setEvaluatorError(error);
    });
    return () => {
      live = false;
    };
  }, []);

  const appendTranscript = useCallback((delta: TranscriptDelta) => {
    // Any transcript at all means somebody just said something.
    lastActivity.current = Date.now();

    setTurns((current) => {
      const tail = current.length - 1;
      const index = delta.id
        ? current.findIndex((turn) => turn.id === delta.id)
        : current[tail]?.role === delta.role && !current[tail].done
          ? tail
          : -1;

      if (index === -1) {
        // An id'd delta with no text opens the turn anyway: that is how a
        // provider claims its place in the log before the words exist.
        if (!delta.text && !delta.id) return current;
        return [...current, { id: delta.id, role: delta.role, text: delta.text, done: delta.done }];
      }

      const turn = current[index];
      const next = [...current];
      next[index] = { ...turn, text: turn.text + delta.text, done: turn.done || delta.done };
      return next;
    });
  }, []);

  const connect = async () => {
    setTurns([]);
    setReport(null);
    setReportError(null);
    setDetail(null);
    setMuted(false);
    setUsage(null);
    setCallSeconds(null);
    wentLive.current = null;
    setBilledModel(findModel(modelKey)?.id ?? null);

    const handlers = {
      onStatus: (next: SessionStatus, message?: string) => {
        setStatus(next);
        setDetail(message ?? null);
        // A provider may report `live` more than once; the first one is when
        // the meter started running.
        if (next === 'live' && wentLive.current === null) wentLive.current = Date.now();
        if (next === 'closed' || next === 'error') {
          if (wentLive.current !== null) {
            setCallSeconds((Date.now() - wentLive.current) / 1000);
            wentLive.current = null;
          }
          session.current = null;
          setSpeaking(false);
        }
      },
      onTranscript: appendTranscript,
      onSpeaking: (next: boolean) => {
        lastActivity.current = Date.now();
        setSpeaking(next);
      },
      onUsage: setUsage,
    };

    try {
      // The settings go over as written and are checked on arrival, where the
      // model is known: functions/api/live/_resolve.ts.
      const config = { instructions, settings };
      // Set before awaiting: the clock starts at the moment of connecting, so a
      // call nobody ever speaks into still times out.
      lastActivity.current = Date.now();
      session.current = await startGeminiSession(handlers, modelKey, language, config);
    } catch (error) {
      session.current = null;
      setStatus('error');
      setDetail(error instanceof Error ? error.message : 'Could not start the session');
    }
  };

  const hangUp = (reason?: string) => {
    session.current?.stop();
    session.current = null;
    // stop() drives onStatus('closed'), which clears detail — so say why after,
    // not before, or the message is wiped the moment it is set.
    if (reason) setDetail(reason);
  };

  /**
   * Hangs up a call nobody is on.
   *
   * Polls a timestamp rather than resetting a timer on every frame: activity
   * arrives many times a second during speech, and rescheduling a timeout that
   * often is a lot of churn to answer a question this coarse.
   */
  useEffect(() => {
    if (status !== 'live') return;

    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current < IDLE_TIMEOUT_MS) return;
      hangUp(`Ended automatically after ${IDLE_TIMEOUT_MS / 1000}s with no one talking`);
    }, IDLE_POLL_MS);

    return () => clearInterval(timer);
  }, [status]);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    session.current?.setMuted(next);
  };

  const busy = status === 'connecting';
  const live = status === 'live';
  // The Worker refuses an over-long prompt too; catching it here saves a round
  // trip and says so next to the button rather than in the status line.
  const tooLong = instructions.length > MAX_INSTRUCTIONS;
  const model = findModel(modelKey) ?? visibleModels()[0];

  // A reserved turn whose transcript never arrived holds its place in the
  // ordering but has nothing to draw.
  const spoken = turns.filter((turn) => turn.text);

  const chooseEvaluator = useCallback((id: string) => {
    setEvaluatorId(id);
    rememberEvaluator(id);
    setEvaluatorError(undefined);
  }, []);

  /**
   * Saves a scale and re-selects it.
   *
   * The id is minted here rather than in the panel because "save as new" and
   * "save a copy of the built-in" are the same operation to the store and the
   * panel should not have to know that — it sends an empty id to mean either.
   */
  const saveScale = useCallback(async (draft: Evaluator) => {
    setEvaluatorError(undefined);
    try {
      const saved = await saveEvaluator({ ...draft, id: draft.id || newEvaluatorId() });
      setEvaluators((current) => [
        current[0],
        saved,
        ...current.slice(1).filter((entry) => entry.id !== saved.id),
      ]);
      setEvaluatorId(saved.id);
      rememberEvaluator(saved.id);
    } catch (error) {
      setEvaluatorError(error instanceof Error ? error.message : 'Could not save that scale');
    }
  }, []);

  const removeScale = useCallback(async (id: string) => {
    setEvaluatorError(undefined);
    try {
      await deleteEvaluator(id);
      setEvaluators((current) => current.filter((entry) => entry.id !== id));
      // Back to the built-in, which is always present and never deletable.
      setEvaluatorId((current) => (current === id ? (evaluators[0]?.id ?? '') : current));
    } catch (error) {
      setEvaluatorError(error instanceof Error ? error.message : 'Could not delete that scale');
    }
  }, [evaluators]);

  /**
   * Reads the finished call against the chosen scale.
   *
   * Deliberately a button rather than something that fires on hang-up. A report
   * costs about a penny and most calls on this bench are half a sentence long
   * to check a knob — paying for a reading of every one of them, and waiting
   * for it, would make the bench worse at the thing it is for.
   */
  const makeReport = useCallback(async () => {
    setReporting(true);
    setReportError(null);
    try {
      const response = await fetch('/api/report/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          languageCode: language,
          l1Code,
          evaluatorId,
          turns: spoken.map((turn) => ({ role: turn.role, text: turn.text })),
        }),
      });
      const answer = (await response.json().catch(() => null)) as
        | { report?: SessionReport; usd?: number; error?: string }
        | null;
      if (!response.ok || !answer?.report) {
        throw new Error(answer?.error || 'The report could not be written');
      }
      setReport(answer.report);
      setReportUsd(answer.usd ?? 0);
    } catch (error) {
      setReportError(error instanceof Error ? error.message : 'The report could not be written');
    } finally {
      setReporting(false);
    }
  }, [language, l1Code, evaluatorId, spoken]);

  // Only after the call, and only if the provider actually reported something.
  const ended = status === 'closed' || status === 'error';
  const summary =
    ended && usage && billedModel && totalTokens(usage) > 0
      ? {
          usage,
          cost: estimateCost(billedModel, usage),
          // Null only if the call never reached `live`, which usage this side of
          // zero makes unlikely — but the clock is not worth faking if it does.
          time: callSeconds === null ? null : speakingTime(billedModel, usage, callSeconds),
          hourly: callSeconds === null ? null : projectHour(billedModel, usage, callSeconds),
          truncated: status === 'error',
        }
      : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <BuildBadge look="workshop" />
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">tutorBench</h1>
          {/* Plain links, not a router push: main.tsx reads the path once at
              startup, so crossing between the pages is a reload by design. */}
          <nav className="flex items-center gap-3">
            <ReturnButton look="workshop" />
            <a
              href="/studio"
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-sm font-medium text-slate-400 transition hover:border-slate-700 hover:text-slate-200"
            >
              studio →
            </a>
          </nav>
        </header>

        <label className="flex items-center gap-3 rounded-lg border border-slate-800 px-4 py-2.5">
          <span className="text-xs uppercase tracking-wide text-slate-500">Practising</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            disabled={live || busy}
            className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
          >
            {LANGUAGES.map((choice) => (
              <option key={choice.code} value={choice.code} className="bg-slate-900">
                {choice.label}
                {choice.endonym !== choice.label ? ` · ${choice.endonym}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-3 rounded-lg border border-slate-800 px-4 py-2.5">
          <span className="text-xs uppercase tracking-wide text-slate-500">Model</span>
          <select
            value={modelKey}
            onChange={(event) => setModelKey(event.target.value)}
            disabled={live || busy}
            className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
          >
            {visibleModels().map((model) => (
              <option key={model.key} value={model.key} className="bg-slate-900">
                {model.label}
                {model.unverified ? ' (unverified id)' : ''}
              </option>
            ))}
          </select>
        </label>

        <div>
          <SettingsPanel
            model={model}
            disabled={live || busy}
            library={library}
            settings={settings}
            onSettings={setSettings}
          />
          {/* Outside the <details>, so a save that failed is visible even if
              the panel has since been collapsed over it. */}
          {presetError && <p className="mt-1 px-1 text-xs text-rose-400">{presetError}</p>}
        </div>

        <EvaluatorPanel
          disabled={live || busy}
          evaluators={evaluators}
          evaluatorId={evaluatorId}
          onEvaluator={chooseEvaluator}
          l1Code={l1Code}
          onL1={setL1Code}
          onSave={saveScale}
          onDelete={removeScale}
          error={evaluatorError}
        />

        <div className="flex items-center gap-3 rounded-lg border border-slate-800 px-4 py-3">
          <Radio
            size={16}
            className={
              live
                ? speaking
                  ? 'text-emerald-400 animate-pulse'
                  : 'text-emerald-400'
                : status === 'error'
                  ? 'text-rose-400'
                  : 'text-slate-600'
            }
          />
          <span className="text-sm">{STATUS_LABEL[status]}</span>
          {detail && <span className="truncate text-sm text-slate-500">— {detail}</span>}
        </div>

        <div
          ref={log}
          className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-slate-800 p-4"
        >
          {spoken.length === 0 && (
            <p className="text-sm text-slate-600">
              Start the call and talk. The transcript appears here.
            </p>
          )}
          {spoken.map((turn, index) => (
            <div
              key={index}
              className={turn.role === 'user' ? 'text-right' : 'text-left'}
            >
              <span
                className={`inline-block max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
                  turn.role === 'user'
                    ? 'bg-sky-500/15 text-sky-100'
                    : 'bg-slate-800/70 text-slate-200'
                }`}
              >
                {turn.text}
              </span>
            </div>
          ))}
        </div>

        {summary && (
          <div className="rounded-lg border border-slate-800 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-slate-500">
                Estimated cost
              </span>
              <span className="font-mono text-lg text-slate-100">
                {summary.cost.priced ? formatUsd(summary.cost.usd) : '—'}
              </span>
            </div>

            {summary.time && (
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span title="Wall clock, from the moment the call went live to the moment it ended">
                  Call length{' '}
                  <span className="font-mono text-slate-300">
                    {formatDuration(summary.time.callSeconds)}
                  </span>
                </span>
                {summary.time.userSeconds !== null && (
                  <span title="Derived from your audio input tokens, which are billed per second of speech">
                    You spoke{' '}
                    <span className="font-mono text-slate-300">
                      ≈{formatDuration(summary.time.userSeconds)}
                    </span>
                  </span>
                )}
                {summary.time.agentSeconds !== null && (
                  <span title="Derived from the audio output tokens — the speech you actually heard">
                    Agent spoke{' '}
                    <span className="font-mono text-slate-300">
                      ≈{formatDuration(summary.time.agentSeconds)}
                    </span>
                  </span>
                )}
              </div>
            )}

            {summary.cost.priced ? (
              <table className="mt-3 w-full text-xs text-slate-400">
                <tbody>
                  {summary.cost.lines.map((line) => (
                    <tr key={line.label}>
                      <td className="py-0.5">
                        <span title={line.hint} className="cursor-help decoration-slate-700 decoration-dotted underline-offset-2 hover:underline">
                          {line.label}
                        </span>
                      </td>
                      <td className="py-0.5 text-right font-mono">
                        {formatTokens(line.tokens)}
                      </td>
                      <td className="py-0.5 text-right font-mono text-slate-600">
                        ${line.rate}/M
                      </td>
                      <td className="py-0.5 text-right font-mono text-slate-300">
                        {formatUsd(line.usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-xs text-slate-500">
                {formatTokens(totalTokens(summary.usage))} tokens on {billedModel}, which has
                no rates in the table.
              </p>
            )}

            {summary.hourly && (
              <div className="mt-3 border-t border-slate-800 pt-3">
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-slate-400">An hour of this conversation</span>
                  <span className="font-mono text-slate-100">
                    {formatUsd(summary.hourly.usd)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                  This call&rsquo;s spend per second, stretched to 60 minutes. Expect more:
                  every turn re-sends the conversation so far, so an untrimmed, uncached
                  hour reaches {formatUsd(summary.hourly.ceilingUsd)}. Google&rsquo;s own
                  context trimming pulls it back towards the first figure.
                </p>
              </div>
            )}

            {summary.time && !summary.hourly && summary.cost.priced && (
              <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
                Too short to project an hour from — under {MIN_PROJECTION_SECONDS}s, the
                greeting and the system prompt are most of the bill.
              </p>
            )}

            <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
              Google-reported tokens at {RATES_VERIFIED_ON} list prices — an estimate, not your
              bill. Excludes the Cloudflare Worker time the relay bills.
              {summary.truncated && ' The call ended abnormally, so the final usage may be missing.'}
            </p>
          </div>
        )}

        {!live && spoken.some((turn) => turn.role === 'user') && (
          <div className="space-y-3">
            {!report && (
              <button
                type="button"
                onClick={makeReport}
                disabled={reporting || !evaluatorId}
                className="w-full rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-900 disabled:opacity-50"
              >
                {reporting ? 'Reading the call…' : 'Read this call against the scale'}
              </button>
            )}
            {reportError && <p className="px-1 text-xs text-rose-400">{reportError}</p>}
            {report && <ReportPanel report={report} usd={reportUsd} />}
          </div>
        )}

        <div className="flex gap-3">
          {live ? (
            <>
              <button
                type="button"
                onClick={toggleMute}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-3 text-sm font-medium hover:bg-slate-900"
              >
                {muted ? <MicOff size={16} /> : <Mic size={16} />}
                {muted ? 'Unmute' : 'Mute'}
              </button>
              <button
                type="button"
                onClick={() => hangUp()}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-3 text-sm font-medium hover:bg-rose-500"
              >
                <PhoneOff size={16} />
                End call
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={connect}
              disabled={busy || tooLong}
              title={tooLong ? `Instructions are limited to ${MAX_INSTRUCTIONS} characters` : undefined}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-3 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
            >
              <Mic size={16} />
              {busy ? 'Connecting…' : tooLong ? 'Instructions too long' : 'Start call'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
