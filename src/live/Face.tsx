import { useEffect, useId, useRef, useState } from 'react';
import { CANVAS_EDGE } from '../facekit/imageModels';
import type { FaceKit } from '../facekit/kit';
import { BROW_BOXES } from '../facekit/slots';
import {
  DEFAULT_CADENCE,
  DEFAULT_HEAD_MOTION,
  DEFAULT_TILT_TRIGGERS,
  HeadPerformer,
  MOTION,
  OVERSCAN,
  PIVOT_X,
  PIVOT_Y,
  TILT_OVERSCAN,
  TILT_ROLL,
  type HeadMotion,
  type MotionCadence,
  type Performance,
  type TiltCue,
  type TiltTrigger,
} from './headMotion';
import { MOUTH_BOX, lipPath, type LipShape, type Viseme } from './visemes';

/**
 * The placeholder face.
 *
 * Deliberately plain: it exists to prove the mouth is being driven correctly,
 * and it is meant to be replaced by drawn art. What is *not* placeholder is the
 * mouth slot — a fixed MOUTH_BOX-sized window at a fixed position on the head.
 * Art authored to those bounds drops in by swapping what is rendered inside the
 * nested <svg> below, and nothing outside this file has to know it happened.
 */

/** Where the mouth slot sits on the 200x200 head. */
const MOUTH_X = 100 - MOUTH_BOX.width / 2;
const MOUTH_Y = 118;

const SKIN = '#f3c79c';
const SKIN_SHADE = '#e0ac7c';
const INK = '#33211a';
const THROAT = '#8c3f3a';

/** A blink lasts this long, and one falls somewhere in every window this wide. */
const BLINK_MS = 120;
const BLINK_EVERY_MS = 4200;

/**
 * How far a kit's brows travel at full volume, in head units.
 *
 * Still well under what the placeholder spends on its own drawn brows, because
 * the placeholder is a cartoon and a kit is usually not. On a portrait drawn
 * anywhere near naturalistically the cartoon amount does not read as emphasis,
 * it reads as alarm — the brows arrive somewhere no real brow goes, and stay
 * there for the length of a loud syllable.
 *
 * It was 1.8, which turned out to be under the floor rather than merely
 * restrained: the live stage draws this 200-unit head at 160 pixels, so 1.8
 * units is 1.4 pixels of travel, reached slowly through a phrase envelope and
 * given back just as slowly. Nobody reported it as too small. It was reported
 * as brows that do not appear to move, which is what a movement below the size
 * of the thing drawing it looks like.
 *
 * 3 units is 2.4 pixels, and sits under the cap a default brow box imposes
 * (a third of its height, 3.6 units) with enough room that the two figures do
 * not have to be read together. Kits whose boxes are shallower are still cut
 * back by that cap, which is the point of having it — this number is what the
 * brows want, and the box is what the picture can afford.
 */
const KIT_BROW_LIFT = 3;

/**
 * How far the brow patch fades out at its top and sides, in head units.
 *
 * The one number that decides whether this looks like a lift or like a
 * rectangle. Every edge of the moved crop is a place where pixels from one
 * height sit next to pixels from another, and a hard edge announces itself the
 * moment it crosses anything with structure — a curl of hair at the temple, the
 * outer tip of the brow itself. Fading over a dozen pixels turns each of those
 * into a place where the lift simply tapers off, which is also how a real brow
 * moves: most at the middle, least at the ends.
 */
const BROW_FEATHER = 2.6;

interface FaceProps {
  shape: LipShape;
  /**
   * The discrete shape the classifier settled on.
   *
   * Unused by the drawn face, which interpolates `shape` continuously, and the
   * only thing a kit can use: drawn artwork comes in six poses, not on a
   * spectrum between them.
   */
  viseme: Viseme;
  /** Smoothed loudness, 0 to 1. Drives everything that is not the mouth. */
  level: number;
  /** Artwork to wear instead of the drawing. Null falls back to the placeholder. */
  kit?: FaceKit | null;
  /** Which way the head moves. See HEAD_MOTIONS. */
  motion?: HeadMotion;
  /** On what schedule it moves, and the brows with it. See MOTION_CADENCES. */
  cadence?: MotionCadence;
  /** Whether some blinks carry a brow lift. See BROW_FLASH in headMotion.ts. */
  browBlink?: boolean;
  /** Which events may lean the head sideways. See TILT_TRIGGERS. Empty is off. */
  tilt?: readonly TiltTrigger[];
  /**
   * The latest question or handover, or null if there has not been one.
   *
   * A fresh object per event and never rebuilt on an ordinary render, because
   * the effect below fires on its identity — see TiltCue.
   */
  tiltCue?: TiltCue | null;
  /**
   * Whether the agent's audio is playing, gaps inside it included.
   *
   * Only the tilt reads it, and only to tell a pause mid-turn from the end of
   * one. Defaulting to false is what keeps a face with no call behind it — the
   * kit page's preview — from finding a hesitation in its own silence.
   */
  speaking?: boolean;
  /** Anchor for the speech bubble's tail. Marks the mouth, not the head. */
  mouthRef?: React.Ref<SVGCircleElement>;
}

/** Kit boxes are in CANVAS_EDGE pixels; this head is 200 units across. */
const toHead = (value: number) => (value / CANVAS_EDGE) * 200;

/**
 * Every mouth pose a kit can hold, listed so all of them can stay mounted.
 *
 * Spelled out rather than read off the kit's own keys, so the set of <image>
 * elements does not change when a patch is added — React would remount the
 * lot, and a remount mid-sentence is a visible blank.
 */
const VISEME_ORDER: Viseme[] = ['rest', 'mbp', 'ee', 'uh', 'aa', 'oh'];

export default function Face({
  shape,
  viseme,
  level,
  kit,
  motion = DEFAULT_HEAD_MOTION,
  cadence = DEFAULT_CADENCE,
  browBlink = true,
  tilt = DEFAULT_TILT_TRIGGERS,
  tiltCue,
  speaking = false,
  mouthRef,
}: FaceProps) {
  const [blinking, setBlinking] = useState(false);
  const [perf, setPerf] = useState<Performance>({ head: 0, brow: 0, tilt: 0 });
  const timers = useRef<number[]>([]);
  /**
   * Built once, and reachable from both effects below rather than owned by the
   * loop that reads it — the blink schedule has to be able to tell it that an
   * eye just closed, and the two live in separate effects because they are
   * separate clocks.
   */
  const performer = useRef<HeadPerformer | null>(null);
  if (!performer.current) performer.current = new HeadPerformer();
  // Two faces on one page must not share a mask id, and nothing here knows
  // whether it is the only one.
  const maskId = useId().replace(/:/g, '');

  /**
   * The latest of everything the performer reads, kept where its loop can see it.
   *
   * Refs rather than dependencies on purpose. The loop below must not be torn
   * down and rebuilt when the cadence changes, because rebuilding it resets the
   * phrase envelope and both lockouts — and a switch that costs a second of the
   * face finding its feet cannot be used for the one thing it exists for, which
   * is flipping between two schedules on the same sentence.
   */
  const latest = useRef({ level, cadence, browBlink, tilt, speaking });
  useEffect(() => {
    latest.current = { level, cadence, browBlink, tilt, speaking };
  }, [level, cadence, browBlink, tilt, speaking]);

  /**
   * Questions and handovers, handed to the performer as they arrive.
   *
   * Keyed on the cue object rather than on anything inside it, which is the
   * whole reason the page keeps it in state: rebuilt inline on every render this
   * would fire on each transcript delta, and the face would lean at every word.
   */
  useEffect(() => {
    if (!tiltCue) return;
    if (tiltCue.kind === 'question') performer.current?.heardQuestion();
    else performer.current?.yielded();
  }, [tiltCue]);

  useEffect(() => {
    const schedule = () => {
      // Jittered rather than metronomic — a face that blinks on the beat is
      // more unsettling than one that does not blink at all.
      const delay = BLINK_EVERY_MS * (0.45 + Math.random());
      timers.current.push(
        window.setTimeout(() => {
          setBlinking(true);
          // Told at the moment the lids start to close, not when they open
          // again: the brow and the blink are meant to read as one movement,
          // and the brow's own attack is already the slower of the two.
          if (latest.current.browBlink) performer.current?.blinked();
          timers.current.push(
            window.setTimeout(() => {
              setBlinking(false);
              schedule();
            }, BLINK_MS),
          );
        }, delay),
      );
    };

    schedule();
    return () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  /**
   * The head's own clock, which is the blink's argument applied to the rest of
   * the face.
   *
   * It lives here rather than in SpeakingFace's loop for two reasons, and the
   * second is the load-bearing one. A schedule has to keep running when nothing
   * is being said — a lockout has to expire, a brow lifted by a blink has to
   * come back down — and SpeakingFace's loop stops entirely between calls. That
   * second clause is no longer hypothetical: the brow flash is fired by the
   * blink, which never stops, so this loop now has work to do on a face that
   * has not been spoken to in minutes. And MotionPreview drives
   * this component with a loudness it invents, with no analyser anywhere near
   * it; a performance computed upstream would leave that preview showing
   * something the live page does not do, which is the one thing that preview
   * promises never to do.
   */
  useEffect(() => {
    let frame = 0;
    let last = performance.now();

    const step = (time: number) => {
      // Clamped for the analyser's reason: a backgrounded tab resumes with a gap
      // of seconds, and feeding that in as one frame would expire every lockout
      // and snap the envelope to its target.
      const dt = Math.min(0.1, (time - last) / 1000);
      last = time;
      const next = performer.current!.read(dt, latest.current.level, latest.current.cadence, {
        triggers: latest.current.tilt,
        speaking: latest.current.speaking,
      });
      // Returning the identical object when nothing has moved is what keeps a
      // silent face cheap: between flashes this loop costs one callback a frame
      // and no renders at all, rather than re-rendering a whole portrait sixty
      // times a second to draw the same transform.
      //
      // Every field the performance carries has to be tested here. A field left
      // out is not a missed optimisation, it is a channel that silently stops
      // animating whenever the others are still — which, for the brows, is
      // exactly when they now have something to do.
      setPerf((current) =>
        Math.abs(current.head - next.head) < 1e-4 &&
        Math.abs(current.brow - next.brow) < 1e-4 &&
        Math.abs(current.tilt - next.tilt) < 1e-4
          ? current
          : next,
      );
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, []);

  /**
   * The rest of the performance.
   *
   * Six mouth shapes on a rigid head reads as a puppet; a head that carries the
   * emphasis reads as someone talking. What changed is where the two numbers
   * come from: `level` is the loudness of this frame and moves at syllable rate,
   * whereas `perf` is that loudness put through a schedule — see MOTION_CADENCES.
   * The mouth still reads `level` directly, because the mouth *should* move once
   * per syllable; it is the only thing here that should.
   */
  // Not destructured: `rise` would shadow the per-brow travel of the same name
  // a few dozen lines down, where the shadowing would be harmless and confusing.
  const travel = MOTION[motion];
  /**
   * The move, as one transform both branches share.
   *
   * SVG applies a transform list right to left, so this rotates about the pivot
   * and then translates — the order the face has always used. It used to be
   * unobservable, because every mode in MOTION leaves one of the two terms at
   * zero and one half of this was always an identity. The tilt ends that: under
   * `rise` a lean and a lift are now live at the same moment, and the order
   * above is what decides that the picture lifts along the frame's vertical
   * rather than along its own tilted one. That is the right way round — the
   * lift is a camera-ish move on the frame, the lean is the head turning inside
   * it — but it is now a choice rather than a spare comment.
   *
   * Both rotations go about the same pivot, which is not a detail. A tilt hinged
   * anywhere else would read as a different joint from the swing, and with both
   * able to run at once the discrepancy would be on screen rather than
   * theoretical.
   */
  const roll = perf.head * travel.roll + perf.tilt * TILT_ROLL;
  const move = `translate(0 ${-perf.head * travel.rise}) rotate(${roll} ${PIVOT_X} ${PIVOT_Y})`;
  // Bolder than a kit's, and for the cartoon's reason rather than in spite of
  // it: these brows are two strokes on flat skin with nothing registered to
  // them, so the only thing limiting the travel is what looks right. A drawing
  // this simple has to overact slightly to say anything at all.
  const browLift = perf.brow * 5;
  // Left on the raw loudness, alone among these. It is not a gesture — it is a
  // twelve percent narrowing that happens to the eyes of anyone raising their
  // voice, and putting it on a schedule would make the face blink-adjacent at
  // moments it had not chosen to blink.
  const eyeOpen = blinking ? 0.08 : 1 - level * 0.12;

  /**
   * The drawn face, wearing artwork.
   *
   * Everything the placeholder does with `level` — the swing into an emphasised
   * syllable — survives here, because it is a transform on a group rather than
   * anything drawn. That is the part of a live face that costs nothing to keep
   * when the art is swapped in, and it is worth noticing that it is also most of
   * the effect.
   *
   * The group contains the whole picture, and the overscan is what pays for
   * that: the artwork is drawn a tenth oversize inside the moving group, so the
   * frame stays covered however far the picture turns. Everything registered to
   * the base — patches, lids, brow crops — sits inside the same group and scales
   * with it, which is the only way the registration survives.
   *
   * What also changes is the mouth: six poses instead of a spectrum, chosen by
   * `viseme` rather than interpolated from `shape`. Every pose stays mounted and
   * is revealed by opacity, because decoding a patch the first time it is
   * painted costs a frame, and dropping a frame at the exact moment a mouth
   * changes shape is the one place it would be visible.
   */
  if (kit) {
    const mouth = kit.boxes.mouth;

    /**
     * The overscan, as a transform about the centre of the frame.
     *
     * Centre rather than the pivot, because what has to stay covered is the
     * whole frame rather than the neighbourhood of one point — scaling about a
     * pivot sitting 20 units off the bottom edge pushes that edge out barely at
     * all, and the bottom corners are exactly where the rotation uncovers.
     */
    /*
      Chosen by whether a tilt can happen at all, and never by how far one has
      got: a scale recomputed per frame would swell the head on every lean,
      which is a zoom rather than a movement and reads as the face lurching at
      the camera. It steps once, when the feature is switched on. See
      TILT_OVERSCAN on why it does not also follow the direction switch.
    */
    const grow = `translate(100 100) scale(${tilt.length > 0 ? TILT_OVERSCAN : OVERSCAN}) translate(-100 -100)`;
    // Both lids are drawn from the same flag. A kit holding only one of them
    // still blinks, with one eye — visibly wrong, and better than silently
    // doing nothing while the artwork looks complete in the picker.
    const lids = [
      { id: 'eyeLeftClosed', patch: kit.patches.eyeLeftClosed, box: kit.boxes.eyeLeft },
      { id: 'eyeRightClosed', patch: kit.patches.eyeRightClosed, box: kit.boxes.eyeRight },
    ];

    /**
     * The brows, and how far each one goes this frame.
     *
     * Capped at a third of the box because the height of the box is the only
     * statement anyone makes about how much clear forehead is up there to move
     * into. A kit with no brow box gets no lift and no rectangles, which is how
     * every kit authored before this behaved.
     */
    const brows = BROW_BOXES.flatMap((id) => {
      const box = kit.boxes[id];
      if (!box) return [];
      const rise = Math.min(perf.brow * KIT_BROW_LIFT, toHead(box.height) / 3);
      if (rise <= 0) return [];
      return [
        {
          id,
          rise,
          x: toHead(box.x),
          y: toHead(box.y),
          width: toHead(box.width),
          height: toHead(box.height),
        },
      ];
    });

    return (
      /*
        Clipped, unlike the placeholder below, and the overscan is why: the
        artwork is deliberately drawn a tenth wider than the frame, so something
        has to cut it back to the frame or a portrait bleeds a tenth of its width
        over whatever sits beside it. The live stage puts a speech balloon
        exactly there and does not clip on its own account.
      */
      <svg viewBox="0 0 200 200" className="h-full w-full overflow-hidden" aria-hidden="true">
        {/*
          Three ramps, in bounding-box units so one definition serves a strip of
          any size. Black at full opacity hides, transparent reveals, and a mask
          reads luminance — so painting these over a white rectangle is what
          turns a hard-edged crop into one that tapers away.
        */}
        <defs>
          {(
            [
              ['fade-left', '0', '0', '1', '0', 1, 0],
              ['fade-right', '0', '0', '1', '0', 0, 1],
              ['fade-top', '0', '0', '0', '1', 1, 0],
            ] as const
          ).map(([name, x1, y1, x2, y2, from, to]) => (
            <linearGradient key={name} id={`${maskId}-${name}`} x1={x1} y1={y1} x2={x2} y2={y2}>
              <stop offset="0%" stopColor="#000" stopOpacity={from} />
              <stop offset="100%" stopColor="#000" stopOpacity={to} />
            </linearGradient>
          ))}
        </defs>

        {/*
          The moving part, which is all of it. Two nested groups rather than one
          because they answer two separate questions and collapsing them would
          hide that: the outer one is where the head goes this frame, the inner
          one is the fixed overscan that keeps the frame covered while it gets
          there. Nesting also keeps the base's own coordinate system intact for
          everything drawn inside — the brow crops in particular are written in
          base pixels and would need rewriting against a scaled origin otherwise.
        */}
        <g transform={move}>
          <g transform={grow}>
            <image href={kit.base} x={0} y={0} width={200} height={200} />

            {/*
              The brows, lifted — the one piece of the performance that moves
              drawn artwork without a generator ever having seen it.
    
              Two draws per brow, both of them the base image again through a
              nested <svg>, which crops to its own bounds: source rect in the
              viewBox, destination rect in x/y/width/height. Nested rather than a
              clipPath so that two faces on one page cannot collide over an id.
    
              The crop is a plain translate. The strip under it is the part worth
              explaining: sliding the box up leaves a gap at the bottom still
              showing the brow that used to be there, and on a face wearing
              glasses there is no clear skin below to borrow — this portrait has
              about five pixels between brow and spectacle rim, and the rim runs
              diagonally, so it is nearer to nothing at one end.
    
              So the gap is filled by taking the box's own bottom row and
              stretching it upward. It is the nearest skin there is, which makes
              it the right colour by construction. Filling from the *top* of the
              box instead was the first attempt and looked wrong immediately: the
              forehead is a good deal paler than the shaded skin just under a
              brow, so every raise flashed a bright rectangle. Uniform across the
              width, this drawing's skin is; uniform from forehead down to eye
              socket, it is not.
            */}
            {brows.map((brow) => {
              const fade = Math.min(BROW_FEATHER, brow.width / 3, brow.height / 2);
              const top = brow.y - brow.rise;
              const row = toHead(1);
              return (
                <g key={brow.id} mask={`url(#${maskId}-${brow.id})`}>
                  <mask
                    id={`${maskId}-${brow.id}`}
                    maskUnits="userSpaceOnUse"
                    x={brow.x}
                    y={top}
                    width={brow.width}
                    height={brow.height + brow.rise}
                  >
                    <rect
                      x={brow.x}
                      y={top}
                      width={brow.width}
                      height={brow.height + brow.rise}
                      fill="#fff"
                    />
                    <rect
                      x={brow.x}
                      y={top}
                      width={fade}
                      height={brow.height + brow.rise}
                      fill={`url(#${maskId}-fade-left)`}
                    />
                    <rect
                      x={brow.x + brow.width - fade}
                      y={top}
                      width={fade}
                      height={brow.height + brow.rise}
                      fill={`url(#${maskId}-fade-right)`}
                    />
                    <rect
                      x={brow.x}
                      y={top}
                      width={brow.width}
                      height={fade}
                      fill={`url(#${maskId}-fade-top)`}
                    />
                  </mask>
    
                  {/* The bottom row of the box, stretched over the gap. */}
                  <svg
                    x={brow.x}
                    y={brow.y + brow.height - brow.rise}
                    width={brow.width}
                    height={brow.rise}
                    viewBox={`${brow.x} ${brow.y + brow.height - row} ${brow.width} ${row}`}
                    preserveAspectRatio="none"
                  >
                    <image href={kit.base} x={0} y={0} width={200} height={200} />
                  </svg>
    
                  {/* The box itself, drawn where the brow is going. */}
                  <svg
                    x={brow.x}
                    y={top}
                    width={brow.width}
                    height={brow.height}
                    viewBox={`${brow.x} ${brow.y} ${brow.width} ${brow.height}`}
                  >
                    <image href={kit.base} x={0} y={0} width={200} height={200} />
                  </svg>
                </g>
              );
            })}
    
            {VISEME_ORDER.map((id) => {
              const patch = kit.patches[id];
              if (!patch) return null;
              return (
                <image
                  key={id}
                  href={patch}
                  x={toHead(mouth.x)}
                  y={toHead(mouth.y)}
                  width={toHead(mouth.width)}
                  height={toHead(mouth.height)}
                  opacity={viseme === id ? 1 : 0}
                />
              );
            })}
    
            {lids.map((lid) =>
              lid.patch ? (
                <image
                  key={lid.id}
                  href={lid.patch}
                  x={toHead(lid.box.x)}
                  y={toHead(lid.box.y)}
                  width={toHead(lid.box.width)}
                  height={toHead(lid.box.height)}
                  opacity={blinking ? 1 : 0}
                />
              ) : null,
            )}
    
            <circle
              ref={mouthRef}
              cx={toHead(mouth.x + mouth.width / 2)}
              cy={toHead(mouth.y + mouth.height / 2)}
              r="1"
              fill="none"
              opacity="0"
            />
          </g>
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 200 200" className="h-full w-full overflow-visible" aria-hidden="true">
      {/*
        No overscan here, and none wanted: the placeholder is a head on nothing,
        so there is no frame edge to swing out of view and nothing behind it to
        uncover. Scaling it a tenth larger would only make the head a tenth
        larger, which is a change to the drawing rather than to the motion.
      */}
      <g transform={move}>
        {/* Lit from the upper left, so the head reads as round, not as a disc. */}
        <defs>
          <radialGradient id="face-shade" cx="37%" cy="30%" r="80%">
            <stop offset="0%" stopColor={SKIN} />
            <stop offset="100%" stopColor={SKIN_SHADE} />
          </radialGradient>
        </defs>
        <circle cx="100" cy="100" r="86" fill="url(#face-shade)" />

        <g fill={INK}>
          <ellipse cx="72" cy="86" rx="8.5" ry={8.5 * eyeOpen} />
          <ellipse cx="128" cy="86" rx="8.5" ry={8.5 * eyeOpen} />
        </g>

        <g
          stroke={INK}
          strokeWidth="4.5"
          strokeLinecap="round"
          fill="none"
          transform={`translate(0 ${-browLift})`}
        >
          <path d="M 61 64 Q 72 58 84 63" />
          <path d="M 116 63 Q 128 58 139 64" />
        </g>

        <g fill={SKIN_SHADE} opacity="0.5">
          <ellipse cx="55" cy="120" rx="12" ry="8" />
          <ellipse cx="145" cy="120" rx="12" ry="8" />
        </g>

        {/*
          The mouth slot. Its own coordinate system, 1:1 with MOUTH_BOX, so the
          shapes in visemes.ts are written in the same numbers they are drawn
          in — and so drawn art exported at those bounds needs no rescaling.
        */}
        <svg
          x={MOUTH_X}
          y={MOUTH_Y}
          width={MOUTH_BOX.width}
          height={MOUTH_BOX.height}
          viewBox={`0 0 ${MOUTH_BOX.width} ${MOUTH_BOX.height}`}
          overflow="visible"
        >
          <path d={lipPath(shape)} fill={THROAT} stroke={INK} strokeWidth="2.5" />
          <circle
            ref={mouthRef}
            cx={MOUTH_BOX.width / 2}
            cy={MOUTH_BOX.height / 2}
            r="1"
            fill="none"
            opacity="0"
          />
        </svg>
      </g>
    </svg>
  );
}
