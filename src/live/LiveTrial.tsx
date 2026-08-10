import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Radio, SlidersHorizontal } from 'lucide-react';
import { startGeminiSession } from '../realtime/gemini';
import { findModel } from '../realtime/models';
import { LANGUAGES, defaultLanguageCode, findLanguage } from '../realtime/languages';
import { INSTRUCTION_PRESETS, defaultPresetKey, findPreset } from '../realtime/instructions';
import type { AudioTap, SessionStatus, TranscriptDelta, VoiceSession } from '../realtime/types';
import Stage from './Stage';
import { RevealQueue } from './reveal';
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

/** Its own key — this page's picks are not the comparison rig's picks. */
const PREFS_KEY = 'vocotrial.live.v1';

interface Prefs {
  language: string;
  presetKey: string;
}

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

  const session = useRef<VoiceSession | null>(null);
  /** Agent words waiting for the audio that carries them. See reveal.ts. */
  const queue = useRef(new RevealQueue());
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({ language, presetKey } satisfies Prefs));
    } catch {
      // Private browsing. Losing the pick is not worth an error.
    }
  }, [language, presetKey]);

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
          <a href="/" className="text-xs text-slate-500 underline-offset-4 hover:underline">
            comparison rig →
          </a>
        </header>

        <Stage agentText={agentText} userText={userText} tap={tap} speaking={speaking} />

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
