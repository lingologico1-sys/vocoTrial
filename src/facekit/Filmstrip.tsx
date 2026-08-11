import { useEffect, useMemo, useRef, useState } from 'react';
import { composite } from './canvas';
import type { FaceKit } from './kit';
import { SLOTS, type SlotId } from './slots';

/**
 * Plays the kit's mouths in a loop, fast, so you can see it fail.
 *
 * The most useful control on this page and among the cheapest. Drift between
 * generations is close to invisible in a contact sheet — six stills, all
 * plainly the same character, all fine — and unmissable in motion, where the
 * same drift arrives as the whole face crawling. Judging a kit by looking at
 * its patches side by side is judging it in the one condition it will never be
 * used in.
 *
 * Every frame is composited through the same function the export uses, so what
 * plays here is the artwork, not a preview of it.
 */

/** Roughly the rate a real mouth changes shape at during connected speech. */
const DEFAULT_FPS = 12;

const MOUTH_SLOTS = SLOTS.filter((entry) => entry.region === 'mouth').map((entry) => entry.id);

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
      // the frames to no benefit.
      const closed = kit.patches.eyesClosed;
      if (closed) {
        const blinkFrame = await composite(kit.base, [
          ...(kit.patches.rest ? [{ patch: kit.patches.rest, box: kit.boxes.mouth }] : []),
          { patch: closed, box: kit.boxes.eyes },
        ]);
        if (generation.current !== run) return;
        built.push({ id: 'eyesClosed', src: blinkFrame });
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

  const mouthFrames = useMemo(() => frames.filter((frame) => frame.id !== 'eyesClosed'), [frames]);
  const blinkFrame = useMemo(() => frames.find((frame) => frame.id === 'eyesClosed'), [frames]);

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
  const showing = blinking && blinkFrame ? blinkFrame.id : mouthFrames[index]?.id;

  return (
    <div className="space-y-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
        {/*
          Every frame stays mounted and is revealed by opacity rather than by
          swapping one element's src. A data URL still has to be decoded the
          first time it is painted, and doing that at twelve frames a second
          produces a stutter that looks exactly like the artefact this preview
          exists to detect.
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
          onClick={() => setPlaying((current) => !current)}
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 hover:border-slate-500"
        >
          {playing ? 'Pause' : 'Play'}
        </button>

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
