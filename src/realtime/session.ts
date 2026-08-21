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
 * THE LESSON TRAVELS AS DATA, AND THE PROMPT IS BUILT WHEN THE STUDENT DIALS.
 * The style and the persona travel as text rather than as ids, for the reason
 * they always did: a style lives in the house library, which a student's
 * browser has no business reading, and a persona lives in a kit that is
 * megabytes away in another bucket. What has changed is that this setup no
 * longer stores the *composed* prompt those pieces make.
 *
 * Storing the composition froze an agreement that only one side of could be
 * frozen. A published setup is what was handed out and never changes; the build
 * that answers it ships again every week. When the two stopped agreeing about
 * which tools a call declares, the stored prompt was still perfectly valid text
 * describing a protocol nothing implemented any more — and the conversation
 * went wrong in a way that read entirely as the model misbehaving. Composing at
 * dial time keeps everything a teacher decided frozen, and lets the half that
 * is really a protocol move with the code that implements it. See
 * composeTutorPrompt in tutorPrompt.ts.
 *
 * Deliberately free of DOM imports, and of anything that imports one:
 * functions/ compiles against workers-types with no DOM lib, and the routes
 * that read and write this are the ones that have to validate it. That rules
 * out visemes.ts — pure in itself, but it imports audio.ts, which is
 * AudioContext all the way down. headMotion.ts has no imports at all and is
 * safe to take the motion vocabulary from.
 */

import type { Persona } from '../facekit/persona';
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
  /**
   * Which live model the student page dials for this lesson.
   *
   * A key from models.ts, resolved at publish so that what is stored is a key
   * this build knew about at the moment a teacher chose it — the same copying
   * that `style` and `persona` get, and for the same reason.
   *
   * ALWAYS PRESENT ON A SETUP PUBLISHED SINCE THIS FIELD EXISTED, and absent on
   * every code handed out before. Absent reads as `defaultModelKey()`, which is
   * the model those lessons have been running on all along, so nothing already
   * in a classroom changed when the choice became a teacher's. Eleve.tsx does
   * that resolution; it is the one reader.
   *
   * NOT A SETTING, WHICH IS WHY IT IS NOT ON PerformanceProfile. Everything
   * there is a knob sent inside a setup frame and dropped by the sanitizer when
   * the model will not take it. This decides which model receives that frame at
   * all — and therefore which of those knobs survive it, which meter is spent,
   * and whether the page can count questions. See `teach` in models.ts.
   */
  modelKey?: string;
  /**
   * The tutor style, as the house library had it at the moment of publishing.
   *
   * Prose, not an id — see the header. What sort of tutor this is: the manner,
   * the register, the rules about speaking the language and keeping turns
   * short. It becomes the YOUR JOB section of the composed prompt and is the
   * one part of that prompt an administrator writes.
   *
   * Optional, and absent means the built-in conversational preset. That is not
   * a degraded lesson: setups published before this field existed stored a
   * composed prompt whose first section was very nearly that same text, so a
   * code handed out last term still opens onto a tutor of the same manner. See
   * defaultInstructions in instructions.ts.
   */
  style?: string;
  /**
   * How the tutor works its list, as the house library had it at publish.
   *
   * The other half of the lesson block, and the administrator’s in the same way
   * `style` is: prose, by value, frozen at this moment. It becomes the
   * paragraphs under the question list — how long to stay on an answer, how
   * many questions a turn may carry — and it is deliberately not the whole of
   * that section. What sits under it describes the tool this call declares and
   * the notes the page sends, which belong to the build and are composed fresh.
   * See DEFAULT_LESSON_RULES in tutorPrompt.ts, which is what an absent or
   * blank one composes.
   *
   * Optional, and absent means this build’s own text. That is not a degraded
   * lesson: every code published before this field existed ran on exactly that
   * text, so nothing already handed out changed when the block became editable.
   */
  lessonRules?: string;
  /**
   * The worn face's persona, copied out of its kit at publish time.
   *
   * By value for `style`'s reason, and read at publish rather than at dial for
   * a second one: a kit is several megabytes of artwork around one paragraph of
   * biography, and the student page fetches it for the drawing on a path that
   * is allowed to fail. A prompt that quietly loses its persona whenever the
   * face bucket is slow is a tutor that changes character for no reason anybody
   * could see.
   *
   * The composer takes the name and one sentence of it. See personaBlock.
   */
  persona?: Persona;
  /**
   * The composed system prompt, on setups published before there was a
   * composer to run at dial time.
   *
   * READ ON ONE PATH ONLY, AND IT IS THE PATH WITH NO LESSON ON IT. A setup
   * that carries questions is composed from the fields above and this is
   * ignored, so an old lesson gets today's protocol with its own questions and
   * its own targets — the whole point of the change, and why none of this needs
   * a migration. A setup with *no* questions is a conversation rather than a
   * lesson, which is what everything published before lessons existed is: there
   * is nothing to compose, and the prompt it went out with is still the right
   * one. See the composer in Eleve.tsx.
   *
   * @deprecated Nothing writes this. A lesson's prompt is composed at dial time.
   */
  instructions?: string;
  /**
   * Which generation of the tutor protocol the stored `instructions` were
   * composed against, on setups old enough to have any.
   *
   * IT EXISTED TO NAME A PROBLEM THAT NO LONGER HAPPENS. A stored prompt could
   * fall out of step with the build that ran it, and this stamp is what let the
   * diagnostic and the teacher's list say "republish this one" instead of
   * leaving somebody to work it back from a timeline. Composing at dial time
   * removes the gap, so nothing reads the stamp any more and nothing writes it.
   *
   * @deprecated Kept so rows that carry it still validate. Never set this.
   */
  composerVersion?: number;
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
   * The longest this conversation may run, in minutes.
   *
   * A CEILING AND NOT A LENGTH, and unlike the questions it is NOT also baked
   * into `instructions` — that asymmetry is the point rather than an oversight.
   * The tutor is told the questions twice because it has to ask them and the
   * student page has to list them. It is told the cap zero times, because a
   * model handed a length paces to fill it and the floor this replaced is
   * exactly what was being removed. See vocoSessions.ts above `MIN_CAP_MINUTES`.
   *
   * So this number exists for one reader: the student page, which runs the
   * clock and says into the conversation when it has run out. A timer cannot
   * read prose, and in this case nothing else is allowed to.
   *
   * Optional, and absent means DEFAULT_CAP_MINUTES — the mechanism `tiltSettle`
   * documents above. Setups published before there was a clock keep opening,
   * and get the default rather than zero, which would be a call that ends the
   * instant it connects.
   */
  capMinutes?: number;
  /**
   * What `capMinutes` was called when it was a length. Read, never written.
   *
   * Setups already in the bucket carry it, and `capMinutesOf` falls back to it
   * so a code handed out last week keeps working. Nothing writes it any more.
   *
   * @deprecated Read through `capMinutesOf`. Never set this.
   */
  lengthMinutes?: number;
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
 * default, which is survivable; a missing `code` is a row that cannot be
 * looked up, which is not. The narrow checks that matter — the language, the
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
    // Optional, all three: a setup published before the composer moved carries
    // an `instructions` and no `style`, and one published after carries the
    // reverse. Neither is a reason to refuse a lesson — see the fields.
    (setup.instructions === undefined || isString(setup.instructions)) &&
    (setup.style === undefined || isString(setup.style)) &&
    (setup.lessonRules === undefined || isString(setup.lessonRules)) &&
    (setup.persona === undefined || (!!setup.persona && typeof setup.persona === 'object')) &&
    // Absent is the common case and a legal one — every setup published before
    // the stamp existed. It must never be the reason a lesson stops opening:
    // the whole posture of this field is that a stale setup still teaches.
    (setup.composerVersion === undefined || typeof setup.composerVersion === 'number') &&
    isString(setup.voice) &&
    (setup.faceId === null || isString(setup.faceId)) &&
    isString(setup.evaluatorId) &&
    // The lesson is optional throughout — a setup with no lesson is a
    // conversation, which is what every session before lessons existed was.
    (setup.brief === undefined || isString(setup.brief)) &&
    (setup.targets === undefined || isStringArray(setup.targets)) &&
    (setup.questions === undefined || isStringArray(setup.questions)) &&
    (setup.capMinutes === undefined || typeof setup.capMinutes === 'number') &&
    (setup.lengthMinutes === undefined || typeof setup.lengthMinutes === 'number') &&
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
