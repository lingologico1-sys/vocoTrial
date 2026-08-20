/**
 * The published setup: one tutoring session, as it travels from the teacher to
 * a student's browser.
 *
 * WHY THIS EXISTS AT ALL. A Voco Session is authored on /teach and lives in a
 * teacher's filing cabinet. A student opening /eleve has never seen that
 * cabinet — so publishing snapshots one into R2 under a code, and the student
 * page reads it back. Without it a student meets the defaults, which is a
 * different tutor wearing the same name.
 *
 * IT IS NOT THE SAME OBJECT AS THE THING THAT WAS AUTHORED, and the difference
 * is the whole reason for two types. A `VocoSession` names a face and a style
 * by id and can be edited all week. This is what came out the other end at one
 * moment: the prompt already composed, the questions already copied, nothing
 * left to resolve. A teacher fixing next week's questions cannot rewrite the
 * screen of somebody who is talking right now.
 *
 * IT USED TO BE CALLED `StudentSession`, and the rename is not cosmetic. "Voco
 * Session" is now the authored thing, so a type called `StudentSession` sitting
 * beside it would be two names one letter apart for the two halves of one
 * journey. This is the setup that was published; that is the session that was
 * written.
 *
 * KEYED BY CODE, AND THE CODE IS NOW SHARED. Six characters from
 * lessonCodes.ts, the format LingoLecto already hands out, so that one day a
 * student types one code and reaches whichever kind of lingomondo lesson it
 * names. There is no pointer at "whichever was published last" any more: a
 * student arrives with a code or they arrive with nothing, and pretending
 * otherwise is what made two teachers publishing overwrite each other.
 *
 * THE INSTRUCTIONS TRAVEL AS TEXT, NOT AS A STYLE ID. A style lives in the
 * house library, which the student's browser has no business reading, and the
 * persona wrap depends on a face's bio that is megabytes away in another
 * bucket. Publishing composes the two server-side and stores the result, which
 * also means a style edited after publishing does not silently change what a
 * student is talking to.
 *
 * Deliberately free of DOM imports, and of anything that imports one:
 * functions/ compiles against workers-types with no DOM lib, and the routes
 * that read and write this are the ones that have to validate it. That rules
 * out visemes.ts — pure in itself, but it imports audio.ts, which is
 * AudioContext all the way down. headMotion.ts has no imports at all and is
 * safe to take the motion vocabulary from.
 */

import type { HeadMotion, MotionCadence, PressTrigger, TiltTrigger } from '../live/headMotion';
import { LESSON_CODE } from './lessonCodes';

/**
 * The two mouth modes, restated rather than imported.
 *
 * Both are plain string unions in visemes.ts, and that is where they belong —
 * beside the code that acts on them. They cannot be imported here for the
 * reason in the header, so they are written out instead, and sessionStore.ts
 * asserts the two spellings still agree. A divergence is a compile error on the
 * browser side rather than a config that publishes a driver the face cannot
 * run.
 */
export type SessionMouthDriver = 'reactive' | 'scheduled';
export type SessionRoundness = 'auto' | 'both' | 'centroid';

/** A ceiling on one published setup, in characters of JSON. */
export const MAX_SESSION = 30_000;

/** Long enough to say which class this is for, short enough to show. */
export const MAX_SESSION_LABEL = 60;

/**
 * How the face performs and how the call takes turns.
 *
 * ITS OWN TYPE BECAUSE IT IS NOW AUTHORED SOMEWHERE ELSE. These are studio's
 * knobs, and studio is an administrator's page — a teacher on /teach never sees
 * them and could not sensibly be asked to. So an administrator tunes them once,
 * saves them as the house profile, and every publish carries that. See
 * house.ts.
 *
 * Splitting it out rather than listing the fields twice is the point: the house
 * profile *is* the performance half of a published setup, and two lists that
 * have to agree is two lists that eventually will not.
 */
export interface PerformanceProfile {
  // --- How the face performs. Verbatim from studio's own tuning, because the
  // --- whole point is that the student meets what was tuned rather than a
  // --- reasonable-looking approximation of it.
  driver: SessionMouthDriver;
  lookaheadMs: number;
  roundness: SessionRoundness;
  motion: HeadMotion;
  cadence: MotionCadence;
  browBlink: boolean;
  press: PressTrigger[];
  browLift: number;
  tilt: TiltTrigger[];
  tiltRoll: number;
  /**
   * How long a tilt takes to arrive, in seconds, and optional where its
   * neighbours are required.
   *
   * Optional because setups published before it existed are sitting in R2 and
   * have to keep opening. Absent means the face's own default rather than zero —
   * `tiltSettle={session.tiltSettle}` hands undefined to a defaulted prop, which
   * is the whole mechanism and the reason this needs no migration.
   */
  tiltSettle?: number;
  /**
   * What share of the tilt's conversation events are taken, and of finished
   * answers that get a nod, and of blinks that carry a brow flash.
   *
   * Optional for `tiltSettle`'s reason and by the same mechanism — setups
   * published before these existed are in R2 and have to keep opening, and
   * undefined handed to a defaulted prop is the face's own default rather than
   * zero. Zero would be the worst possible reading of a missing rate: a session
   * with every gesture switched on and none of them ever firing.
   */
  tiltChance?: number;
  listenNod: boolean;
  nodDepth: number;
  nodChance?: number;
  browFlashChance?: number;

  /**
   * Turn-taking, and the reason this block is optional throughout.
   *
   * Absent means *do not send the field*, exactly as in settings.ts: the
   * difference between "leave the decision upstream" and "pin whatever the
   * default happens to be today" is one this type has to be able to express,
   * and an object with zeroes in it cannot. These are the knobs that matter
   * most to a learner, who pauses mid-clause to assemble the next one.
   */
  silenceDurationMs?: number;
  prefixPaddingMs?: number;
  startSensitivity?: 'START_SENSITIVITY_HIGH' | 'START_SENSITIVITY_LOW';
  endSensitivity?: 'END_SENSITIVITY_HIGH' | 'END_SENSITIVITY_LOW';
  affectiveDialog?: boolean;
  proactiveAudio?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface PublishedSetup extends PerformanceProfile {
  /** Six characters from lessonCodes.ts. Also the object key. */
  code: string;
  /** What the teacher called this setup. Never shown to the student. */
  label?: string;
  updatedAt: number;

  // --- What is being learned, and by whom it is said.
  /** The target language, ISO-639-1, resolved against languages.ts. */
  language: string;
  /** The composed system prompt. See the header on why it is not an id. */
  instructions: string;
  /** Prebuilt voice name, or empty for the provider's own default. */
  voice: string;
  /** A face in the shared library, or null for the deployment's own. */
  faceId: string | null;
  /** Which scale the end-of-call report reads against. */
  evaluatorId: string;

  // --- The lesson: what is being asked, and what the learner is told.
  //
  // BY VALUE, NOT BY ID, which is the opposite of `evaluatorId` directly above
  // and worth the paragraph. A scale is resolved server-side at report time
  // from a bucket the student never touches, so a reference is safe there. A
  // lesson is read by the student's own browser mid-call, and a reference would
  // mean a teacher editing next week's questions silently rewriting the screen
  // of somebody who is talking right now. So publishing copies the text, the
  // way it already composes `instructions` rather than storing a style id, and
  // for the same reason: what was handed out stays handed out.
  //
  // All optional, and read as "no lesson" when absent. Sessions published
  // before this existed are sitting in R2 and have to keep opening — the
  // mechanism `tiltSettle` documents above — and "no lesson" is a supported
  // conversation rather than a degraded one. See vocoSessions.ts.
  /**
   * The consigne, shown to the student verbatim. Never sent to the tutor.
   *
   * The tutor's copy of the lesson is already inside `instructions`, composed
   * at publish. This field exists so the student page can render the consigne
   * and the questions as a list rather than as a wall of prompt, which is the
   * whole reason they are stored structurally as well as composed.
   */
  brief?: string;
  /** What the report checks, one verdict per entry. */
  targets?: string[];
  /** Asked in this order. Also inside `instructions`. */
  questions?: string[];
  /**
   * Which Voco Session this came from, for the teacher's benefit only.
   *
   * Never resolved — nothing reads the library from a published setup, and the
   * id may name a Voco Session since deleted. It is here so a published setup
   * can say where its questions came from when somebody is working out which
   * lesson a code belongs to.
   */
  vocoSessionId?: string;
  vocoSessionName?: string;
}

const isString = (value: unknown): value is string => typeof value === 'string';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/**
 * Whether this setup carries a lesson.
 *
 * Questions rather than a brief, because they are what everything downstream
 * actually needs: a lesson with no consigne prose still gives the student a
 * list to answer and the tutor a list to work down, where a consigne with no
 * questions is a sentence about nothing. save.ts refuses the second case, and
 * this is the reading that agrees with it.
 *
 * Here rather than beside the panel that asks, so the one place that decides
 * what "has a lesson" means is the file that defines the field.
 */
export function hasLesson(setup: PublishedSetup | null | undefined): boolean {
  return !!setup?.questions?.length;
}

/**
 * Structural enough to publish, and no stricter.
 *
 * The same posture `looksLikeEvaluator` takes: this decides whether an object
 * is a published setup at all, not whether every enum inside it is one this
 * deployment knows. A motion nobody has heard of leaves the face on its
 * default, which is survivable; a missing `instructions` is a call with no
 * tutor in it, which is not. The narrow checks that matter — the language, the
 * evaluator, the code in an object key — are made where they are used, against
 * the lists that own them.
 */
export function looksLikeSetup(value: unknown): value is PublishedSetup {
  if (!value || typeof value !== 'object') return false;
  const setup = value as Partial<PublishedSetup>;

  return (
    isString(setup.code) &&
    LESSON_CODE.test(setup.code) &&
    typeof setup.updatedAt === 'number' &&
    isString(setup.language) &&
    isString(setup.instructions) &&
    setup.instructions.trim().length > 0 &&
    isString(setup.voice) &&
    (setup.faceId === null || isString(setup.faceId)) &&
    isString(setup.evaluatorId) &&
    // The lesson is optional throughout — a setup with no lesson is a
    // conversation, which is what every session before lessons existed was.
    (setup.brief === undefined || isString(setup.brief)) &&
    (setup.targets === undefined || isStringArray(setup.targets)) &&
    (setup.questions === undefined || isStringArray(setup.questions)) &&
    (setup.vocoSessionId === undefined || isString(setup.vocoSessionId)) &&
    (setup.vocoSessionName === undefined || isString(setup.vocoSessionName)) &&
    isString(setup.driver) &&
    typeof setup.lookaheadMs === 'number' &&
    isString(setup.roundness) &&
    isString(setup.motion) &&
    isString(setup.cadence) &&
    typeof setup.browBlink === 'boolean' &&
    isStringArray(setup.press) &&
    typeof setup.browLift === 'number' &&
    isStringArray(setup.tilt) &&
    typeof setup.tiltRoll === 'number' &&
    (setup.tiltSettle === undefined || typeof setup.tiltSettle === 'number') &&
    (setup.tiltChance === undefined || typeof setup.tiltChance === 'number') &&
    typeof setup.listenNod === 'boolean' &&
    typeof setup.nodDepth === 'number' &&
    (setup.nodChance === undefined || typeof setup.nodChance === 'number') &&
    (setup.browFlashChance === undefined || typeof setup.browFlashChance === 'number')
  );
}
