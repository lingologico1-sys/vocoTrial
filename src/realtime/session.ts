/**
 * The published session: one tutor setup, as it travels from the workshop to a
 * student's browser.
 *
 * WHY THIS EXISTS AT ALL. liveTrial keeps its picks in localStorage, which
 * reaches exactly one browser. A student opening /eleve on their own laptop
 * would meet the defaults rather than the tutor that was tuned for them — a
 * different voice, a different face, a different prompt — and would have no way
 * of telling. So a setup is published to R2, the road faces and evaluators
 * already took, and the student page reads it back.
 *
 * KEYED BY CODE FROM THE START. There is no join-code feature yet: /eleve
 * follows a pointer to whichever setup was published last. But the storage is
 * laid out as though there were, because the alternative is a single object
 * whose key has to change the day a second tutor exists — and that is a
 * migration rather than a feature. See functions/api/sessions/_library.ts.
 *
 * THE INSTRUCTIONS TRAVEL AS TEXT, NOT AS A PRESET KEY. Presets live in
 * presets.ts, which is localStorage — so a key would name a prompt the
 * student's browser has never heard of and resolve to nothing. Publishing
 * renders the preset and the persona together and stores the result, which also
 * means a prompt edited after publishing does not silently change what a
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
 * The alphabet a code is drawn from.
 *
 * No O, no I, no 0 and no 1. A code is going to be read off a board and typed
 * by somebody who did not choose it, and those are the characters that get
 * mistyped for one another. Dropping them costs a little entropy per character
 * and buys a code that survives handwriting.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** `VOCO-XXXX`. Prefixed so a code is recognisable as one out of context. */
export function newSessionCode(): string {
  const random = new Uint32Array(4);
  crypto.getRandomValues(random);
  let body = '';
  for (const value of random) body += CODE_ALPHABET[value % CODE_ALPHABET.length];
  return `VOCO-${body}`;
}

/**
 * What a code may look like, for the routes that take one from a caller.
 *
 * Checked rather than trusted because a code becomes an R2 object key, and a
 * key assembled from unvalidated input is how a caller reads an object that is
 * none of their business. The shape is narrow on purpose: nothing matching this
 * can carry a slash or a dot segment.
 */
export const SESSION_CODE = /^VOCO-[A-Z0-9]{4,12}$/;

export interface StudentSession {
  /** `VOCO-XXXX`. Also the object key. */
  code: string;
  /** What the teacher called this setup. Never shown to the student. */
  label?: string;
  updatedAt: number;

  // --- What is being learned, and by whom it is said.
  /** The target language, ISO-639-1, resolved against languages.ts. */
  language: string;
  /** The rendered system prompt. See the header on why it is not a key. */
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
  // sheet is read by the student's own browser mid-lesson, and a reference
  // would mean a teacher editing next week's questions silently rewriting the
  // screen of somebody who is talking right now. So publishing copies the text,
  // the way it already renders `instructions` rather than storing a preset key,
  // and for the same reason: what was handed out stays handed out.
  //
  // All optional, and read as "no sheet" when absent. Sessions published before
  // this existed are sitting in R2 and have to keep opening — the mechanism
  // `tiltSettle` documents below — and "no sheet" is a supported lesson rather
  // than a degraded one. See sheets.ts.
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
   * Which sheet this came from, for the teacher's benefit only.
   *
   * Never resolved — nothing reads the library from a session, and the id may
   * name a sheet since deleted. It is here so a published setup can say where
   * its questions came from when somebody is working out which lesson a code
   * belongs to.
   */
  sheetId?: string;
  sheetName?: string;

  // --- How the face performs. Verbatim from liveTrial's own prefs, because
  // --- the whole point is that the student meets what was tuned rather than a
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

/** The pointer at whichever setup was published last. */
export interface CurrentPointer {
  code: string;
}

/**
 * Whether this setup carries a lesson.
 *
 * Questions rather than a brief, because they are what everything downstream
 * actually needs: a sheet with no consigne prose still gives the student a list
 * to answer and the tutor a list to work down, where a consigne with no
 * questions is a sentence about nothing. save.ts refuses the second case, and
 * this is the reading that agrees with it.
 *
 * Here rather than beside the panel that asks, so the one place that decides
 * what "has a lesson" means is the file that defines the field.
 */
export function hasLesson(session: StudentSession | null | undefined): boolean {
  return !!session?.questions?.length;
}

const isString = (value: unknown): value is string => typeof value === 'string';

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

/**
 * Structural enough to publish, and no stricter.
 *
 * The same posture `looksLikeEvaluator` takes: this decides whether an object
 * is a session at all, not whether every enum inside it is one this deployment
 * knows. A motion nobody has heard of leaves the face on its default, which is
 * survivable; a missing `instructions` is a call with no tutor in it, which is
 * not. The narrow checks that matter — the language, the evaluator, the code in
 * an object key — are made where they are used, against the lists that own
 * them.
 */
export function looksLikeSession(value: unknown): value is StudentSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<StudentSession>;

  return (
    isString(session.code) &&
    SESSION_CODE.test(session.code) &&
    typeof session.updatedAt === 'number' &&
    isString(session.language) &&
    isString(session.instructions) &&
    session.instructions.trim().length > 0 &&
    isString(session.voice) &&
    (session.faceId === null || isString(session.faceId)) &&
    isString(session.evaluatorId) &&
    // The lesson is optional throughout — a session with no sheet is a
    // conversation, which is what every session before sheets existed was.
    (session.brief === undefined || isString(session.brief)) &&
    (session.targets === undefined || isStringArray(session.targets)) &&
    (session.questions === undefined || isStringArray(session.questions)) &&
    (session.sheetId === undefined || isString(session.sheetId)) &&
    (session.sheetName === undefined || isString(session.sheetName)) &&
    isString(session.driver) &&
    typeof session.lookaheadMs === 'number' &&
    isString(session.roundness) &&
    isString(session.motion) &&
    isString(session.cadence) &&
    typeof session.browBlink === 'boolean' &&
    isStringArray(session.press) &&
    typeof session.browLift === 'number' &&
    isStringArray(session.tilt) &&
    typeof session.tiltRoll === 'number' &&
    (session.tiltSettle === undefined || typeof session.tiltSettle === 'number') &&
    (session.tiltChance === undefined || typeof session.tiltChance === 'number') &&
    typeof session.listenNod === 'boolean' &&
    typeof session.nodDepth === 'number' &&
    (session.nodChance === undefined || typeof session.nodChance === 'number') &&
    (session.browFlashChance === undefined || typeof session.browFlashChance === 'number')
  );
}
