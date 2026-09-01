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
  relevelClip,
  renderClip,
  LipsyncError,
} from './library';
import {
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  decodeFile,
  gainFromDb,
  headroomDb,
  levelOf,
  peakOf,
  proposeBounds,
  suggestedGainDb,
  toBase64,
  toMp3,
  toWav,
} from './audioTrim';
import {
  chosenFor,
  eligible,
  originalFor,
  renderedVoices,
  treatmentOf,
  type ReactionLibraryIndex,
  type ReactionRender,
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
  /**
   * Whether to re-perform the clip in the current voice on the way in.
   *
   * ON BY DEFAULT, which it was not. Converting costs single-digit credits for a clip this
   * short, and matching the tutor is worth more than that — so the default is now the thing
   * you almost always want, and the checkbox is for the case where you deliberately want
   * the recording kept as made. It also puts both treatments in the library at once, which
   * is what makes the row's A/B worth having.
   */
  const [alsoConvert, setAlsoConvert] = useState(true);
  /**
   * How much the clip is lifted or cut before encoding, in dB.
   *
   * Held as an author's choice rather than derived on the fly, because the moment they
   * touch the slider it stops being a suggestion — and a value that silently re-derived
   * itself when the trim moved would drag their setting back under them.
   */
  const [gainDb, setGainDb] = useState(0);
  /** True until the slider is touched, so the suggestion may keep following the clip. */
  const [gainAuto, setGainAuto] = useState(true);

  /**
   * Whether a conversion is possible at all right now.
   *
   * SEPARATE FROM WANTING ONE, and keeping them apart is what lets the checkbox default to
   * on. A wish that cannot be granted must not block the import: with one flag doing both
   * jobs, defaulting it to true would have disabled the Keep button for anybody who had not
   * chosen a voice yet, which is a worse first run than the one this replaced.
   */
  const canConvert = Boolean(voiceId && voiceGender && gender && voiceGender === gender);
  /** What will actually happen, which is the wish and the possibility together. */
  const willConvert = alsoConvert && canConvert;

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
      const mp3 = await toMp3(picked.buffer, fromMs, toMs, gainFromDb(gainDb));
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
          convert: willConvert,
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

  /**
   * Nudge one stored clip's level, by re-encoding it.
   *
   * DECODES WHAT IS STORED RATHER THAN THE SOURCE WAV, and does so for both treatments,
   * because only one of them has a WAV behind it: a conversion is bytes ElevenLabs
   * returned and nothing else. Re-encoding an MP3 is lossy a second time, which is worth
   * knowing and is still cheaper than paying for the same performance twice.
   *
   * A step rather than a slider on the row. Judging loudness here means playing the clip,
   * hearing the line in your head and adjusting — which is a nudge-and-listen loop, not a
   * drag. The import panel is where a continuous control makes sense, because the waveform
   * is in front of you.
   */
  async function nudgeLevel(render: ReactionRender, byDb: number) {
    setProblem(null);
    setNote(null);
    setWorking(`level:${render.id}`);
    setBusy(true);
    try {
      const { audioBase64, contentType } = await fetchClip(render.id, 'render');
      const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
      const buffer = await decodeFile(
        new File([bytes], 'clip.mp3', { type: contentType || 'audio/mpeg' }),
      );

      // MEASURED BEFORE ANYTHING IS ENCODED, because a lift past full scale is clamped
      // rather than refused, and a clamped lift is silent in both senses: nothing sounds
      // louder and nothing says why. See headroomDb.
      const span = buffer.duration * 1000;
      const room = headroomDb(buffer, 0, span);
      let applied = byDb;
      if (byDb > 0) {
        if (room < 0.5) {
          setProblem(
            `"${render.label}" is already at full scale, so it cannot be made louder — ` +
              'a lift would only flatten its peaks. Cut the others instead, or re-import ' +
              'the recording at a lower level.',
          );
          return;
        }
        applied = Math.min(byDb, room);
      }

      const encoded = await toMp3(buffer, 0, span, gainFromDb(applied));
      const { render: updated } = await relevelClip({
        renderId: render.id,
        rawMp3Base64: toBase64(encoded),
        gainDb: (render.gainDb ?? 0) + applied,
      });
      setLibrary(await listClips());

      const at = updated.gainDb ?? 0;
      setNote(
        `"${updated.label}" ${applied > 0 ? 'up' : 'down'} ${Math.abs(applied).toFixed(1)} dB` +
          ` — now ${at > 0 ? '+' : ''}${at.toFixed(1)} dB from as recorded.` +
          (applied < byDb
            ? ` Only ${applied.toFixed(1)} of the ${byDb} fitted before clipping.`
            : '') +
          ' Press play to hear it.',
      );
    } catch (error) {
      setProblem(
        error instanceof LipsyncError ? error.message : 'Could not re-encode that clip.',
      );
    } finally {
      setWorking(null);
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
  /** Where this kind belongs, and the lift that would put this clip there. */
  const target = tagForKind(kind)?.levelDb;
  /**
   * How much lift this selection has room for before it clips.
   *
   * The suggestion is capped by it, because a slider that opens above the ceiling is
   * showing a level the encode cannot produce — toMp3 clamps, and the readout would then
   * be a promise about loudness that the bytes do not keep.
   */
  const room = useMemo(
    () => (picked && span > 0 ? headroomDb(picked.buffer, fromMs, toMs) : MAX_GAIN_DB),
    [picked, fromMs, toMs, span],
  );
  const suggested = useMemo(
    () => Math.min(suggestedGainDb(level, target), room),
    [level, target, room],
  );

  // The suggestion follows the kind and the trim until somebody overrules it, and then
  // stops. Re-deriving after that would take the slider back off them mid-adjustment.
  useEffect(() => {
    if (gainAuto) setGainDb(suggested);
  }, [suggested, gainAuto]);

  // A new file is a new decision, so the suggestion is back in charge.
  useEffect(() => {
    setGainAuto(true);
  }, [picked]);
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
            // ASKED, NOT RE-DERIVED. This row used to work out the answer itself with a
            // rule of its own, which was right until the per-kind default arrived and then
            // silently was not: a sniff with both treatments played its conversion here,
            // labelled the toggle from that, and spliced the recording. chosenFor is what
            // generate.ts resolves through, so the panel cannot disagree with the take.
            const activeRender = chosenFor(library, source, voiceId);
            const active: ClipTreatment = activeRender
              ? treatmentOf(activeRender)
              : 'original';
            // The treatment that will NOT be spliced, when there is one. This is what the
            // compare button plays, and its absence is why a row with a single treatment
            // shows no compare button rather than one that duplicates ▶.
            const other = active === 'original' ? here : original;
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
                {/* The length of what will actually be spliced. It read `here` before,
                    so a row set to its original still showed the conversion's duration —
                    and duration is the one number on this row that changes the take. */}
                <span className="shrink-0 font-mono text-[11px] text-slate-600">
                  {secs(activeRender?.durationMs ?? source.durationMs)}
                </span>
                {/* THE OTHER ONE, whichever that is — never a second way to play what ▶
                    already plays.

                    `raw` and `original` used to sit here together, and they are the same
                    performance: the WAV you trimmed, and that same selection LAME-encoded
                    to splice format. Nobody can hear the difference at 128kbps mono, and
                    ▶ played the identical bytes again whenever the recording was active —
                    which the six new kinds made the common case rather than a rare one.
                    Three buttons for one sound.

                    So this is the A/B instead: ▶ is what will be spliced, and this is the
                    treatment that will not be. On a row with only one treatment there is
                    nothing to compare against and it does not appear at all. */}
                {other && (
                  <button
                    type="button"
                    onClick={() => void audition(other.id, 'render')}
                    title={
                      active === 'original'
                        ? `Play the conversion for ${voiceName ?? 'this voice'}, which is NOT what will be spliced. Use it to judge whether the voice changer did better than the recording.`
                        : 'Play the recording as provided, which is NOT what will be spliced. Use it to judge whether the conversion kept what made the sound work.'
                    }
                    className="shrink-0 rounded-md border border-slate-800 px-1.5 py-1 text-[10px] text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-300"
                  >
                    hear {active === 'original' ? 'conversion' : 'recording'}
                  </button>
                )}
                {/* Only where there is no encoded original to play yet: a legacy source
                    kept before original-performance clips existed. Then the WAV really is
                    the only way to hear what was uploaded, and it is not duplicating
                    anything. */}
                {!original && (
                  <button
                    type="button"
                    onClick={() => void audition(source.id, 'source')}
                    title="Play the recording you provided. This source has no splice-ready encode yet."
                    className="shrink-0 rounded-md border border-slate-800 px-1.5 py-1 text-[10px] text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-300"
                  >
                    raw
                  </button>
                )}
                {!original && voiceGender ? (
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
                {/* THREE SEPARATE QUESTIONS, and they used to be one. The whole group hung
                    off `here`, so a source with only a recording — now the ordinary case
                    for the six breath and throat kinds, which default to the recording and
                    give nobody a reason to convert — had no play button for the thing it
                    was about to splice. Play asks "is there something to hear", the toggle
                    asks "is there a choice to make", and render asks "is a conversion
                    missing". Those have different answers. */}
                <div className="flex shrink-0 items-center gap-1">
                  {activeRender && (
                    <button
                      type="button"
                      onClick={() => void audition(activeRender.id, 'render')}
                      title={
                        active === 'original'
                          ? 'Play the recording, which is what this voice will splice'
                          : `Play the conversion, which is what ${voiceName ?? 'this voice'} will splice`
                      }
                      className={`rounded-md border p-1 transition-colors ${
                        active === 'voice-converted'
                          ? 'border-emerald-700 text-emerald-300'
                          : 'border-emerald-900 text-emerald-500'
                      }`}
                    >
                      <Play size={12} />
                    </button>
                  )}
                  {/* Acts on the ACTIVE render, so the thing being made louder is the
                      thing that will be heard. Pointing it at the original would have let
                      somebody spend three clicks levelling a clip this voice never uses. */}
                  {activeRender && (
                    <span className="inline-flex items-center overflow-hidden rounded-md border border-slate-800">
                      <button
                        type="button"
                        onClick={() => void nudgeLevel(activeRender, -3)}
                        disabled={busy}
                        title="Re-encode 3 dB quieter"
                        className="px-1.5 py-1 text-[10px] text-slate-500 transition-colors hover:text-slate-200 disabled:text-slate-700"
                      >
                        −
                      </button>
                      <span
                        className="border-x border-slate-800 px-1 py-1 font-mono text-[10px] text-slate-600"
                        title={
                          activeRender.gainDb === undefined
                            ? 'Encoded before the level control existed, so at whatever level it was recorded'
                            : 'How far this clip has been moved from the recording as provided'
                        }
                      >
                        {working === `level:${activeRender.id}` ? (
                          <Loader2 size={10} className="animate-spin" />
                        ) : activeRender.gainDb === undefined ? (
                          '—'
                        ) : (
                          `${activeRender.gainDb > 0 ? '+' : ''}${activeRender.gainDb.toFixed(1)}`
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => void nudgeLevel(activeRender, 3)}
                        disabled={busy}
                        title="Re-encode 3 dB louder. A clip already at full scale cannot go up at all."
                        className="px-1.5 py-1 text-[10px] text-slate-500 transition-colors hover:text-slate-200 disabled:text-slate-700"
                      >
                        +
                      </button>
                    </span>
                  )}
                  {here && original && voiceGender && (
                    <button
                      type="button"
                      onClick={() => void choose(
                        source.id,
                        active === 'original' ? 'voice-converted' : 'original',
                      )}
                      disabled={busy}
                      title={
                        active === 'original'
                          ? `Switch this voice to the conversion. The recording is the default for a ${source.kind}.`
                          : 'Switch this voice back to the recording as provided.'
                      }
                      className="rounded-md border border-slate-800 px-1.5 py-1 text-[10px] text-slate-400 disabled:text-slate-700"
                    >
                      use {active === 'original' ? 'voice' : 'original'}
                    </button>
                  )}
                  {!here && (
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
                      title="Re-perform this in the voice this page is using, and use it. A few credits for a clip this short. The recording is kept, so you can play one against the other and switch back."
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
                </div>
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

              {/* WHERE THE CLIP WILL SIT, AND THE ONE CHANCE TO CHANGE IT. The slider opens
                  at whatever puts this clip where its kind belongs — not at unity, and not
                  at the speech's own level, which would be plain normalisation and is what
                  turns a sniff into a loud wet noise. See levelDb in tags.ts.

                  Baked into the encode, because it has to be: the Worker joins MP3 frames
                  without decoding, so a level chosen anywhere else could never reach the
                  bytes. That is also why the readout says what it will be rather than what
                  it is. */}
              {level !== null && (
                <div className="flex min-w-[13rem] flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-slate-600">
                      Level
                    </span>
                    {!gainAuto && (
                      <button
                        type="button"
                        onClick={() => setGainAuto(true)}
                        className="text-[10px] text-slate-500 underline decoration-dotted hover:text-slate-300"
                      >
                        reset
                      </button>
                    )}
                  </div>
                  <input
                    type="range"
                    min={MIN_GAIN_DB}
                    max={MAX_GAIN_DB}
                    step={0.5}
                    value={gainDb}
                    onChange={(event) => {
                      setGainAuto(false);
                      setGainDb(Number(event.target.value));
                    }}
                    className="w-full accent-slate-400"
                  />
                  <span className="font-mono text-xs text-slate-300">
                    {level + gainDb >= 0 ? '+' : ''}
                    {(level + gainDb).toFixed(1)} dB
                    <span className="ml-1 font-sans text-[11px] text-slate-600">
                      vs speech
                    </span>
                    {Math.abs(gainDb) >= 0.5 && (
                      <span className="ml-1.5 font-sans text-[11px] text-slate-600">
                        ({gainDb > 0 ? '+' : ''}{gainDb.toFixed(1)} applied
                        {gainAuto ? ', suggested' : ''})
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] leading-snug text-slate-600">
                    {target === undefined
                      ? 'No target for this kind, so nothing is suggested.'
                      : gainAuto
                        ? `Opened at where a ${kind} usually sits (${target > 0 ? '+' : ''}${target} dB). Move it by ear.`
                        : `A ${kind} usually sits at ${target > 0 ? '+' : ''}${target} dB.`}
                  </span>
                  {/* Peak after the lift, since that is the one that can wrap. toMp3
                      clamps, so this is a warning about audible flattening rather than
                      about a click. */}
                  {gainDb > room + 0.25 ? (
                    <span className="text-[11px] leading-snug text-amber-500">
                      Only +{room.toFixed(1)} dB of this fits before the peaks clip. Past
                      that the lift is flattened rather than heard, so the clip stops
                      getting louder and starts getting harder.
                    </span>
                  ) : peak > 0.99 && gainDb >= 0 ? (
                    <span className="text-[11px] leading-snug text-amber-500">
                      Already at full scale, so it cannot go up — only down.
                    </span>
                  ) : null}
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
                  // `willConvert`, so an impossible conversion is simply not attempted
                  // rather than making the whole import unavailable.
                  busy || span <= 0 || !gender
                }
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-700"
              >
                {working === 'import' ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Wand2 size={13} />
                )}
                Keep {willConvert ? 'both' : 'as recorded'}
              </button>
            </div>

            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={willConvert}
                disabled={!canConvert}
                onChange={(event) => setAlsoConvert(event.target.checked)}
              />
              <span className="text-[11px] leading-snug text-slate-600">
                Also convert into {voiceName || 'the current voice'}, and use it. Costs a
                few credits for a clip this short, and is available only when the recording
                and the voice share a gender pool.
                {!canConvert && (
                  <> Pick a voice and set its gender to enable it.</>
                )}
                {canConvert && (
                  <>
                    {' '}
                    Both versions are kept either way, so the row can play one against the
                    other and switch back with a click if the voice changer handles this
                    sound badly — likeliest on the short unvoiced ones.
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
                Strip background noise before voice conversion. Off by default now, for all
                eight: the isolation model removes what is not speech, and none of these are
                speech. It softens edges, and on a gasp or a sigh the edges are the sound.
                Turn it on if you can hear the room in your recording — that is the case it
                is genuinely good at.
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
