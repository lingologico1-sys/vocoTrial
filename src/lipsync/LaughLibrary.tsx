import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Trash2, Upload, Wand2 } from 'lucide-react';
import {
  audioUrl,
  deleteClip,
  fetchClip,
  importClip,
  listClips,
  renderClip,
  LipsyncError,
} from './library';
import { decodeFile, proposeBounds, toBase64, toWav } from './audioTrim';
import {
  LAUGH_KINDS,
  eligible,
  renderedVoices,
  type LaughLibraryIndex,
  type LaughKind,
} from './laughs';

/**
 * The laugh library: laughs you provide, and which voices have them.
 *
 * WHAT THIS PANEL IS ACTUALLY FOR. `[laughs]` and `[giggles]` are advisory on v3 and simply
 * ignored on multilingual v2, so the model's laugh is either a coin flip or impossible. The
 * fix is to supply the laugh yourself; the thing that makes it usable is that ElevenLabs
 * re-performs it in the target voice on the way in, so it is your performance and their
 * speaker. See src/lipsync/laughs.ts.
 *
 * TWO LISTS IN ONE, and the distinction is the point rather than an implementation detail
 * leaking. A laugh you provided belongs to no voice; a rendered clip belongs to exactly
 * one. So a row is a laugh, and the badges on it are the voices that have it — which makes
 * the answer to "why is my new voice not laughing" visible rather than something to work
 * out. Adopting a voice is a click per laugh, not a hunt for the original files.
 *
 * THE TRIM HAPPENS BEFORE ANYTHING IS SENT. The browser decodes the file, proposes bounds
 * around the sound, and uploads only the selection — see audioTrim.ts for why that has to
 * be here rather than in the Worker, which has no codec. It also means the conversion is
 * only ever charged for the part you meant.
 */

interface LaughLibraryProps {
  /** Which voice the loaded take used. Renders are offered for this voice only. */
  voiceId: string;
  voiceName?: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

const KIND_LABEL: Record<LaughKind, string> = {
  laughs: 'laugh — open mouth, eyes shut, head bobs',
  giggles: 'giggle — mouth shut, eyes open, small bob',
};

const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

export default function LaughLibrary({
  voiceId,
  voiceName,
  busy,
  setBusy,
}: LaughLibraryProps) {
  const [library, setLibrary] = useState<LaughLibraryIndex>({ sources: [], renders: [] });
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  // The file being imported, held decoded so the bounds can be nudged without re-reading it.
  const [picked, setPicked] = useState<{ name: string; buffer: AudioBuffer } | null>(null);
  const [fromMs, setFromMs] = useState(0);
  const [toMs, setToMs] = useState(0);
  const [kind, setKind] = useState<LaughKind>('laughs');
  const [label, setLabel] = useState('');
  const [denoise, setDenoise] = useState(true);

  /**
   * One <audio> for auditioning, made once and re-pointed.
   *
   * A fresh element per play would leave the previous clip running under the next, which on
   * a panel whose whole purpose is comparing similar sounds is worse than useless. The URL
   * it was last given is revoked when replaced — the same duty LipSync has for the take.
   */
  const player = useRef<HTMLAudioElement | null>(null);
  const playing = useRef<string | null>(null);

  useEffect(() => {
    void listClips().then(setLibrary).catch(() => undefined);
    return () => {
      if (playing.current) URL.revokeObjectURL(playing.current);
    };
  }, []);

  function play(base64: string, type: string) {
    if (playing.current) URL.revokeObjectURL(playing.current);
    const url = audioUrl(base64, type);
    playing.current = url;
    if (!player.current) player.current = new Audio();
    player.current.src = url;
    void player.current.play().catch(() => undefined);
  }

  async function audition(id: string, of: 'render' | 'source') {
    try {
      const { audioBase64, contentType } = await fetchClip(id, of);
      play(audioBase64, contentType);
    } catch {
      setProblem('Could not play that clip.');
    }
  }

  /** Decodes the picked file and offers bounds around whatever sound is in it. */
  async function take(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setNote(null);
    try {
      const buffer = await decodeFile(file);
      const bounds = proposeBounds(buffer);
      setPicked({ name: file.name, buffer });
      setFromMs(bounds.startMs);
      setToMs(bounds.endMs);
      if (!label.trim()) setLabel(file.name.replace(/\.[^.]+$/, ''));
    } catch {
      setProblem(`Could not read ${file.name}. Try a wav, mp3, m4a or ogg.`);
      setPicked(null);
    }
  }

  /** Plays only the selection, so the bounds can be judged before they are paid for. */
  function auditionSelection() {
    if (!picked) return;
    const wav = toWav(picked.buffer, fromMs, toMs);
    play(toBase64(wav), 'audio/wav');
  }

  async function keep() {
    if (!picked || !voiceId) return;
    setProblem(null);
    setNote(null);
    setBusy(true);
    setWorking('import');
    try {
      const wav = toWav(picked.buffer, fromMs, toMs);
      const { source, render, audioBase64 } = await importClip({
        audioBase64: toBase64(wav),
        kind,
        label: label.trim(),
        voiceId,
        voiceName,
        durationMs: toMs - fromMs,
        removeBackgroundNoise: denoise,
      });
      setLibrary((l) => ({
        sources: [source, ...l.sources],
        renders: [render, ...l.renders],
      }));
      setPicked(null);
      setLabel('');
      // Played immediately, unprompted. Whether the conversion did something strange to
      // the laugh is the one thing nobody can know in advance, and it should not need a
      // second click to find out.
      play(audioBase64, 'audio/mpeg');
      setNote(`Kept and converted — ${secs(render.durationMs)} in ${voiceName ?? 'this voice'}.`);
    } catch (error) {
      setProblem(
        error instanceof LipsyncError
          ? [error.message, error.detail].filter(Boolean).join(' — ')
          : 'Could not import that.',
      );
    } finally {
      setBusy(false);
      setWorking(null);
    }
  }

  async function renderFor(sourceId: string) {
    setProblem(null);
    setNote(null);
    setBusy(true);
    setWorking(sourceId);
    try {
      const { render, audioBase64 } = await renderClip({ sourceId, voiceId, voiceName });
      setLibrary((l) => ({ ...l, renders: [render, ...l.renders] }));
      play(audioBase64, 'audio/mpeg');
      setNote(`Rendered — ${secs(render.durationMs)} in ${voiceName ?? 'this voice'}.`);
    } catch (error) {
      setProblem(
        error instanceof LipsyncError ? error.message : 'Could not render that.',
      );
    } finally {
      setBusy(false);
      setWorking(null);
    }
  }

  async function drop(id: string, of: 'render' | 'source') {
    setBusy(true);
    try {
      await deleteClip(id, of);
      setLibrary((l) =>
        of === 'source'
          ? {
              sources: l.sources.filter((s) => s.id !== id),
              renders: l.renders.filter((r) => r.sourceId !== id),
            }
          : { ...l, renders: l.renders.filter((r) => r.id !== id) },
      );
    } catch {
      setProblem('Could not delete that.');
    } finally {
      setBusy(false);
    }
  }

  /** Which tags this voice can actually cover, which is what generate.ts will decide too. */
  const covered = useMemo(
    () =>
      new Set(
        voiceId
          ? LAUGH_KINDS.filter((k) => eligible(library.renders, k, voiceId).length > 0)
          : [],
      ),
    [library.renders, voiceId],
  );

  const span = toMs - fromMs;
  const missing = LAUGH_KINDS.filter((k) => !covered.has(k));

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-800 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-slate-200">Laughs</h2>
        <span className="text-xs text-slate-600">yours, in this voice</span>
      </div>

      <p className="text-[11px] leading-snug text-slate-600">
        ElevenLabs treats <span className="font-mono text-slate-500">[laughs]</span> and{' '}
        <span className="font-mono text-slate-500">[giggles]</span> as suggestions on v3 and
        ignores them entirely on multilingual v2. So bring your own: record a laugh however
        you want it performed, and it is converted into this voice on the way in. A kind
        with a clip for this voice is taken out of the prompt and spliced in at a length
        known before anything is synthesised.
      </p>

      {/* ---- the library ---- */}
      {library.sources.length + library.renders.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {library.sources.map((source) => {
            const voices = renderedVoices(library.renders, source.id);
            const here = library.renders.find(
              (r) => r.sourceId === source.id && r.voiceId === voiceId,
            );
            return (
              <div
                key={source.id}
                className="flex items-center gap-2 rounded-lg border border-slate-800 px-2.5 py-1.5"
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                    source.kind === 'laughs'
                      ? 'bg-amber-950/50 text-amber-400'
                      : 'bg-sky-950/50 text-sky-400'
                  }`}
                >
                  {source.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                  {source.label}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-slate-600">
                  {secs(here?.durationMs ?? source.durationMs)}
                </span>
                {/* The recording, for comparing against the conversion — the only way to
                    judge whether the voice changer treated the laugh well. */}
                <button
                  type="button"
                  onClick={() => void audition(source.id, 'source')}
                  title="Play the recording you provided"
                  className="shrink-0 rounded-md border border-slate-800 px-1.5 py-1 text-[10px] text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-300"
                >
                  raw
                </button>
                {here ? (
                  <button
                    type="button"
                    onClick={() => void audition(here.id, 'render')}
                    title={`Play it in ${voiceName ?? 'this voice'}`}
                    className="shrink-0 rounded-md border border-emerald-900 p-1 text-emerald-400 transition-colors hover:border-emerald-700"
                  >
                    <Play size={12} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void renderFor(source.id)}
                    disabled={busy || !voiceId}
                    title="Convert this laugh into the voice this page is using. Costs credits."
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-700"
                  >
                    {working === source.id ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Wand2 size={11} />
                    )}
                    render for this voice
                  </button>
                )}
                <span
                  className="shrink-0 font-mono text-[10px] text-slate-700"
                  title="How many voices this laugh has been rendered into"
                >
                  {voices.size}★
                </span>
                <button
                  type="button"
                  onClick={() => void drop(source.id, 'source')}
                  disabled={busy}
                  title="Delete this laugh and every voice it was rendered into. Lines already made with it are unaffected."
                  className="shrink-0 rounded-md border border-slate-800 p-1 text-slate-600 transition-colors hover:border-rose-900 hover:text-rose-400 disabled:cursor-not-allowed"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}

          {/* Renders with no recording behind them: the clips harvested by the previous
              version of this feature. They splice normally and cannot be carried to another
              voice, which is exactly what the row says. */}
          {library.renders
            .filter((r) => !r.sourceId)
            .map((render) => (
              <div
                key={render.id}
                className="flex items-center gap-2 rounded-lg border border-slate-900 px-2.5 py-1.5"
              >
                <span className="shrink-0 rounded bg-slate-800/60 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                  {render.kind}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                  {render.label}
                </span>
                <span className="shrink-0 text-[10px] text-slate-700">
                  cut from a take — no recording to re-render
                </span>
                <span className="shrink-0 font-mono text-[11px] text-slate-600">
                  {secs(render.durationMs)}
                </span>
                <button
                  type="button"
                  onClick={() => void audition(render.id, 'render')}
                  className="shrink-0 rounded-md border border-slate-800 p-1 text-slate-400 transition-colors hover:border-slate-600"
                >
                  <Play size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => void drop(render.id, 'render')}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-slate-800 p-1 text-slate-600 transition-colors hover:border-rose-900 hover:text-rose-400 disabled:cursor-not-allowed"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}

          <p className="text-[11px] text-slate-600">
            {!voiceId
              ? 'Generate a line to see which of these cover its voice.'
              : missing.length === 0
                ? 'Both tags are covered for this voice.'
                : `${missing.join(' and ')} has nothing for this voice yet.`}
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-500">
          Nothing here yet. Record a laugh — your own, however you want the face to laugh —
          and drop it in below.
        </p>
      )}

      <div className="h-px bg-slate-900" />

      {/* ---- import ---- */}
      <div className="flex flex-col gap-2.5">
        <span className="text-xs font-medium text-slate-400">Add a laugh</span>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-800 px-3 py-2 transition-colors hover:border-slate-700">
          <Upload size={16} className="shrink-0 text-slate-600" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-slate-300">
              {picked ? picked.name : 'Pick an audio file'}
            </div>
            <div className="text-[11px] text-slate-600">
              wav, mp3, m4a, ogg — trimmed here before anything is sent
            </div>
          </div>
          <input
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(event) => void take(event.target.files?.[0])}
          />
        </label>

        {picked && (
          <>
            <div className="flex flex-wrap items-end gap-2">
              {(['from', 'to'] as const).map((end) => (
                <label key={end} className="flex flex-col gap-1">
                  <span className="text-[11px] uppercase tracking-wide text-slate-600">
                    {end}
                  </span>
                  <input
                    type="number"
                    step={0.01}
                    min={0}
                    value={((end === 'from' ? fromMs : toMs) / 1000).toFixed(2)}
                    onChange={(event) => {
                      const ms = Math.max(0, Math.round(Number(event.target.value) * 1000));
                      if (end === 'from') setFromMs(ms);
                      else setToMs(ms);
                    }}
                    className="w-20 rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200"
                  />
                </label>
              ))}

              <button
                type="button"
                onClick={auditionSelection}
                title="Play just the selection, before it is converted"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-[11px] text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
              >
                <Play size={12} />
                hear selection
              </button>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-slate-600">Kind</span>
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as LaughKind)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
                >
                  {LAUGH_KINDS.map((k) => (
                    <option key={k} value={k}>{k}</option>
                  ))}
                </select>
              </label>

              <label className="flex min-w-[9rem] flex-1 flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-slate-600">Label</span>
                <input
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="warm, short"
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-700"
                />
              </label>

              <button
                type="button"
                onClick={() => void keep()}
                disabled={busy || span <= 0 || !voiceId}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-700"
              >
                {working === 'import' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Wand2 size={13} />
                )}
                Keep &amp; convert
              </button>
            </div>

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={denoise}
                onChange={(event) => setDenoise(event.target.checked)}
              />
              <span className="text-[11px] leading-snug text-slate-600">
                Strip background noise first. Near-essential on a phone recording, since the
                room otherwise gets rendered as breath — but it can soften the edges of a
                clean studio clip, which is the part carrying the laugh.
              </span>
            </label>

            <p className="text-[11px] text-slate-600">
              {span > 0 ? `${secs(span)} selected. ` : 'Nothing selected. '}
              {KIND_LABEL[kind]}.
              {!voiceId && ' Generate a line first, so there is a voice to convert into.'}
            </p>
          </>
        )}
      </div>

      {note && <p className="text-xs text-emerald-400">{note}</p>}
      {problem && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
          {problem}
        </p>
      )}
    </section>
  );
}
