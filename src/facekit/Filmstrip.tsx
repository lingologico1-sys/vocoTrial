import { useEffect, useMemo, useRef, useState } from 'react';
import { composite } from './canvas';
import type { FaceKit } from './kit';
import { SLOTS, type SlotId } from './slots';

/**
 * Plays the kit's mouths in a loop, fast, so you can see it fail.
 *
 * The most useful control on this page and among the cheapest. Drift between
 * generations is close to invisible in a contact sheet — a handful of stills,
 * all plainly the same character, all fine — and unmissable in motion, where the
 * same drift arrives as the whole face crawling. Judging a kit by looking at
 * its patches side by side is judging it in the one condition it will never be
 * used in.
 *
 * Every frame is composited through the same function the export uses, so what
 * plays here is the artwork, not a preview of it.
 */

/**
 * A sixth of the rate a real mouth changes shape at during connected speech.
 *
 * Speaking speed is the honest setting and it is one drag away, but it is the
 * wrong one to open on: at twelve a second the frames blur into a single
 * impression of a face, and a kit that crawls tells you only that something is
 * wrong. Half a second a mouth is slow enough that each one arrives as its own
 * picture, and drift stops being a crawl and becomes a jump between two stills
 * you can name — which is the frame to regenerate.
 *
 * It is also the slider's own floor, so the strip opens at one end of its range
 * rather than in the middle: every drag from here is toward speaking speed, and
 * the setting that needs finding is the one you start on.
 */
const DEFAULT_FPS = 2;

const MOUTH_SLOTS = SLOTS.filter((entry) => entry.region === 'mouth').map((entry) => entry.id);

/** Which slot id the assembled blink frame is filed under. */
const BLINK: SlotId = 'eyeLeftClosed';

interface FilmstripProps {
  kit: FaceKit;
}

export default function Filmstrip({ kit }: FilmstripProps) {
  const [frames, setFrames] = useState<{ id: SlotId; src: string }[]>([]);
  const [index, setIndex] = useState(0);
  const [fps, setFps] = useState(DEFAULT_FPS);
  const [playing, setPlaying] = useState(true);
  const [blink, setBlink] = useState(true);
  const [building, setBuilding] = useState(false);
  const generation = useRef(0);

  const available = useMemo(
    () => MOUTH_SLOTS.filter((id) => Boolean(kit.patches[id])),
    [kit.patches],
  );

  /**
   * Rebuilds whenever the artwork or the boxes change.
   *
   * Guarded by a generation counter rather than an AbortController because the
   * work is canvas compositing rather than a request — there is nothing to
   * cancel, only a stale result to refuse once a newer run has started.
   */
  useEffect(() => {
    const run = ++generation.current;
    let cancelled = false;
    setBuilding(true);

    (async () => {
      const built: { id: SlotId; src: string }[] = [];

      for (const id of available) {
        const patch = kit.patches[id];
        if (!patch) continue;
        const overlays = [{ patch, box: kit.boxes.mouth }];
        built.push({ id, src: await composite(kit.base, overlays) });
        if (generation.current !== run) return;
      }

      // The blink is a separate frame rather than a variant of each mouth: it
      // lasts a fraction of a mouth shape, so pairing the two would multiply
      // the frames to no benefit. Both eyes go on together — one eye closing
      // alone is a wink, which is a different expression entirely.
      const lids = [
        { patch: kit.patches.eyeLeftClosed, box: kit.boxes.eyeLeft },
        { patch: kit.patches.eyeRightClosed, box: kit.boxes.eyeRight },
      ].filter((lid): lid is { patch: string; box: typeof lid.box } => Boolean(lid.patch));

      if (lids.length) {
        const blinkFrame = await composite(kit.base, [
          ...(kit.patches.rest ? [{ patch: kit.patches.rest, box: kit.boxes.mouth }] : []),
          ...lids,
        ]);
        if (generation.current !== run) return;
        built.push({ id: BLINK, src: blinkFrame });
      }

      if (!cancelled && generation.current === run) {
        setFrames(built);
        setBuilding(false);
      }
    })().catch(() => {
      if (!cancelled) setBuilding(false);
    });

    return () => {
      cancelled = true;
    };
  }, [kit.base, kit.patches, kit.boxes, available]);

  /**
   * The cycle, which is the speech poses and only those.
   *
   * Two frames are built and held out of it now rather than one, and for the
   * same reason: neither is speech. The blink belongs to a different clock and
   * has always been excluded; the smile is worn at the two ends of a call, when
   * the mouth is doing nothing at all. Left in, it arrived once a lap as a grin
   * between two vowels — a face that appeared to be smiling mid-word, in the one
   * panel on this page whose whole job is to tell you whether the mouths read as
   * talking.
   *
   * Held out, not dropped: it is still composited onto the base at full size,
   * which is the only view of it anywhere that shows the pose on the whole face.
   * The button below parks the strip on it.
   */
  const mouthFrames = useMemo(
    () => frames.filter((frame) => frame.id !== BLINK && frame.id !== 'smile'),
    [frames],
  );
  const blinkFrame = useMemo(() => frames.find((frame) => frame.id === BLINK), [frames]);
  const smileFrame = useMemo(() => frames.find((frame) => frame.id === 'smile'), [frames]);

  useEffect(() => {
    if (!playing || mouthFrames.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % mouthFrames.length);
    }, 1000 / fps);
    return () => window.clearInterval(timer);
  }, [playing, fps, mouthFrames.length]);

  /**
   * The blink runs on its own jittered schedule, exactly as the drawn face's
   * does — a blink locked to the mouth's cycle reads as a tic rather than as a
   * blink, and the point of this preview is to judge what the live face will do.
   */
  /**
   * Whether the strip is parked on the smile instead of playing.
   *
   * The pose that cannot be judged by watching, which is the opposite of every
   * other frame here. The rest of them are questions about motion — does this
   * mouth read as talking, does the face crawl between generations — and this
   * one is a question about a picture, because /eleve holds it still for as
   * long as nobody is talking. Before that, the only sight of it on this page
   * was an eighty-pixel crop in its slot card, which shows the artwork and not
   * whether the artwork lands on the face: a corner that has travelled past the
   * mouth box, or a lip line that no longer meets the base's at the box's sides,
   * is visible here and nowhere else.
   *
   * Parking stops the strip, and Play releases it — two controls cannot both
   * decide what is on screen. The blink stops with it, being tied to `playing`
   * already, which is right: a smile being inspected should not blink at you.
   */
  const [smiling, setSmiling] = useState(false);

  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    if (!blink || !blinkFrame || !playing) {
      setBlinking(false);
      return;
    }
    let timers: number[] = [];
    const schedule = () => {
      timers.push(
        window.setTimeout(
          () => {
            setBlinking(true);
            timers.push(
              window.setTimeout(() => {
                setBlinking(false);
                schedule();
              }, 120),
            );
          },
          4200 * (0.45 + Math.random()),
        ),
      );
    };
    schedule();
    return () => {
      timers.forEach(window.clearTimeout);
      timers = [];
    };
  }, [blink, blinkFrame, playing]);

  if (!frames.length) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-sm text-slate-500">
        {building ? 'Building frames…' : 'Generate some mouths to see them move.'}
      </div>
    );
  }

  // Keyed on the slot rather than on the image, because two slots can hold
  // byte-identical patches — accept the same candidate for "rest" and "uh" and
  // a comparison on src would light both up and stall the cycle on them.
  const showing =
    smiling && smileFrame
      ? smileFrame.id
      : blinking && blinkFrame
        ? blinkFrame.id
        : mouthFrames[index]?.id;

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        {/*
          Every frame stays mounted and is revealed by opacity rather than by
          swapping one element's src. A data URL still has to be decoded the
          first time it is painted, and doing that at playback speed produces a
          stutter that looks exactly like the artefact this preview exists to
          detect.
        */}
        {frames.map((frame) => (
          <img
            key={frame.id}
            src={frame.src}
            alt=""
            className="absolute inset-0 h-full w-full"
            style={{ opacity: frame.id === showing ? 1 : 0 }}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          // Releases the park on the way past, whichever way it is going: a
          // click here is a statement that the loop is in charge, and pressing
          // Play on a strip parked at a smile and getting a still smile is not
          // a state anybody meant to ask for.
          onClick={() => {
            setPlaying((current) => !current);
            setSmiling(false);
          }}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 hover:border-slate-500"
        >
          {playing ? 'Pause' : 'Play'}
        </button>

        {/*
          Only when there is one, like the Blink checkbox below: a control that
          does nothing until a slot at the foot of the page has been generated
          teaches its first user that it is broken.
        */}
        {smileFrame && (
          <button
            type="button"
            title="Stops on the smile — what a learner sees before the tutor's first word and after its goodbye, held for as long as nobody is talking. Judge it as a picture rather than as a movement: the lips meeting the base's at the sides of the mouth box, and no edge of the crop showing on the cheeks."
            onClick={() => {
              const next = !smiling;
              setSmiling(next);
              if (next) setPlaying(false);
            }}
            className={`rounded-lg border px-3 py-1.5 ${
              smiling
                ? 'border-emerald-600 bg-emerald-950/40 text-emerald-200'
                : 'border-slate-700 text-slate-200 hover:border-slate-500'
            }`}
          >
            Smile
          </button>
        )}

        <label className="flex items-center gap-2 text-slate-400">
          <span className="tabular-nums">{fps} fps</span>
          <input
            type="range"
            min={2}
            max={30}
            value={fps}
            onChange={(event) => setFps(Number(event.target.value))}
            className="w-32"
          />
        </label>

        {blinkFrame && (
          <label className="flex items-center gap-2 text-slate-400">
            <input
              type="checkbox"
              checked={blink}
              onChange={(event) => setBlink(event.target.checked)}
            />
            Blink
          </label>
        )}

        {building && <span className="text-slate-500">rebuilding…</span>}
      </div>
    </div>
  );
}
