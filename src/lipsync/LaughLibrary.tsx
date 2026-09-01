import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Play, Trash2, Upload, Wand2 } from 'lucide-react';
import {
  audioUrl,
  addOriginalClip,
  deleteClip,
  fetchClip,
  importClip,
  listClips,
  preferClip,
  renderClip,
  LipsyncError,
} from './library';
import {
  decodeFile,
  levelOf,
  peakOf,
  proposeBounds,
  toBase64,
  toMp3,
  toWav,
} from './audioTrim';
import {
  eligible,
  originalFor,
  preferredFor,
  renderedVoices,
  treatmentOf,
  type ReactionLibraryIndex,
  type ReactionClipKind,
  type ClipTreatment,
  type VoiceGender,
} from './laughs';
import { ARC_MIN_MS, REACTION_CLIP_KINDS, tagForKind } from './tags';

/**
 * The laugh library: laughs you provide, and which voices have them.
 *
 * WHAT THIS PANEL IS ACTUALLY FOR. `[laughs]` and `[giggles]` are advisory on v3 and simply
 * ignored on multilingual v2, so the model's laugh is either a coin flip or impossible. The
 * fix is to supply the laugh yourself. Its original performance is usable by every voice
 * in the same gender pool; an optional conversion belongs to one exact voice.
 *
 * TWO LISTS IN ONE, and the distinction is the point rather than an implementation detail
 * leaking. A source belongs to one gender pool; a converted clip belongs to exactly one
 * voice. So a row is a laugh, and the badges on it are the voices that have it — which makes
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
  voiceGender?: VoiceGender;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

/**
 * What the face will actually do with a clip filed under each kind.
 *
 * Written from the poses in tags.ts rather than from what the word means, because the
 * import form is the one moment somebody chooses a kind and the cost of choosing wrong is
 * paid silently afterwards — a yawn filed under `gasps` snaps open and stays open, and
 * nothing later says so. Naming the pose here is what makes that visible while it is still
 * a dropdown rather than a take.
 */
const KIND_LABEL: Record<ReactionClipKind, string> = {
  laughs: 'laugh — open mouth, eyes shut, head bobs',
  giggles: 'giggle — mouth shut, eyes open, small bob',
  yawn: 'yawn — opens and closes slowly, eyes shut',
  sighs: 'sigh — lips part and trail shut, blink',
  gasps: 'gasp — snaps open and stays open',
  'clears throat': 'clears throat — lips parted, over quickly',
  gulps: 'gulp — lips stay shut throughout',
  sniffs: 'sniff — lips compressed, blink',
};

/** The two families the picker groups by, so eight options read as a choice not a list. */
const KIND_GROUPS: Array<{ label: string; kinds: ReactionClipKind[] }> = [
  { label: 'Laughter', kinds: ['laughs', 'giggles'] },
  { label: 'Breath and throat', kinds: ['yawn', 'sighs', 'gasps', 'clears throat', 'gulps', 'sniffs'] },
];

/**
 * A colour per kind, so a row is identifiable before its label is read.
 *
 * Laughter keeps the amber it had. The breath and throat sounds share a cooler range,
 * which carries the same split the picker groups by without needing a second badge.
 */
const KIND_STYLE: Record<ReactionClipKind, string> = {
  laughs: 'bg-amber-950/50 text-amber-400',
  giggles: 'bg-orange-950/50 text-orange-400',
  yawn: 'bg-violet-950/50 text-violet-400',
  sighs: 'bg-sky-950/50 text-sky-400',
  gasps: 'bg-rose-950/50 text-rose-400',
  'clears throat': 'bg-teal-950/50 text-teal-400',
  gulps: 'bg-slate-800 text-slate-400',
  sniffs: 'bg-emerald-950/50 text-emerald-400',
};

/**
 * How long a clip of this kind usually wants to be, as guidance in the trim panel.
 *
 * Targets to aim at, not bounds — MIN_CLIP_MS and MAX_CLIP_MS server-side are the only
 * things that refuse anything. Worth showing because the useful range differs by an order
 * of magnitude across these eight, and a 3s gulp is a mistake nothing else would catch.
 */
const KIND_TARGET_MS: Record<ReactionClipKind, [number, number]> = {
  laughs: [600, 3000],
  giggles: [400, 2000],
  yawn: [1200, 3500],
  sighs: [600, 1800],
  gasps: [250, 800],
  'clears throat': [400, 1200],
  gulps: [150, 500],
  sniffs: [150, 650],
};

const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

export default function LaughLibrary({
  voiceId,
  voiceName,
  voiceGender,
  busy,
  setBusy,
}: LaughLibraryProps) {
  const [library, setLibrary] = useState<ReactionLibraryIndex>({ sources: [], renders: [] });
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  // The file being imported, held decoded so the bounds can be nudged without re-reading it.
  const [picked, setPicked] = useState<{ name: string; buffer: AudioBuffer } | null>(null);
  const [fromMs, setFromMs] = useState(0);
  const [toMs, setToMs] = useState(0);
  const [kind, setKind] = useState<ReactionClipKind>('laughs');
  const [label, setLabel] = useState('');
  /**
   * Noise removal, defaulted from the kind rather than always on.
   *
   * On a laugh it takes the room off a phone recording and is close to essential. On a
   * breath sound the isolation model is being asked to strip everything that is not
   * speech, and a sniff *is* not speech — it can remove the clip rather than clean it.
   * See `denoise` in the tag table, which is where the per-kind answer lives.
   */
  const [denoise, setDenoise] = useState(tagForKind('laughs')?.denoise ?? true);
  const [gender, setGender] = useState<VoiceGender | undefined>(voiceGender);
  const [alsoConvert, setAlsoConvert] = useState(false);

  useEffect(() => {
    if (voiceGender) setGender(voiceGender);
  }, [voiceGender]);

  // Follows the kind, and is still a checkbox: the default is what this sound usually
  // wants, not a rule about it. Somebody importing a sniff recorded in a noisy room
  // should be able to turn it on, having heard the room.
  useEffect(() => {
    setDenoise(tagForKind(kind)?.denoise ?? true);
  }, [kind]);

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
    if (!picked || !gender) return;
    setProblem(null);
    setNote(null);
    setBusy(true);
    setWorking('import');
    try {
      const wav = toWav(picked.buffer, fromMs, toMs);
      const mp3 = await toMp3(picked.buffer, fromMs, toMs);
      const { source, original, converted, render, conversionError, audioBase64 } =
        await importClip({
          audioBase64: toBase64(wav),
          rawMp3Base64: toBase64(mp3),
          kind,
          gender,
          label: label.trim(),
          voiceId,
          voiceName,
          voiceGender,
          convert: alsoConvert,
          durationMs: toMs - fromMs,
          removeBackgroundNoise: denoise,
        });
      setLibrary((l) => ({
        sources: [source, ...l.sources],
        renders: [original, ...(converted ? [converted] : []), ...l.renders],
      }));
      setPicked(null);
      setLabel('');
      // Played immediately, unprompted. Whether the conversion did something strange to
      // the laugh is the one thing nobody can know in advance, and it should not need a
      // second click to find out.
      play(audioBase64, 'audio/mpeg');
      setNote(
        conversionError
          ? `Kept as recorded. Conversion failed: ${conversionError.error}`
          : converted
            ? `Kept both versions — playing ${secs(render.durationMs)} in ${voiceName ?? 'this voice'}.`
            : `Kept as recorded — ${secs(render.durationMs)} in the ${gender} pool.`,
      );
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
    if (!voiceGender) return;
    setProblem(null);
    setNote(null);
    setBusy(true);
    setWorking(sourceId);
    try {
      const { render, audioBase64 } = await renderClip({
        sourceId,
        voiceId,
        voiceName,
        voiceGender,
      });
      setLibrary((l) => ({
        sources: l.sources.map((source) =>
          source.id === sourceId
            ? {
                ...source,
                preferredTreatmentByVoice: {
                  ...(source.preferredTreatmentByVoice ?? {}),
                  [voiceId]: 'voice-converted',
                },
              }
            : source,
        ),
        renders: [render, ...l.renders],
      }));
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

  async function choose(sourceId: string, treatment: ClipTreatment) {
    if (!voiceId || !voiceGender) return;
    setBusy(true);
    setProblem(null);
    try {
      const { source } = await preferClip({ sourceId, voiceId, voiceGender, treatment });
      setLibrary((current) => ({
        ...current,
        sources: current.sources.map((entry) => (entry.id === source.id ? source : entry)),
      }));
    } catch (error) {
      setProblem(error instanceof LipsyncError ? error.message : 'Could not choose that version.');
    } finally {
      setBusy(false);
    }
  }

  async function makeOriginal(sourceId: string, sourceGender: VoiceGender) {
    setBusy(true);
    setWorking(`original:${sourceId}`);
    setProblem(null);
    try {
      const source = library.sources.find((entry) => entry.id === sourceId);
      if (!source) return;
      const { audioBase64 } = await fetchClip(sourceId, 'source');
      const bytes = Uint8Array.from(atob(audioBase64), (character) => character.charCodeAt(0));
      const file = new File([bytes], `${source.label}.wav`, { type: 'audio/wav' });
      const buffer = await decodeFile(file);
      const rawMp3Base64 = toBase64(await toMp3(buffer, 0, buffer.duration * 1000));
      const { render } = await addOriginalClip({ sourceId, gender: sourceGender, rawMp3Base64 });
      setLibrary((current) => ({
        sources: current.sources.map((entry) =>
          entry.id === sourceId ? { ...entry, gender: sourceGender } : entry,
        ),
        renders: [render, ...current.renders],
      }));
      setNote(`Original performance added to the ${sourceGender} pool.`);
    } catch (error) {
      setProblem(error instanceof LipsyncError ? error.message : 'Could not make an original clip.');
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
          ? REACTION_CLIP_KINDS.filter((k) => eligible(library, k, voiceId, voiceGender).length > 0)
          : [],
      ),
    [library, voiceId, voiceGender],
  );

  const span = toMs - fromMs;
  const missing = REACTION_CLIP_KINDS.filter((k) => !covered.has(k));
  // What a conversion would be doing for this kind, shown next to the option so that
  // "why is the original selected" has an answer where the choice is made.
  const prefers = preferredFor(kind);

  /**
   * How this selection sits against generated speech, and whether it is near clipping.
   *
   * Shown and not acted on. See levelOf in audioTrim.ts for why normalising these
   * automatically would destroy the sounds it moved furthest — a sniff is quiet because a
   * sniff is quiet, and matching it to the line makes it something else.
   */
  const level = useMemo(
    () => (picked && span > 0 ? levelOf(picked.buffer, fromMs, toMs) : null),
    [picked, fromMs, toMs, span],
  );
  const peak = useMemo(
    () => (picked && span > 0 ? peakOf(picked.buffer, fromMs, toMs) : 0),
    [picked, fromMs, toMs, span],
  );
  // Opposite-gender sources have no useful action for this voice: they cannot be used raw
  // and the server will not convert them across pools. Unknown legacy sources remain so
  // they can be classified and given an original derivative.
  const visibleSources = voiceGender
    ? library.sources.filter((source) => !source.gender || source.gender === voiceGender)
    : library.sources;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-800 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-slate-200">Reaction clips</h2>
        <span className="text-xs text-slate-600">
          {voiceGender ? `${voiceGender} pool` : 'male and female pools'}
        </span>
      </div>

      <p className="text-[11px] leading-snug text-slate-600">
        ElevenLabs treats reaction tags as suggestions on v3 and ignores them entirely on
        multilingual v2 — where every tag is stripped before synthesis, so an unrecorded
        one makes no sound at all. On that model a clip is not an improvement on the
        model&rsquo;s attempt; it is the only way these exist, which is why it is worth
        recording all {REACTION_CLIP_KINDS.length}.
      </p>
      <p className="text-[11px] leading-snug text-slate-600">
        Bring your own performance and keep it as recorded, or optionally convert it into a
        matching-gender voice. Original clips are shared with every voice in their male or
        female pool; conversions belong to one exact voice.
      </p>

      {/* ---- the library ---- */}
      {visibleSources.length + library.renders.filter(
        (render) => !render.sourceId && (!voiceId || render.voiceId === voiceId),
      ).length > 0 ? (
        <div className="flex flex-col gap-1.5">
          {visibleSources.map((source) => {
            const voices = renderedVoices(library.renders, source.id);
            const original = originalFor(library.renders, source.id);
            const here = library.renders.find(
              (render) =>
                render.sourceId === source.id &&
                treatmentOf(render) === 'voice-converted' &&
                render.voiceId === voiceId,
            );
            const preferred = source.preferredTreatmentByVoice?.[voiceId];
            const active: ClipTreatment = preferred === 'original' && original
              ? 'original'
              : here
                ? 'voice-converted'
                : 'original';
            // The play button beside the treatment toggle auditions what this voice will
            // actually use. Keeping it pointed at `here` made both toggle positions sound
            // voice-converted even though the saved preference (and generation) changed.
            const activeRender = active === 'original' ? original : here;
            return (
              <div
                key={source.id}
                className="flex items-center gap-2 rounded-lg border border-slate-800 px-2.5 py-1.5"
              >
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${
                    KIND_STYLE[source.kind] ?? 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {source.kind}
                </span>
                <span className="shrink-0 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] capitalize text-slate-500">
                  {source.gender ?? 'unclassified'}
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
                {original ? (
                  <button
                    type="button"
                    onClick={() => void audition(original.id, 'render')}
                    title="Play the splice-ready original performance"
                    className={`shrink-0 rounded-md border px-1.5 py-1 text-[10px] transition-colors ${
                      active === 'original'
                        ? 'border-sky-800 text-sky-300'
                        : 'border-slate-800 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    original
                  </button>
                ) : voiceGender ? (
                  <button
                    type="button"
                    onClick={() => void makeOriginal(source.id, source.gender ?? voiceGender)}
                    disabled={busy}
                    title="Encode the retained recording without re-performing it"
                    className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-700 px-2 py-1 text-[10px] text-slate-300 disabled:text-slate-700"
                  >
                    {working === `original:${source.id}` && (
                      <Loader2 size={11} className="animate-spin" />
                    )}
                    make original
                  </button>
                ) : null}
                {here ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void audition((activeRender ?? here).id, 'render')}
                      title={
                        active === 'original'
                          ? 'Play the selected original performance'
                          : `Play the selected version in ${voiceName ?? 'this voice'}`
                      }
                      className={`rounded-md border p-1 transition-colors ${
                        active === 'voice-converted'
                          ? 'border-emerald-700 text-emerald-300'
                          : 'border-emerald-900 text-emerald-500'
                      }`}
                    >
                      <Play size={12} />
                    </button>
                    {original && voiceGender && (
                      <button
                        type="button"
                        onClick={() => void choose(
                          source.id,
                          active === 'original' ? 'voice-converted' : 'original',
                        )}
                        disabled={busy}
                        title="Choose which version this voice uses"
                        className="rounded-md border border-slate-800 px-1.5 py-1 text-[10px] text-slate-400 disabled:text-slate-700"
                      >
                        use {active === 'original' ? 'voice' : 'original'}
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => void renderFor(source.id)}
                    disabled={
                      busy ||
                      !voiceId ||
                      !voiceGender ||
                      !source.gender ||
                      source.gender !== voiceGender
                    }
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
            .filter((r) => !r.sourceId && (!voiceId || r.voiceId === voiceId))
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

              {/* Against generated speech, because that is what it will be spliced into.
                  A number rather than a correction: see levelOf. */}
              {level !== null && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[11px] uppercase tracking-wide text-slate-600">
                    Level
                  </span>
                  <span className="font-mono text-xs text-slate-300">
                    {level >= 0 ? '+' : ''}
                    {level.toFixed(1)} dB
                    <span className="ml-1 font-sans text-[11px] text-slate-600">
                      vs speech
                    </span>
                  </span>
                  <span className="text-[11px] leading-snug text-slate-600">
                    {Math.abs(level) < 4
                      ? 'About the level of the line it will sit in.'
                      : level < 0
                        ? 'Quieter than the line. Right for a sniff or a gulp; check it is not simply a distant recording.'
                        : 'Louder than the line. Right for a gasp; worth a listen for anything else.'}
                  </span>
                  {peak > 0.99 && (
                    <span className="text-[11px] leading-snug text-amber-500">
                      Peaks at full scale — this may already be clipped in the source.
                    </span>
                  )}
                </div>
              )}

              <label className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-slate-600">Kind</span>
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as ReactionClipKind)}
                  className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
                >
                  {KIND_GROUPS.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.kinds.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                <span className="text-[11px] leading-snug text-slate-600">
                  {KIND_LABEL[kind]}
                </span>
                <span className="text-[11px] leading-snug text-slate-600">
                  Usually {(KIND_TARGET_MS[kind][0] / 1000).toFixed(2)}–
                  {(KIND_TARGET_MS[kind][1] / 1000).toFixed(2)}s. A target, not a limit.
                </span>
                {/* Both of these are properties of the format rather than mistakes, so
                    they are said here and not enforced anywhere. */}
                {tagForKind(kind)?.perform === 'arc' && span > 0 && span < ARC_MIN_MS && (
                  <span className="text-[11px] leading-snug text-amber-500">
                    Under {ARC_MIN_MS}ms this holds one shape instead of opening and
                    closing, which is most of what makes a {kind} recognisable.
                  </span>
                )}
                {span > 0 && span < 250 && (
                  <span className="text-[11px] leading-snug text-slate-600">
                    Short clips are placed less precisely: a cut lands on a 26ms frame
                    boundary, so this one can sit up to 13ms either way.
                  </span>
                )}
              </label>

              <fieldset className="flex flex-col gap-1">
                <legend className="text-[11px] uppercase tracking-wide text-slate-600">
                  Gender pool
                </legend>
                <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5">
                  {(['female', 'male'] as const).map((option) => (
                    <label
                      key={option}
                      className={`cursor-pointer rounded-md px-2 py-1 text-[10px] capitalize ${
                        gender === option ? 'bg-slate-700 text-slate-100' : 'text-slate-500'
                      }`}
                    >
                      <input
                        type="radio"
                        name="laugh-gender"
                        checked={gender === option}
                        onChange={() => {
                          setGender(option);
                          if (voiceGender && voiceGender !== option) setAlsoConvert(false);
                        }}
                        className="sr-only"
                      />
                      {option}
                    </label>
                  ))}
                </div>
              </fieldset>

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
                disabled={
                  busy ||
                  span <= 0 ||
                  !gender ||
                  (alsoConvert && (!voiceId || !voiceGender || gender !== voiceGender))
                }
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-700"
              >
                {working === 'import' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Wand2 size={13} />
                )}
                Keep {alsoConvert ? 'both' : 'as recorded'}
              </button>
            </div>

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={alsoConvert}
                disabled={!voiceId || !voiceGender || !gender || voiceGender !== gender}
                onChange={(event) => setAlsoConvert(event.target.checked)}
              />
              <span className="text-[11px] leading-snug text-slate-600">
                Also convert into {voiceName || 'the current voice'}. This spends credits
                and is available only when the recording and voice use the same gender pool.
                {prefers === 'original' && (
                  <>
                    {' '}
                    A <span className="font-mono text-slate-500">{kind}</span> plays the
                    recording by default even once converted — speech-to-speech has little
                    to work with in an unvoiced sound. Convert to audition it; the choice is
                    per voice and reversible.
                  </>
                )}
              </span>
            </label>

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={denoise}
                disabled={!alsoConvert}
                onChange={(event) => setDenoise(event.target.checked)}
              />
              <span
                className={`text-[11px] leading-snug ${
                  alsoConvert ? 'text-slate-600' : 'text-slate-700'
                }`}
              >
                Strip background noise before voice conversion. Near-essential on a phone
                recording of a laugh, since the room otherwise gets rendered as breath — but
                it softens edges, and on a sigh, a gasp or a sniff those edges are the whole
                sound. Defaulted per kind for that reason; off does not mean wrong.
              </span>
            </label>

            <p className="text-[11px] text-slate-600">
              {span > 0 ? `${secs(span)} selected. ` : 'Nothing selected. '}
              {KIND_LABEL[kind]}.
              {!gender && ' Choose its gender pool.'}
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
