import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, AudioLines, Check, RotateCcw, Save, Upload } from 'lucide-react';
import BuildBadge from '../BuildBadge';
import ReturnButton from '../ReturnButton';
import SpeakingFace from '../live/SpeakingFace';
import { parseMfaMarks, type MfaMarkFile } from '../live/mfa';
import type { VisemeMark } from '../live/polly';
import { MARK_LOOKAHEAD_MS } from '../live/polly';
import { MAX_LOOKAHEAD_MS } from '../live/visemes';
import Compose from './Compose';
import Diagnostics from './Diagnostics';
import { audioUrl, saveLine, type Generated } from './library';
import { laughEyeSpans, withLaughEyesOpen } from './tags';
import { loadBundledKit } from '../facekit/bundled';
import { fetchPublished, listPublished } from '../facekit/library';
import type { PublishedFace } from '../facekit/published';
import type { FaceKit } from '../facekit/kit';
import { clearPrefs, loadPrefs, savePrefs } from './prefs';

/**
 * A mouth driven by a file instead of by a call.
 *
 * WHY THIS PAGE EXISTS. Everything else here is realtime: PcmPlayer streams audio
 * from a live session and MouthAnalyser reads it as it goes past. That is the only
 * kind of audio the app has ever played, so the mark-driven mouth in polly.ts —
 * written, documented, and the reason the `fv` slot was ever generated — had nothing
 * to attach to and had never once run. This is where it runs.
 *
 * A recording and a transcript go to a forced aligner (../../../lipsyncBackend, on
 * Modal) which returns viseme marks. Drop both in here and watch the face wear them.
 *
 * WHAT IT IS FOR is judging the marks, not playing lessons. The three things worth
 * watching are the ones the audio driver provably cannot get right, and each is
 * visible within a sentence:
 *
 *   the sibilants   "shop" and "chose" must round to `oh`. The analyser sends every
 *                   sibilant to `ee` because it sorts them by brightness, and /ʃ/
 *                   and /s/ are both bright — see the note on `S` in polly.ts.
 *   the labiodental "five" must reach `fv`. Under audio that slot is unreachable:
 *                   what separates /f/ from /s/ is absolute loudness, which the
 *                   running peak normalises away.
 *   the front       French "tu", "peu", "sœur". visemes.ts spends most of its
 *   rounded vowels  complexity guessing at these from a spectrum and concedes it
 *                   gets some wrong; a mark just says.
 *
 * The pose readout below the player names what is being worn each frame, so the
 * answer does not depend on how good anyone's eye is.
 */

interface Loaded {
  name: string;
  url: string;
}

/** What the bake writes, for the fields worth showing back. */
interface MarksMeta {
  language?: string;
  model?: string;
  durationMs?: number;
  oovCount?: number;
}

const POSE_BLURB: Record<string, string> = {
  rest: 'closed, at rest',
  mbp: 'lips pressed — p, b, m',
  fv: 'teeth on lip — f, v',
  ee: 'spread, shallow — ee, s, l',
  uh: 'neutral open — uh, k, r',
  aa: 'wide open — aa',
  oh: 'rounded — oh, oo, sh',
};

export default function LipSync() {
  const [audio, setAudio] = useState<Loaded | null>(null);
  const [marks, setMarks] = useState<readonly VisemeMark[] | null>(null);
  const [meta, setMeta] = useState<MarksMeta | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const remembered = useState(loadPrefs)[0];
  const [lookaheadMs, setLookaheadMs] = useState(remembered.lookaheadMs);

  const [kit, setKit] = useState<FaceKit | null>(null);
  const [faces, setFaces] = useState<PublishedFace[]>([]);
  /**
   * Which face is worn, in state as well as on the <select>.
   *
   * It was uncontrolled before, because nothing needed to know: the kit itself was
   * the only record and the element remembered its own choice. Now the choice has to
   * survive a reload — and be put back on the element, which a fresh DOM would
   * otherwise open on the first option while wearing a different face.
   */
  const [faceId, setFaceId] = useState(remembered.faceId);
  /**
   * Bumped by Reset, and used as Compose's key.
   *
   * Compose seeds itself from storage in its initialisers, so the way to return it
   * to defaults is to make it mount again after the store has been cleared. A key
   * change does exactly that, and keeps the default values defined once, in prefs.ts.
   */
  const [generation, setGeneration] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [pose, setPose] = useState<string>('rest');
  /**
   * The clip's length, in state rather than read off the element when wanted.
   *
   * `audioRef.current.duration` is NaN until metadata has loaded, so anything that
   * reads it at render time gets whatever happens to be true at that instant and is
   * never recomputed when it stops being NaN. Taking it from the event that knows
   * makes the comparison below fire exactly once, when there is something to compare.
   */
  const [duration, setDuration] = useState(0);
  /**
   * The last generated package, held so it can be saved.
   *
   * Null after a file was picked by hand rather than generated: those marks came
   * from somewhere this page cannot vouch for, and there is nothing coherent to
   * store. Saving is offered only for what this page made itself.
   */
  const [generated, setGenerated] = useState<Generated | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  /**
   * Whether this clip has ever started playing.
   *
   * Without it the face pre-forms into the first pose the moment a marks file is
   * chosen, and sits there. The cause is subtle and worth writing down: `audioTime`
   * reads 0 while the element is paused, the mouth is read MARK_LOOKAHEAD_MS ahead,
   * and the mark 50ms into this clip is the rounded vowel of "Bonjour" -- so a face
   * that has been asked to say nothing yet holds a rounded mouth, indefinitely,
   * before anyone presses play.
   *
   * Gating on the first `play` event rather than on `paused` is deliberate. Pausing
   * mid-sentence should leave the mouth where it is, because that is what a paused
   * video looks like; it is only the state *before the first frame of audio* that has
   * no honest pose but rest.
   */
  const [started, setStarted] = useState(false);
  /**
   * Whether the laughs in this line keep their eyes.
   *
   * A playback switch, not a generation one, and that is the whole point of it. The
   * same choice exists in Compose as `reactions.eyes`, but that is answered before the
   * voice is synthesised and covers every reaction at once — turning it off to save a
   * laugh's eyes costs a fresh ElevenLabs take (a different performance, on v3) and
   * takes the yawn's and the sigh's eyes down with it. This one applies to the package
   * already in hand, only to the laughs, and is reversible by clicking it again.
   */
  const [laughEyesOpen, setLaughEyesOpen] = useState(false);

  /**
   * The clock the mouth reads, and the one thing on this page that is subtle.
   *
   * A ref holding a getter rather than a plain callback, because SpeakingFace lists
   * `audioTime` in its effect dependencies — a new function identity each render
   * would rebuild MarkMouth sixty times a second. This identity never changes.
   *
   * It does NOT subtract output latency, and that is a real difference from the live
   * path. scheduledFeatures corrects for it because it has an AudioContext to ask;
   * an <audio> element does not expose one. On wired output the error is a few
   * milliseconds and invisible. Over Bluetooth it is not, and the mouth will run
   * early — which is the safe direction, since video leading audio survives past
   * 100ms while lagging is caught around 45. The lookahead slider is the manual
   * correction if it ever matters.
   */
  const audioTime = useRef(() => audioRef.current?.currentTime ?? 0).current;

  useEffect(() => {
    // The remembered face is fetched instead of the bundled one, when there is one.
    // The bundled kit still loads first either way, so a published face that has
    // since been deleted leaves a face on screen rather than an empty frame.
    loadBundledKit()
      .then(setKit)
      .catch(() => undefined);
    if (remembered.faceId) {
      fetchPublished(remembered.faceId)
        .then(setKit)
        .catch(() => undefined);
    }
    listPublished()
      // The same filter studio's picker uses. The library holds work in progress
      // now that saving is publishing, so `ready` is what separates a face that can
      // be worn from one still being drawn. Absent reads as ready — see published.ts.
      .then((list) => {
        const wearable = list.filter((face) => face.ready !== false);
        setFaces(wearable);
        // A face remembered from a previous visit can have been deleted or unpublished
        // since. Without this the <select> holds a value with no matching <option> and
        // renders blank, which reads as a bug rather than as a face that went away.
        setFaceId((id) => (id && !wearable.some((face) => face.id === id) ? '' : id));
      })
      .catch(() => undefined);
    // Read once, at mount: `remembered` is the snapshot taken before the first paint,
    // and re-running this on a later change would fight the picker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    savePrefs({ lookaheadMs, faceId });
  }, [lookaheadMs, faceId]);

  // Object URLs are revoked when they are replaced, not on every render: a URL
  // handed to a playing <audio> element must outlive the render that made it.
  useEffect(() => {
    return () => {
      if (audio) URL.revokeObjectURL(audio.url);
    };
  }, [audio]);

  /**
   * The pose readout, on its own animation frame.
   *
   * Deliberately not lifted out of SpeakingFace, which owns the mouth and should
   * keep owning it. Reading the same timeline a second time costs one binary search
   * per frame and keeps the face component free of a debugging concern.
   */
  useEffect(() => {
    if (!marks || !started) {
      setPose('rest');
      return;
    }
    let frame = 0;
    const step = () => {
      const at = (audioTime() + lookaheadMs / 1000) * 1000;
      let low = 0;
      let high = marks.length - 1;
      let found: VisemeMark | null = null;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (marks[mid].timeMs <= at) {
          found = marks[mid];
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      setPose(found?.viseme ?? 'rest');
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [marks, started, lookaheadMs, audioTime]);

  function takeAudio(file: File | undefined) {
    if (!file) return;
    if (audio) URL.revokeObjectURL(audio.url);
    setAudio({ name: file.name, url: URL.createObjectURL(file) });
    setStarted(false);
    setDuration(0);
    setGenerated(null);
    setSaved(false);
  }

  async function takeMarks(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    try {
      const parsed = JSON.parse(await file.text()) as MfaMarkFile;
      const read = parseMfaMarks(parsed);
      if (read.length === 0) {
        // Empty is not an exception — parseMfaMarks swallows a malformed file on
        // purpose, so that a bad marks file costs the mouth its shape rather than
        // costing the page its lesson. Here, where judging the file IS the job,
        // silence would be the wrong answer.
        setProblem(`${file.name} parsed to no usable marks.`);
        setMarks(null);
        setMeta(null);
        return;
      }
      setMarks(read);
      setMeta({
        language: parsed.language,
        model: parsed.model,
        durationMs: parsed.durationMs,
        oovCount: parsed.oovCount,
      });
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'could not read that file');
      setMarks(null);
      setMeta(null);
    }
  }

  /**
   * Puts a freshly generated package into the player.
   *
   * Everything below this point already knew how to play marks against audio, so a
   * generation is fed in through exactly the same two pieces of state a file would set.
   * The package is kept alongside only so Save has something to send.
   */
  function takeGenerated(result: Generated) {
    if (audio) URL.revokeObjectURL(audio.url);
    const pkg = result.package;
    setAudio({ name: `${pkg.name}.mp3`, url: audioUrl(result.audioBase64) });
    // Already VisemeMarks, built by the function that made them. parseMfaMarks is
    // for the file pickers below, where the marks arrive as untrusted JSON.
    setMarks(pkg.marks);
    setMeta({
      language: pkg.language,
      model: pkg.model,
      durationMs: pkg.durationMs,
      oovCount: pkg.oovCount,
    });
    setGenerated(result);
    setSaved(false);
    setStarted(false);
    setDuration(0);
    setProblem(null);
  }

  async function keep() {
    if (!generated) return;
    setBusy(true);
    try {
      await saveLine(generated);
      setSaved(true);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  async function wear(id: string) {
    setFaceId(id);
    if (!id) {
      loadBundledKit()
        .then(setKit)
        .catch(() => undefined);
      return;
    }
    try {
      setKit(await fetchPublished(id));
    } catch {
      /* Keep whatever is already on rather than stripping the face bare. */
    }
  }

  /**
   * Back to a page that has never been opened.
   *
   * Everything goes: the remembered settings, the clip and its marks, the face. The
   * clip is dropped along with the settings on purpose — a Reset that emptied the
   * form but left a recording loaded under it would leave the audio paired with a
   * script that is no longer on screen, which is the exact confusion this page was
   * built to catch.
   *
   * No confirmation. The costly thing here is a generation, and a generation that
   * matters has been saved to the library, which this does not touch.
   */
  function reset() {
    clearPrefs();
    if (audio) URL.revokeObjectURL(audio.url);
    setAudio(null);
    setMarks(null);
    setMeta(null);
    setProblem(null);
    setGenerated(null);
    setSaved(false);
    setStarted(false);
    setDuration(0);
    setPose('rest');
    const fresh = loadPrefs();
    setLookaheadMs(fresh.lookaheadMs);
    void wear(fresh.faceId);
    setGeneration((n) => n + 1);
  }

  /**
   * Marks are only meaningful against the audio they were aligned from.
   *
   * Worth checking because the failure it catches is silent: MFA fits whatever text
   * it is given to whatever audio it is given and reports no error, so a truncated
   * or mismatched script produces a confident set of marks that simply stop early.
   * Nothing in the file says so; only the length does.
   */
  const lengthWarning = useMemo(() => {
    if (!meta?.durationMs || !duration) return null;
    const drift = Math.abs(meta.durationMs / 1000 - duration);
    return drift > 0.5
      ? `The marks cover ${(meta.durationMs / 1000).toFixed(1)}s but this clip is ${duration.toFixed(1)}s. ` +
          'A script that does not match its audio still aligns, silently.'
      : null;
  }, [meta, duration]);

  const ready = Boolean(audio && marks);
  // Marks only once the audio is genuinely running. Before that the face has
  // nothing to say and rest is the only truthful pose.
  const driving = ready && started;

  /**
   * The expressions the face is actually given, which are the stored ones unless the
   * switch above is on. Recomputed rather than written back to the package: what was
   * generated stays what was generated, and Diagnostics keeps describing it truthfully.
   */
  const pkg = generated?.package ?? null;
  const hasLaughEyes = useMemo(
    () => (pkg ? laughEyeSpans(pkg.expressions, pkg.text).some(Boolean) : false),
    [pkg],
  );
  const expressions = useMemo(() => {
    if (!pkg) return null;
    return laughEyesOpen ? withLaughEyesOpen(pkg.expressions, pkg.text) : pkg.expressions;
  }, [pkg, laughEyesOpen]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <BuildBadge look="workshop" />

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-100">lipSync</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
              A recording, the marks a forced aligner produced for it, and the face wearing
              them. For judging an alignment before it is trusted — the mouth here is driven
              by the file, not by listening to the sound.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              title="Forget the remembered settings and clear the loaded clip"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200 disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-700"
            >
              <RotateCcw size={14} />
              Reset
            </button>
            <ReturnButton look="workshop" />
          </div>
        </header>

        <Compose
          key={generation}
          onGenerated={takeGenerated}
          busy={busy}
          setBusy={setBusy}
        />

        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wide text-slate-600">or open files</span>
          <span className="h-px flex-1 bg-slate-900" />
        </div>

        <section className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-800 px-4 py-3 transition-colors hover:border-slate-700">
            <AudioLines size={18} className="shrink-0 text-slate-600" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-200">Audio</div>
              <div className="truncate text-xs text-slate-500">
                {audio ? audio.name : 'wav, mp3, m4a…'}
              </div>
            </div>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(event) => takeAudio(event.target.files?.[0])}
            />
          </label>

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-800 px-4 py-3 transition-colors hover:border-slate-700">
            <Upload size={18} className="shrink-0 text-slate-600" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-slate-200">Marks</div>
              <div className="truncate text-xs text-slate-500">
                {marks ? `${marks.length} marks` : 'the .marks.json from the bake'}
              </div>
            </div>
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void takeMarks(event.target.files?.[0])}
            />
          </label>
        </section>

        {problem && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {problem}
          </p>
        )}

        {/* An out-of-vocabulary word aligns as `spn`, which draws as a closed mouth for
            the whole of it. The count is the only warning that a patch of the clip is
            dead, so it is surfaced rather than left in the file. */}
        {meta?.oovCount ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>
              {generated?.package.oovWords?.length
                ? // Naming it is the whole point. The count alone left rereading the
                  // line and guessing as the only available move.
                  <>
                    The aligner did not know{' '}
                    {generated.package.oovWords.map((w, i) => (
                      <span key={`${w.word}-${w.startMs}`}>
                        {i > 0 && ', '}
                        <span className="font-mono">{w.word}</span>{' '}
                        <span className="text-amber-400/60">
                          at {(w.startMs / 1000).toFixed(1)}s
                        </span>
                      </span>
                    ))}
                    . The mouth stays shut through {generated.package.oovWords.length === 1 ? 'it' : 'them'}.
                  </>
                : <>
                    {meta.oovCount} word{meta.oovCount === 1 ? '' : 's'} the aligner could
                    not look up. The mouth stays shut through{' '}
                    {meta.oovCount === 1 ? 'it' : 'them'}.
                  </>}
              {generated && ' See the panel below for where.'}
            </span>
          </p>
        ) : null}

        {lengthWarning && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {lengthWarning}
          </p>
        )}

        <section className="flex flex-col items-center gap-4 rounded-xl border border-slate-800 py-6">
          <div className="w-[320px]">
            <SpeakingFace
              tap={null}
              marks={driving ? marks : null}
              audioTime={driving ? audioTime : null}
              expressions={driving ? expressions : null}
              driver="scheduled"
              lookaheadMs={lookaheadMs}
              kit={kit}
              speaking={driving}
            />
          </div>

          {audio && (
            <audio
              ref={audioRef}
              src={audio.url}
              controls
              className="w-full max-w-md"
              onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
              onPlay={() => setStarted(true)}
            />
          )}

          <div className="flex items-baseline gap-2 font-mono text-xs">
            <span className="text-slate-600">pose</span>
            <span className="text-slate-200">{pose}</span>
            <span className="text-slate-600">{POSE_BLURB[pose]}</span>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-400">Face</span>
            <select
              value={faceId}
              className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              onChange={(event) => void wear(event.target.value)}
            >
              <option value="">the deployment&rsquo;s own face</option>
              {faces.map((face) => (
                <option key={face.id} value={face.id}>
                  {face.name || face.id}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-400">
              Lookahead — {lookaheadMs}ms
            </span>
            <input
              type="range"
              min={0}
              max={MAX_LOOKAHEAD_MS}
              value={lookaheadMs}
              onChange={(event) => setLookaheadMs(Number(event.target.value))}
            />
            {/* Smaller than the audio driver's 80ms default, and polly.ts explains
                why: a mark is already stamped with when the phone begins, so only
                the mouth's own easing needs paying for. The anticipation an animator
                would draw in comes free with the data. */}
            <span className="text-[11px] leading-snug text-slate-600">
              Marks default to {MARK_LOOKAHEAD_MS}ms, not the audio driver&rsquo;s 80 — a mark
              already knows when the phone starts, so only the mouth&rsquo;s own lag needs
              buying back.
            </span>
          </label>

          {/* Only when there is a laugh to argue about. A checkbox that provably does
              nothing to the line on screen is worse than no checkbox: it invites the
              reading that the eyes were left closed on purpose by something else. */}
          {hasLaughEyes && (
            <label className="flex items-start gap-2 sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={laughEyesOpen}
                onChange={(event) => setLaughEyesOpen(event.target.checked)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-xs text-slate-400">Eyes open through laughs</span>
                <span className="text-[11px] leading-snug text-slate-600">
                  Applies to this take as it plays — no regeneration, and the audio is
                  untouched. Yawns, sighs and sniffs keep their eyes either way, since
                  what those do with the lids is half of what makes them recognisable.
                </span>
              </span>
            </label>
          )}
        </section>

        {generated && <Diagnostics pkg={generated.package} />}

        {generated && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 px-4 py-3">
            <button
              type="button"
              onClick={() => void keep()}
              disabled={busy || saved}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-700"
            >
              {saved ? <Check size={15} /> : <Save size={15} />}
              {saved ? 'Saved' : 'Save this line'}
            </button>
            <span className="text-xs text-slate-600">
              {saved
                ? 'In the library, with its audio and the timings it was aligned from.'
                : 'Nothing is stored until you say so — tuning a voice should not fill a bucket.'}
            </span>
            {generated.package.reactionCount > 0 && (
              <span className="text-xs text-amber-400/80">
                {generated.package.reactionCount} reaction span
                {generated.package.reactionCount === 1 ? '' : 's'} marked from the timings
              </span>
            )}
          </div>
        )}

        {meta && (
          <p className="font-mono text-[11px] text-slate-600">
            {meta.model} · {meta.language} · {marks?.length} marks ·{' '}
            {meta.durationMs ? `${(meta.durationMs / 1000).toFixed(2)}s` : '—'}
          </p>
        )}
      </div>
    </div>
  );
}
