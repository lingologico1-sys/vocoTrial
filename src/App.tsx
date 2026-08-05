import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Radio } from 'lucide-react';
import { startOpenAiSession } from './realtime/openai';
import { startGeminiSession } from './realtime/gemini';
import { defaultModelKey, visibleModels } from './realtime/models';
import type { Provider, SessionStatus, TranscriptDelta, VoiceSession } from './realtime/types';

interface Turn {
  role: 'user' | 'agent';
  text: string;
  /** Closed turns never take another delta, so a new one starts a new bubble. */
  done: boolean;
}

const PROVIDERS: Array<{ id: Provider; label: string }> = [
  { id: 'gemini', label: 'Gemini Live' },
  { id: 'openai', label: 'OpenAI Realtime' },
];

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
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  const session = useRef<VoiceSession | null>(null);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  // A live session holds the microphone, so it must not survive the component.
  useEffect(() => () => session.current?.stop(), []);

  const appendTranscript = useCallback((delta: TranscriptDelta) => {
    setTurns((current) => {
      const last = current[current.length - 1];

      if (delta.done) {
        if (last?.role === delta.role && !last.done) {
          return [...current.slice(0, -1), { ...last, done: true }];
        }
        return current;
      }

      if (!delta.text) return current;

      if (last?.role === delta.role && !last.done) {
        return [...current.slice(0, -1), { ...last, text: last.text + delta.text }];
      }
      return [...current, { role: delta.role, text: delta.text, done: false }];
    });
  }, []);

  const connect = async () => {
    setTurns([]);
    setDetail(null);
    setMuted(false);

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
      onSpeaking: setSpeaking,
    };

    try {
      const modelKey = modelKeys[provider];
      session.current =
        provider === 'openai'
          ? await startOpenAiSession(handlers, modelKey)
          : await startGeminiSession(handlers, modelKey);
    } catch (error) {
      session.current = null;
      setStatus('error');
      setDetail(error instanceof Error ? error.message : 'Could not start the session');
    }
  };

  const hangUp = () => {
    session.current?.stop();
    session.current = null;
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    session.current?.setMuted(next);
  };

  const busy = status === 'connecting';
  const live = status === 'live';

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
              </option>
            ))}
          </select>
        </label>

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
          {turns.length === 0 && (
            <p className="text-sm text-slate-600">
              Start the call and talk. The transcript appears here.
            </p>
          )}
          {turns.map((turn, index) => (
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
                onClick={hangUp}
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
      </div>
    </div>
  );
}
