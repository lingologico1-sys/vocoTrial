/**
 * The house settings: what an administrator decides once, for every teacher.
 *
 * WHY THERE IS SUCH A THING NOW. /teach is a teacher's page and studio is an
 * administrator's, and publishing moved from the second to the first. That
 * left two things stranded on the wrong side of the line. A published setup
 * carries a system prompt, which used to be a studio preset rendered out of one
 * browser's localStorage; and it carries twenty-odd knobs describing how the
 * face moves and how the call takes turns, which used to be whatever studio had
 * on screen. A teacher has neither, and should not be asked to acquire them.
 *
 * So an administrator publishes both here, and /teach spends them without ever
 * seeing them:
 *
 *   tutor styles   named manners a teacher picks between
 *   performance    one profile every publish carries
 *
 * A TUTOR STYLE IS A RENDERED PROMPT, NOT A PRESET KEY, for sessionStore's
 * reason one level up: presets.ts is localStorage, so a key names a prompt the
 * teacher's browser has never heard of. Studio renders its current preset
 * against the language picker and publishes the text, which is the same move
 * publishing already makes for a student and for the same reason.
 *
 * THE STYLE IS NOT THE WHOLE PROMPT. The persona wrap depends on which face is
 * worn, and the lesson block depends on which questions are asked — neither of
 * which studio knows when a style is saved. Composition happens at publish, in
 * the route, where all three are in hand. See functions/api/sessions/publish.ts.
 *
 * ONE PROFILE, NOT A LIBRARY OF THEM, which is the asymmetry with styles worth
 * naming. A manner is a pedagogical choice a teacher should make per lesson —
 * patient with beginners, brisk for revision. How high a brow lifts is not: it
 * is a property of how this deployment's faces are drawn, tuned once by whoever
 * drew them, and offering a teacher a menu of it would be offering a choice
 * they have no grounds to make.
 *
 * Deliberately free of DOM imports, for session.ts's reason: the routes that
 * read and write this are Workers.
 */

import type { PerformanceProfile } from './session';

/** One named manner, as a teacher picks it. */
export interface TutorStyle {
  id: string;
  /** What /teach's picker shows. */
  name: string;
  /** One line on when to reach for this one. Shown under the picker. */
  note: string;
  /**
   * The rendered prompt. Composed into the tutor's instructions at publish.
   *
   * Rendered against a language when it was saved, which is why /teach shows
   * the style's own language beside it: a style written out in French and
   * published on a Spanish lesson is a mismatch the picker should make visible
   * rather than one the call discovers.
   */
  text: string;
  /** The language it was rendered for, ISO-639-1. See `text`. */
  language: string;
  /** Last written. Sorts the picker, newest first. */
  updatedAt?: number;
}

/** A ceiling on one style, in characters. Mirrors MAX_INSTRUCTIONS. */
export const MAX_STYLE_TEXT = 12_000;

/** Long enough to describe a manner, short enough to fit the picker. */
export const MAX_STYLE_NAME = 60;

/** More styles than a teacher can hold in their head at a picker. */
export const MAX_STYLES = 12;

/** Time for ordering, entropy so two saves in one millisecond stay distinct. */
export function newStyleId(): string {
  return `style:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Shape check shared by the save route and the picker. */
export function looksLikeStyle(value: unknown): value is TutorStyle {
  if (!value || typeof value !== 'object') return false;
  const style = value as Partial<TutorStyle>;

  return (
    typeof style.id === 'string' &&
    style.id.length > 0 &&
    typeof style.name === 'string' &&
    typeof style.text === 'string' &&
    style.text.trim().length > 0 &&
    typeof style.language === 'string'
  );
}

/**
 * The two constants this file wants and cannot import, kept as literals.
 *
 * Both live in visemes.ts, which reaches audio.ts and is AudioContext all the
 * way down — the same wall session.ts hits restating the mouth unions, and a
 * Worker importing it does not compile. So they are written out again, and
 * houseStore.ts asserts on the browser side that the copies still agree.
 *
 * Separate consts rather than values inlined below, because
 * `FALLBACK_PERFORMANCE` is annotated `PerformanceProfile` and an annotation
 * widens `80` to `number` — which would leave that guard comparing `number`
 * against `number` and passing whatever either file happened to say. Declared
 * here they keep their literal types, and the guard has something to compare.
 */
export const FALLBACK_ROUNDNESS = 'auto';
export const FALLBACK_LOOKAHEAD_MS = 80;

/**
 * What a publish carries when no administrator has saved a profile.
 *
 * NOT A SECOND SET OF DEFAULTS. Every value here is the constant the face
 * already defaults to — so a deployment with an empty house bucket publishes
 * exactly the face the code ships with, rather than a plausible-looking
 * neighbour of it. The two that had to be restated are directly above; the rest
 * are headMotion.ts's own, which has no imports at all and could have been
 * imported, but a profile assembled half from imports and half from literals
 * reads as though the halves differed. They do not: change one in headMotion.ts
 * and this is the file to change with it.
 *
 * The turn-taking block is deliberately absent rather than filled in. Absent
 * means "leave the decision upstream", which is a thing this type can express
 * and a zeroed object cannot — see PerformanceProfile.
 */
export const FALLBACK_PERFORMANCE: PerformanceProfile = {
  driver: 'scheduled',
  lookaheadMs: FALLBACK_LOOKAHEAD_MS,
  roundness: FALLBACK_ROUNDNESS,
  motion: 'rise',
  cadence: 'phrase',
  browBlink: true,
  press: ['turn', 'reply', 'waiting'],
  browLift: 6,
  tilt: ['question'],
  tiltRoll: 1.2,
  tiltSettle: undefined,
  tiltChance: 0.35,
  listenNod: true,
  nodDepth: 1.5,
  nodChance: 0.35,
  browFlashChance: 0.25,
};

/**
 * Structural enough to publish with, and no stricter.
 *
 * The posture `looksLikeSetup` takes, for the same reason: a motion nobody has
 * heard of leaves the face on its own default, which is survivable. What is not
 * survivable is a profile with no `driver` at all, because that is a mouth with
 * nothing driving it.
 */
export function looksLikePerformance(value: unknown): value is PerformanceProfile {
  if (!value || typeof value !== 'object') return false;
  const profile = value as Partial<PerformanceProfile>;

  return (
    typeof profile.driver === 'string' &&
    typeof profile.lookaheadMs === 'number' &&
    typeof profile.roundness === 'string' &&
    typeof profile.motion === 'string' &&
    typeof profile.cadence === 'string' &&
    typeof profile.browBlink === 'boolean' &&
    Array.isArray(profile.press) &&
    typeof profile.browLift === 'number' &&
    Array.isArray(profile.tilt) &&
    typeof profile.tiltRoll === 'number' &&
    typeof profile.listenNod === 'boolean' &&
    typeof profile.nodDepth === 'number'
  );
}
