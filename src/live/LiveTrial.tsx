import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Radio, SlidersHorizontal } from 'lucide-react';
import { startGeminiSession } from '../realtime/gemini';
import { findModel } from '../realtime/models';
import { LANGUAGES, defaultLanguageCode, findLanguage } from '../realtime/languages';
import { INSTRUCTION_PRESETS, defaultPresetKey, findPreset } from '../realtime/instructions';
import type { AudioTap, SessionStatus, TranscriptDelta, VoiceSession } from '../realtime/types';
import type { FaceKit } from '../facekit/kit';
import { activeKit } from '../facekit/store';
import Stage from './Stage';
import { RevealQueue } from './reveal';
import type { MouthDriver } from './visemes';
import { tailSentences } from './text';

/**
 * The live-model playground.
 *
 * Separate from App.tsx by design. That page is a comparison rig — two
 * providers, every knob exposed, everything held constant so the numbers mean
 * something. This one is fixed to a single model and spends its screen on the
 * character instead. Nothing here reaches back into it.
 */

/** The only model this page runs. It is the thing being tried out. */
const MODEL_KEY = 'gemini-flash-31';

/** As App.tsx: audio bills per second of connection, so a forgotten tab costs. */
const IDLE_TIMEOUT_MS = 90_000;
const IDLE_POLL_MS = 5_000;

/** How many sentences stay in the balloon. The rest are still in the log. */
const BUBBLE_SENTENCES = 2;

/**
 * Its own key — this page's picks are not the comparison rig's picks.
 *
 * Versioned so that changing a default can actually reach a browser that has
 * been here before. Saved picks beat defaults, which is right while you are
 * tuning and wrong the moment the tuning is settled and written into the code:
 * without the bump, the only people still seeing the old value are the ones who
 * used the page enough to have an opinion. Bump it when a default moves.
 */
const PREFS_KEY = 'vocotrial.live.v2';

interface Prefs {
  language: string;
  presetKey: string;
  driver: MouthDriver;
  lookaheadMs: number;
}

/**
 * The two ways of driving the mouth, side by side.
 *
 * Switchable while the call is running, because the difference between them is
 * tens of milliseconds of timing — far too small to hold in your head across a
 * reconnect, and obvious the moment you flip between them on the same sentence.
 */
const DRIVERS: Array<{ id: MouthDriver; label: string; hint: string }> = [
  {
    id: 'reactive',
    label: 'Reactive',
    hint: 'An AnalyserNode reads the audio as it plays. Simple, and blind to anything that has not happened yet, so the mouth trails the voice by roughly the width of its analysis window.',
  },
  {
    id: 'scheduled',
    label: 'Scheduled',
    hint: 'The audio is measured before it plays and read back on the clock. Costs nothing in latency and removes some, because a reading can be centred on the instant it describes — or taken from ahead of it.',
  },
];

/** Where animators traditionally place a mouth shape: a frame or two early. */
const MAX_LOOKAHEAD_MS = 150;

/**
 * Enough to lead the sound, once the drawing has been paid for.
 *
 * About 50ms of it buys back the mouth's own lag — the shape eases toward its
 * target with a 35ms time constant, the level attacks over 15ms, and a frame
 * lands whenever it lands. Spend only that and the mouth is merely on time.
 * The remaining 30ms is the anticipation: roughly the frame of lead an animator
 * would draw in by hand, and far inside the margin where a mouth ahead of its
 * voice goes unnoticed. Being early is cheap and being late is not — video
 * leading audio survives past 100ms, lagging is caught around 45ms.
 */
const DEFAULT_LOOKAHEAD_MS = 80;

function loadPrefs(): Partial<Prefs> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Partial<Prefs>) : {};
  } catch {
    return {};
  }
}

interface Turn {
  role: 'user' | 'agent';
  text: string;
  done: boolean;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  live: 'Live',
  closed: 'Call ended',
  error: 'Error',
};

export default function LiveTrial() {
  const [prefs] = useState(loadPrefs);
  const [language, setLanguage] = useState(prefs.language ?? defaultLanguageCode());
  const [presetKey, setPresetKey] = useState(prefs.presetKey ?? defaultPresetKey());
  // Scheduled by default: it is the better mouth, and reactive is kept beside
  // it as the thing to compare against rather than the thing to start from.
  const [driver, setDriver] = useState<MouthDriver>(prefs.driver ?? 'scheduled');
  const [lookaheadMs, setLookaheadMs] = useState(prefs.lookaheadMs ?? DEFAULT_LOOKAHEAD_MS);

  const [status, setStatus] = useState<SessionStatus>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [showLog, setShowLog] = useState(false);
  /**
   * The tap is state, not a ref: the mouth is a component that has to re-run
   * its animation loop when one appears, and a ref would not tell it.
   */
  const [tap, setTap] = useState<AudioTap | null>(null);

  /**
   * The artwork the face wears, authored at /facekit and picked there.
   *
   * Loaded once at mount and never watched for changes: a kit is swapped on the
   * other page, which the user reaches by a link that reloads this one. Polling
   * IndexedDB for a change that cannot happen while this page is open would be
   * work in exchange for nothing. Absent — no kit made, or the selected one
   * deleted — leaves the drawn placeholder in place rather than an empty head.
   */
  const [kit, setKit] = useState<FaceKit | null>(null);

  useEffect(() => {
    let live = true;
    activeKit()
      .then((found) => {
        if (live) setKit(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const session = useRef<VoiceSession | null>(null);
  /** Agent words waiting for the audio that carries them. See reveal.ts. */
  const queue = useRef(new RevealQueue());
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ language, presetKey, driver, lookaheadMs } satisfies Prefs),
      );
    } catch {
      // Private browsing. Losing the pick is not worth an error.
    }
  }, [language, presetKey, driver, lookaheadMs]);

  useEffect(() => () => session.current?.stop(), []);

  /** Extends the open turn for that role, or starts a new one. */
  const append = useCallback((role: 'user' | 'agent', text: string, done: boolean) => {
    if (!text && !done) return;
    setTurns((current) => {
      const tail = current.length - 1;
      if (tail >= 0 && current[tail].role === role && !current[tail].done) {
        const next = [...current];
        next[tail] = { ...next[tail], text: next[tail].text + text, done };
        return next;
      }
      return text ? [...current, { role, text, done }] : current;
    });
  }, []);

  const onTranscript = useCallback(
    (delta: TranscriptDelta) => {
      lastActivity.current = Date.now();

      // The user's own transcript lags their speech rather than leading it, so
      // there is nothing to hold it back for.
      if (delta.role === 'user') {
        append('user', delta.text, delta.done);
        return;
      }

      // A delta with no stamp has no better information than "now", which is
      // what -Infinity means to the queue: due on the next frame.
      queue.current.push({ text: delta.text, done: delta.done, at: delta.at ?? -Infinity });
    },
    [append],
  );

  /** Moves whatever has become audible out of the queue and onto the screen. */
  const flush = useCallback(
    (now: number) => {
      const due = queue.current.take(now);
      for (const item of due) append('agent', item.text, item.done);
    },
    [append],
  );

  useEffect(() => {
    if (status !== 'live') return;
    let frame = 0;

    const step = () => {
      // The session reports `live` from inside startGeminiSession and only hands
      // back its tap when that call returns, so for a moment there is a live
      // call and no clock. Wait it out rather than falling back to the wall
      // clock, which would dump the greeting on screen before it was spoken.
      // Nothing is lost by waiting: onStatus drains the queue when the call ends.
      if (tap) flush(tap.now());
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [status, tap, flush]);

  useEffect(() => {
    if (status !== 'live') return;

    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current < IDLE_TIMEOUT_MS) return;
      hangUp(`Ended automatically after ${IDLE_TIMEOUT_MS / 1000}s with no one talking`);
    }, IDLE_POLL_MS);

    return () => clearInterval(timer);
  }, [status]);

  const connect = async () => {
    setTurns([]);
    setDetail(null);
    setMuted(false);
    queue.current.discard();

    const preset = findPreset(presetKey) ?? INSTRUCTION_PRESETS[0];
    const choice = findLanguage(language) ?? LANGUAGES[0];

    const handlers = {
      onStatus: (next: SessionStatus, message?: string) => {
        setStatus(next);
        setDetail(message ?? null);
        if (next === 'closed' || next === 'error') {
          // Whatever was still queued was said, or was a word away from it.
          // Dropping it silently would lose the end of every conversation.
          for (const item of queue.current.drain()) append('agent', item.text, item.done);
          session.current = null;
          setTap(null);
          setSpeaking(false);
        }
      },
      onTranscript,
      onSpeaking: (next: boolean) => {
        lastActivity.current = Date.now();
        setSpeaking(next);
      },
      // Barge-in. The audio for anything still queued was thrown away unplayed,
      // so showing those words would put sentences on screen that were cut off
      // mid-breath and never spoken.
      onInterrupted: () => queue.current.discard(),
    };

    try {
      lastActivity.current = Date.now();
      const started = await startGeminiSession(handlers, MODEL_KEY, language, {
        instructions: preset.render(choice),
      });
      session.current = started;
      setTap(started.tap ?? null);
    } catch (error) {
      session.current = null;
      setTap(null);
      setStatus('error');
      setDetail(error instanceof Error ? error.message : 'Could not start the session');
    }
  };

  const hangUp = (reason?: string) => {
    session.current?.stop();
    session.current = null;
    // stop() drives onStatus('closed'), which clears detail — so say why after.
    if (reason) setDetail(reason);
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    session.current?.setMuted(next);
  };

  const live = status === 'live';
  const busy = status === 'connecting';

  const lastOf = (role: 'user' | 'agent') =>
    [...turns].reverse().find((turn) => turn.role === role)?.text ?? '';
  const agentText = tailSentences(lastOf('agent'), BUBBLE_SENTENCES);
  const userText = tailSentences(lastOf('user'), BUBBLE_SENTENCES);

  const model = findModel(MODEL_KEY);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col gap-5 px-5 py-8">
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">liveTrial</h1>
            <p className="text-xs text-slate-500">{model?.label ?? MODEL_KEY}</p>
          </div>
          <nav className="flex gap-4 text-xs text-slate-500">
            <a href="/facekit" className="underline-offset-4 hover:underline">
              {kit ? `faceKit · ${kit.name}` : 'faceKit'} →
            </a>
            <a href="/" className="underline-offset-4 hover:underline">
              comparison rig →
            </a>
          </nav>
        </header>

        <Stage
          agentText={agentText}
          userText={userText}
          tap={tap}
          driver={driver}
          lookaheadMs={lookaheadMs}
          kit={kit}
          speaking={speaking}
        />

        <fieldset className="rounded-lg border border-slate-800 px-3 pb-2.5 pt-1">
          <legend className="px-1 text-[11px] uppercase tracking-wide text-slate-500">
            Mouth driver
          </legend>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {DRIVERS.map((option) => (
              <label
                key={option.id}
                title={option.hint}
                className="flex cursor-help items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="radio"
                  name="driver"
                  checked={driver === option.id}
                  // Never disabled: switching mid-sentence is the comparison.
                  onChange={() => setDriver(option.id)}
                  className="accent-sky-500"
                />
                {option.label}
              </label>
            ))}

            {driver === 'scheduled' && (
              <label className="flex min-w-[13rem] flex-1 items-center gap-2 text-xs text-slate-500">
                Lookahead
                <input
                  type="range"
                  min={0}
                  max={MAX_LOOKAHEAD_MS}
                  step={10}
                  value={lookaheadMs}
                  onChange={(event) => setLookaheadMs(Number(event.target.value))}
                  className="flex-1 accent-sky-500"
                />
                <span className="w-14 text-right font-mono text-slate-300">{lookaheadMs}ms</span>
              </label>
            )}
          </div>
        </fieldset>

        <div className="flex items-center gap-3 rounded-lg border border-slate-800 px-4 py-2.5">
          <Radio
            size={16}
            className={
              live
                ? speaking
                  ? 'animate-pulse text-emerald-400'
                  : 'text-emerald-400'
                : status === 'error'
                  ? 'text-rose-400'
                  : 'text-slate-600'
            }
          />
          <span className="text-sm">{STATUS_LABEL[status]}</span>
          {detail && <span className="truncate text-sm text-slate-500">— {detail}</span>}
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-800 px-3 py-2">
            <span className="text-[11px] uppercase tracking-wide text-slate-500">Practising</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={live || busy}
              className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
            >
              {LANGUAGES.map((choice) => (
                <option key={choice.code} value={choice.code} className="bg-slate-900">
                  {choice.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-1 items-center gap-2 rounded-lg border border-slate-800 px-3 py-2">
            <SlidersHorizontal size={13} className="text-slate-500" />
            <select
              value={presetKey}
              onChange={(event) => setPresetKey(event.target.value)}
              disabled={live || busy}
              className="flex-1 bg-transparent text-sm text-slate-200 outline-none disabled:opacity-40"
            >
              {INSTRUCTION_PRESETS.map((preset) => (
                <option key={preset.key} value={preset.key} className="bg-slate-900">
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
        </div>

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
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-4 py-3 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
            >
              <Mic size={16} />
              {busy ? 'Connecting…' : 'Start call'}
            </button>
          )}
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowLog((open) => !open)}
            className="text-xs text-slate-500 underline-offset-4 hover:underline"
          >
            {showLog ? 'Hide' : 'Show'} full transcript ({turns.length})
          </button>
          {showLog && (
            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-slate-800 p-3">
              {turns.length === 0 && <p className="text-sm text-slate-600">Nothing said yet.</p>}
              {turns.map((turn, index) => (
                <div key={index} className={turn.role === 'user' ? 'text-right' : 'text-left'}>
                  <span
                    className={`inline-block max-w-[85%] rounded-xl px-3 py-1.5 text-sm ${
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
          )}
        </div>
      </div>
    </div>
  );
}
