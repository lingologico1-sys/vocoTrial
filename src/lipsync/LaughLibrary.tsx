import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Scissors, Trash2 } from 'lucide-react';
import { audioUrl, cutClip, deleteClip, fetchClip, listClips, LipsyncError } from './library';
import { LAUGH_KINDS, type LaughClip, type LaughKind } from './laughs';

/**
 * The laugh library, and the shears for filling it.
 *
 * WHY IT LIVES UNDER THE PLAYER rather than on a page of its own. A clip is cut out of a
 * take, and the moment anybody knows a take contains a laugh worth keeping is the moment
 * they have just listened to it. A separate library page would mean hearing a good laugh
 * here, navigating away, finding the line again, and scrubbing back to a sound already
 * heard — which is enough friction that the library would stay empty and the whole
 * mechanism would go unused.
 *
 * THE PLAYHEAD IS THE INSTRUMENT. There is no waveform, and drawing one would mean
 * decoding the audio in the browser to get samples this page otherwise never needs. What
 * a person actually does is play the line, hear the laugh start, and press a key — so the
 * two buttons take the time off the <audio> element that is already running, and the
 * numbers beside them are there to nudge what the ear got approximately right.
 *
 * The cut is refused until the take is saved, and that is not an ordering quirk. A clip
 * is cut server-side from the audio in R2 so that it is provably the same bytes as the
 * line it came from; an unsaved take exists only as a blob in this tab, and cutting from
 * that would mean uploading audio the server already has no way to vouch for.
 */

interface LaughLibraryProps {
  /** The saved line to cut from, or null when nothing on the page has been saved. */
  sourceId: string | null;
  sourceName: string | null;
  /** Which voice the loaded take used. Clips are only offered for their own voice. */
  voiceId: string;
  /** The player's clock, in seconds. The same getter SpeakingFace reads. */
  audioTime: () => number;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

const KIND_LABEL: Record<LaughKind, string> = {
  laughs: 'laugh — open mouth, eyes shut, head bobs',
  giggles: 'giggle — mouth shut, eyes open, small bob',
};

export default function LaughLibrary({
  sourceId,
  sourceName,
  voiceId,
  audioTime,
  busy,
  setBusy,
}: LaughLibraryProps) {
  const [clips, setClips] = useState<LaughClip[]>([]);
  const [kind, setKind] = useState<LaughKind>('laughs');
  const [label, setLabel] = useState('');
  const [fromMs, setFromMs] = useState(0);
  const [toMs, setToMs] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  /**
   * One <audio> for auditioning, made once and re-pointed.
   *
   * A fresh element per play would leave the previous clip running underneath the next,
   * which on a panel whose whole purpose is comparing similar sounds is worse than
   * useless. The URL it was last given is revoked when it is replaced — the same duty
   * LipSync has for the take itself.
   */
  const player = useRef<HTMLAudioElement | null>(null);
  const playing = useRef<string | null>(null);

  useEffect(() => {
    void listClips().then(setClips).catch(() => undefined);
    return () => {
      if (playing.current) URL.revokeObjectURL(playing.current);
    };
  }, []);

  // Only this voice's clips. A laugh from another voice is another person interrupting,
  // so it is not shown as though it were an option — see the note on LaughClip.voiceId.
  const mine = useMemo(
    () => clips.filter((c) => !voiceId || c.voiceId === voiceId),
    [clips, voiceId],
  );

  async function audition(id: string) {
    try {
      const { audioBase64 } = await fetchClip(id);
      if (playing.current) URL.revokeObjectURL(playing.current);
      const url = audioUrl(audioBase64);
      playing.current = url;
      if (!player.current) player.current = new Audio();
      player.current.src = url;
      await player.current.play();
    } catch {
      setProblem('Could not play that clip.');
    }
  }

  async function keep() {
    if (!sourceId) return;
    setProblem(null);
    setNote(null);
    setBusy(true);
    try {
      const { clip, cutFromMs, cutToMs } = await cutClip({
        sourceId,
        kind,
        startMs: fromMs,
        endMs: toMs,
        label: label.trim(),
      });
      setClips((list) => [clip, ...list]);
      setLabel('');
      // The times the cut actually landed on, not the ones asked for. They differ by up
      // to half a frame and saying so is cheaper than someone wondering why the clip is
      // 13ms longer than the selection.
      setNote(
        `Kept ${(clip.durationMs / 1000).toFixed(2)}s — ` +
          `${(cutFromMs / 1000).toFixed(2)}s to ${(cutToMs / 1000).toFixed(2)}s.`,
      );
    } catch (error) {
      setProblem(
        error instanceof LipsyncError
          ? [error.message, error.detail].filter(Boolean).join(' — ')
          : 'Could not keep that.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function drop(id: string) {
    setBusy(true);
    try {
      await deleteClip(id);
      setClips((list) => list.filter((c) => c.id !== id));
    } catch {
      setProblem('Could not delete that clip.');
    } finally {
      setBusy(false);
    }
  }

  const span = toMs - fromMs;
  const covered = new Set(mine.map((c) => c.kind));

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-800 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-slate-200">Laughs</h2>
        <span className="text-xs text-slate-600">
          ours, spliced in — not the model&rsquo;s
        </span>
      </div>

      <p className="text-[11px] leading-snug text-slate-600">
        ElevenLabs treats <span className="font-mono text-slate-500">[laughs]</span> and{' '}
        <span className="font-mono text-slate-500">[giggles]</span> as suggestions, so the
        same line laughs on one take and not the next. A kind with a clip kept for this
        voice is taken out of the prompt entirely and spliced in afterwards, at a length
        known before anything is synthesised. A kind with none is still asked of the model.
      </p>

      {mine.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {mine.map((clip) => (
            <div
              key={clip.id}
              className="flex items-center gap-2 rounded-lg border border-slate-800 px-2.5 py-1.5"
            >
              <button
                type="button"
                onClick={() => void audition(clip.id)}
                title="Play this clip"
                className="shrink-0 rounded-md border border-slate-800 p-1 text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
              >
                <Play size={12} />
              </button>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  clip.kind === 'laughs'
                    ? 'bg-amber-950/50 text-amber-400'
                    : 'bg-sky-950/50 text-sky-400'
                }`}
              >
                {clip.kind}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                {clip.label}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-slate-600">
                {(clip.durationMs / 1000).toFixed(2)}s
              </span>
              <button
                type="button"
                onClick={() => void drop(clip.id)}
                disabled={busy}
                title="Delete this clip. Lines already made with it are unaffected."
                className="shrink-0 rounded-md border border-slate-800 p-1 text-slate-600 transition-colors hover:border-rose-900 hover:text-rose-400 disabled:cursor-not-allowed"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {/* Which tags are actually covered, because that is the difference between a
              laugh that is guaranteed and one that is still a coin flip. */}
          <p className="text-[11px] text-slate-600">
            {LAUGH_KINDS.filter((k) => !covered.has(k)).length === 0
              ? 'Both tags are covered for this voice.'
              : `${LAUGH_KINDS.filter((k) => !covered.has(k)).join(' and ')} still goes to ElevenLabs — nothing kept for it yet.`}
          </p>
        </div>
      ) : (
        <p className="rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-500">
          Nothing kept for this voice yet, so both tags still go to ElevenLabs. Generate a
          line with a laugh in it — tick <em>let ElevenLabs try</em> in Compose once the
          library has filled up — then save it and cut the laugh out below.
        </p>
      )}

      <div className="h-px bg-slate-900" />

      {sourceId ? (
        <div className="flex flex-col gap-2.5">
          <span className="text-xs font-medium text-slate-400">
            Keep a laugh from &ldquo;{sourceName}&rdquo;
          </span>

          <div className="flex flex-wrap items-end gap-2">
            {(['from', 'to'] as const).map((end) => (
              <label key={end} className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-slate-600">
                  {end}
                </span>
                <div className="flex items-center gap-1">
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
                  <button
                    type="button"
                    onClick={() => {
                      const ms = Math.round(audioTime() * 1000);
                      if (end === 'from') setFromMs(ms);
                      else setToMs(ms);
                    }}
                    title="Take this from where the player is now"
                    className="rounded-md border border-slate-800 px-2 py-1.5 text-[11px] text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
                  >
                    playhead
                  </button>
                </div>
              </label>
            ))}

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

            <label className="flex min-w-[10rem] flex-1 flex-col gap-1">
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
              disabled={busy || span <= 0}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-700"
            >
              <Scissors size={13} />
              Keep
            </button>
          </div>

          {/* What the tag will do, and the selected length, side by side — the length is
              the number that decides whether a clip is worth keeping. */}
          <p className="text-[11px] text-slate-600">
            {span > 0 ? `${(span / 1000).toFixed(2)}s selected. ` : 'Nothing selected yet. '}
            {KIND_LABEL[kind]}.
          </p>
        </div>
      ) : (
        <p className="text-xs text-slate-600">
          Save a generated line and its laugh can be cut from here. A clip is taken from
          the stored audio rather than re-uploaded, so it is the same bytes that were
          approved.
        </p>
      )}

      {note && <p className="text-xs text-emerald-400">{note}</p>}
      {problem && (
        <p className="rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300">
          {problem}
        </p>
      )}
    </section>
  );
}
