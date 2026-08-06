import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Radio } from 'lucide-react';
import { startOpenAiSession } from './realtime/openai';
import { startGeminiSession } from './realtime/gemini';
import { defaultModelKey, findModel, visibleModels } from './realtime/models';
import { LANGUAGES, defaultLanguageCode, findLanguage } from './realtime/languages';
import {
  INSTRUCTION_PRESETS,
  MAX_INSTRUCTIONS,
  defaultPresetKey,
  findPreset,
} from './realtime/instructions';
import type { SessionSettings } from './realtime/settings';
import SettingsPanel from './SettingsPanel';
import {
  RATES_VERIFIED_ON,
  estimateCost,
  formatTokens,
  formatUsd,
  totalTokens,
  type UsageTotals,
} from './realtime/cost';
import type { Provider, SessionStatus, TranscriptDelta, VoiceSession } from './realtime/types';

interface Turn {
  /** The provider's id for this turn, when it gives one. See TranscriptDelta. */
  id?: string;
  role: 'user' | 'agent';
  text: string;
  /** Closed turns never take another delta, so a new one starts a new bubble. */
  done: boolean;
}

const PROVIDERS: Array<{ id: Provider; label: string }> = [
  { id: 'gemini', label: 'Gemini Live' },
  { id: 'openai', label: 'OpenAI Realtime' },
];

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
 * Where the prompt and the settings survive a reload.
 *
 * A trial is a sequence of calls you compare, and retyping a prompt between two
 * of them is both tedious and a way to change the thing you were holding
 * constant. Nothing here is a secret — the credentials live in an HttpOnly
 * cookie precisely so that they never touch this store.
 */
const PREFS_KEY = 'vocotrial.prefs.v1';

interface Prefs {
  presetKey: string;
  instructions: string;
  edited: boolean;
  settings: SessionSettings;
}

function renderPreset(presetKey: string, languageCode: string): string {
  const preset = findPreset(presetKey) ?? INSTRUCTION_PRESETS[0];
  const language = findLanguage(languageCode) ?? LANGUAGES[0];
  return preset.render(language);
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

export default function App() {
  const [provider, setProvider] = useState<Provider>('gemini');
  // Keyed by provider so switching back and forth remembers each side's pick.
  const [modelKeys, setModelKeys] = useState<Record<Provider, string>>({
    gemini: defaultModelKey('gemini'),
    openai: defaultModelKey('openai'),
  });
  // Not keyed by provider: the language is the user's, not the model's.
  const [language, setLanguage] = useState(defaultLanguageCode());

  /**
   * The prompt and the knobs. Shared across providers on purpose — running two
   * models on the same instructions is the entire point of the rig, and the
   * Worker drops whatever the chosen model does not accept.
   */
  const [prefs] = useState(loadPrefs);
  const [presetKey, setPresetKey] = useState(prefs.presetKey ?? defaultPresetKey());
  const [instructions, setInstructions] = useState(
    () => prefs.instructions ?? renderPreset(prefs.presetKey ?? defaultPresetKey(), defaultLanguageCode()),
  );
  const [edited, setEdited] = useState(prefs.edited ?? false);
  const [settings, setSettings] = useState<SessionSettings>(prefs.settings ?? {});

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

  const session = useRef<VoiceSession | null>(null);
  const log = useRef<HTMLDivElement>(null);
  /**
   * When either side was last known to be talking. A ref, not state: it is
   * written on nearly every audio frame and nothing renders from it.
   */
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  // A live session holds the microphone, so it must not survive the component.
  useEffect(() => () => session.current?.stop(), []);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ presetKey, instructions, edited, settings } satisfies Prefs),
      );
    } catch {
      // Private browsing, or a full quota. Losing the cache is not worth an error.
    }
  }, [presetKey, instructions, edited, settings]);

  /**
   * An untouched prompt follows the language picker; an edited one does not.
   *
   * Rewriting someone's own words because they switched from French to Italian
   * would lose work, so the tracking stops the moment they type. Editing it back
   * to the preset's exact text starts it again — see onInstructions below.
   */
  useEffect(() => {
    if (edited) return;
    setInstructions(renderPreset(presetKey, language));
  }, [presetKey, language, edited]);

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
    setDetail(null);
    setMuted(false);
    setUsage(null);
    setBilledModel(findModel(modelKeys[provider])?.id ?? null);

    const handlers = {
      onStatus: (next: SessionStatus, message?: string) => {
        setStatus(next);
        setDetail(message ?? null);
        if (next === 'closed' || next === 'error') {
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
      const modelKey = modelKeys[provider];
      // The settings go over as written and are checked on arrival, where the
      // model is known: functions/api/session/_resolve.ts.
      const config = { instructions, settings };
      // Set before awaiting: the clock starts at the moment of connecting, so a
      // call nobody ever speaks into still times out.
      lastActivity.current = Date.now();
      session.current =
        provider === 'openai'
          ? await startOpenAiSession(handlers, modelKey, language, config)
          : await startGeminiSession(handlers, modelKey, language, config);
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

  /** Picking a preset replaces the prompt outright — that is what picking means. */
  const choosePreset = (key: string) => {
    setPresetKey(key);
    setEdited(false);
    setInstructions(renderPreset(key, language));
  };

  const writeInstructions = (text: string) => {
    setInstructions(text);
    // Typing it back to the preset's exact text puts it under tracking again.
    setEdited(text !== renderPreset(presetKey, language));
  };

  const resetInstructions = () => {
    setEdited(false);
    setInstructions(renderPreset(presetKey, language));
  };

  const busy = status === 'connecting';
  const live = status === 'live';
  // The Worker refuses an over-long prompt too; catching it here saves a round
  // trip and says so next to the button rather than in the status line.
  const tooLong = instructions.length > MAX_INSTRUCTIONS;
  const model = findModel(modelKeys[provider]) ?? visibleModels(provider)[0];

  // A reserved turn whose transcript never arrived holds its place in the
  // ordering but has nothing to draw.
  const spoken = turns.filter((turn) => turn.text);

  // Only after the call, and only if the provider actually reported something.
  const ended = status === 'closed' || status === 'error';
  const summary =
    ended && usage && billedModel && totalTokens(usage) > 0
      ? {
          usage,
          cost: estimateCost(billedModel, usage),
          truncated: status === 'error',
          // The relay leg is a property of the call that ran, so it is read off
          // the billed model for the same reason the rates are.
          relayed: billedModel.startsWith('gemini'),
        }
      : null;

  // Deployment id, not commit: retrying a build or changing a secret redeploys
  // the same commit, and those are exactly the redeploys worth telling apart.
  const buildTitle = [
    __BUILD_INFO__.deploy && `deployment ${__BUILD_INFO__.deploy}`,
    __BUILD_INFO__.commit && `commit ${__BUILD_INFO__.commit}`,
    __BUILD_INFO__.branch,
    `built ${__BUILD_INFO__.builtAt}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <span
        title={buildTitle}
        className="fixed right-3 top-3 z-50 rounded-md border border-slate-800 bg-slate-900/80 px-2 py-1 font-mono text-[11px] leading-none text-slate-500 backdrop-blur"
      >
        {__BUILD_INFO__.label}
      </span>
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">vocoTrial</h1>
        </header>

        <div className="flex gap-2">
          {PROVIDERS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setProvider(option.id)}
              disabled={live || busy}
              className={`flex-1 rounded-lg border px-4 py-2.5 text-sm font-medium transition disabled:opacity-40 ${
                provider === option.id
                  ? 'border-sky-500 bg-sky-500/10 text-sky-300'
                  : 'border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

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
            value={modelKeys[provider]}
            onChange={(event) =>
              setModelKeys((current) => ({ ...current, [provider]: event.target.value }))
            }
            disabled={live || busy}
            className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
          >
            {visibleModels(provider).map((model) => (
              <option key={model.key} value={model.key} className="bg-slate-900">
                {model.label}
                {model.unverified ? ' (unverified id)' : ''}
              </option>
            ))}
          </select>
        </label>

        <SettingsPanel
          model={model}
          disabled={live || busy}
          presetKey={presetKey}
          onPreset={choosePreset}
          instructions={instructions}
          onInstructions={writeInstructions}
          edited={edited}
          onResetInstructions={resetInstructions}
          settings={settings}
          onSettings={setSettings}
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

            <p className="mt-3 text-[11px] leading-relaxed text-slate-600">
              Provider-reported tokens at {RATES_VERIFIED_ON} list prices — an estimate, not
              your bill.
              {summary.relayed && ' Excludes the Cloudflare Worker time the relay bills.'}
              {summary.truncated && ' The call ended abnormally, so the final usage may be missing.'}
            </p>
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
