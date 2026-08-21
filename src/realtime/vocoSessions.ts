/**
 * The Voco Session: one prepared tutoring session, as a teacher writes it.
 *
 * WHAT IT IS. Everything one lesson needs — a few questions on a theme, the
 * consigne the learner is handed with them, the structures the teacher wants to
 * hear, and the tutor that will ask them: a language, a manner, a face and the
 * scale the report reads against. It is the thing a teacher prepares before a
 * lesson and reuses next year, which is why it is a library rather than a field
 * on anything.
 *
 * IT USED TO BE CALLED A SHEET, and held only the lesson half. The tutor half
 * was picked separately in studio at publish time and never saved, so reopening
 * last week's material meant re-choosing the face from memory. Folding the two
 * together is what makes /teach a page a teacher can finish on: one object,
 * authored once, published as often as there are classes.
 *
 * THERE IS NO VOICE HERE, and its absence is a decision rather than an
 * oversight. This object briefly carried one, beside `faceId` and chosen from
 * the same page — which made the voice a teacher's to pick and the face an
 * administrator's to author, so the paragraph saying "my name is Marta, I'm 34"
 * and the voice delivering it could be chosen by two people who never spoke.
 * The voice now lives on the kit's persona, where the bio is, and the publish
 * route reads both out of it together. See functions/api/sessions/publish.ts.
 *
 * Rows saved while the field existed still hold a stale `voice` string. Nothing
 * reads it and the save route stops rewriting it, so it drains on the next save
 * — a dead key in R2 is cheaper than a migration over a field that no longer
 * decides anything.
 *
 * IT IS AUTHORED HERE AND PUBLISHED ELSEWHERE, and the two are different
 * objects on purpose. Publishing snapshots a Voco Session into a `PublishedSetup`
 * under a code — see session.ts — so a teacher editing next week's questions
 * cannot rewrite the screen of somebody who is talking right now. This file is
 * the filing cabinet; that one is what was handed out.
 *
 * THERE IS NO BUILT-IN, unlike evaluators.ts, and the asymmetry is the point. A
 * report with no scale cannot be written at all, so a scale ships in the app. A
 * conversation with no questions is just a conversation — which is what every
 * session before this feature was. "No lesson" is a supported answer downstream
 * and nothing may assume otherwise; what is *not* supported is a saved Voco
 * Session with no questions, because that is a filing cabinet entry about
 * nothing. See `looksLikeVocoSession`.
 *
 * THE PROSE AND THE TARGETS GO TO DIFFERENT READERS, which is the one thing in
 * this file worth reading twice.
 *
 *   brief      to the student, verbatim, on screen. Never to the tutor.
 *   targets    to the tutor and to the report. Never read out on the call.
 *   questions  to both.
 *
 * The prose is addressed to the learner — "Réponds aux questions suivantes" is
 * an instruction to the person answering, and handing it to the tutor gives a
 * model an instruction meant for somebody else, which these models will act on.
 * The targets are the machine-readable half of the same intent: they are what
 * the tutor steers towards and what the report checks, and they are the reason
 * the report can return a verdict per target rather than a paragraph of
 * judgement about a paragraph of prose.
 *
 * Deliberately free of DOM imports, and of anything that imports one, for
 * session.ts's reason: functions/ compiles against workers-types with no DOM
 * lib, and the routes that read and write this are the ones that validate it.
 */

import type { Patience } from './settings';

/** One prepared tutoring session. */
export interface VocoSession {
  id: string;
  /** What the picker shows. Teacher-facing; never reaches the student. */
  name: string;
  /** One line under the picker, on what this session is for. Teacher-facing. */
  note: string;

  // --- The lesson: what is asked, and what the learner is told.

  /**
   * The consigne, in the target language, shown to the student verbatim.
   *
   * Authored text, so it cannot follow the language picker the way a built-in
   * preset can — the same limitation presets.ts documents for saved prompts,
   * and for the same reason: rewriting somebody's own words on a dropdown
   * change is worse than leaving them alone.
   */
  brief: string;
  /**
   * What the learner is meant to produce, one per entry.
   *
   * Short and nameable — 'passé composé', 'a subordinate clause'. The tutor
   * steers towards these and the report returns one verdict per entry, so an
   * entry that is really three things comes back as one unreadable verdict.
   */
  targets: string[];
  /** Asked in this order. See `composeTutorPrompt` on how strictly. */
  questions: string[];

  // --- The tutor: who asks them, and how the answer is marked.
  //
  // ALL OPTIONAL, AND ABSENT MEANS THE DEFAULT — the mechanism session.ts
  // documents on `tiltSettle`, for the same reason. Sheets authored before
  // these fields existed are sitting in R2 and have to keep opening, and a
  // Voco Session that has never been through /teach's tutor half is a lesson
  // with no tutor picked rather than a broken row. /teach fills them in on the
  // first save; `publishRequest` below decides what an absent one means.

  /** The target language, ISO-639-1, resolved against languages.ts. */
  language?: string;
  /**
   * Which admin-published tutor style the call runs.
   *
   * A style is a rendered prompt in the house library, not text held here —
   * teachers pick a manner, they do not write one. Absent, or naming a style
   * since deleted, publishes the house's first style; see the publish route,
   * which is where that resolution happens because it is where the library is.
   */
  styleId?: string;
  /**
   * A face in the shared library, or null for the deployment's own.
   *
   * Carries the voice with it. The kit's persona names one and the publish
   * route spends it, so this single pick is the whole of who the student meets
   * — see the header on why there is no `voice` beside it.
   */
  faceId?: string | null;
  /** Which scale the end-of-call report reads against. */
  evaluatorId?: string;
  /**
   * The longest this conversation may run, in minutes.
   *
   * A CEILING AND NOT A LENGTH. The lesson ends when its questions are
   * answered; this is only what stops a call that never gets there from running
   * on the meter. See the long note above `MIN_CAP_MINUTES` for why the floor
   * that used to live in this field had to go, and why the tutor is never told
   * this number.
   *
   * Absent means DEFAULT_CAP_MINUTES, by the mechanism session.ts documents on
   * `tiltSettle`: rows written before this field existed have to keep opening,
   * and a lesson with no cap is one nobody set rather than one of length zero.
   */
  capMinutes?: number;
  /**
   * What `capMinutes` was called when it was a length. Read, never written.
   *
   * Kept as a field rather than migrated, the way the header describes for
   * `voice`: `capMinutesOf` falls back to it so last term's lessons keep
   * opening, and the first save through /teach writes a `capMinutes` and drops
   * it. A dead key in R2 is cheaper than a migration over a number that now
   * means something slightly different anyway.
   *
   * @deprecated Read through `capMinutesOf`. Never set this.
   */
  lengthMinutes?: number;

  /**
   * How long the tutor waits before deciding the learner has finished talking.
   *
   * THE ONE PROVIDER SETTING A TEACHER GETS, and it is here rather than in the
   * house profile because it is the one that belongs to the class rather than
   * to the deployment. Turn-taking was left entirely to Google until now — the
   * diagnostic's "left unsent, so the provider decides" line covered all four
   * knobs — which is the right default for a workshop and the wrong one for a
   * room of beginners who pause mid-clause and get answered over.
   *
   * A word rather than milliseconds: see `PATIENCE` in settings.ts, which owns
   * the two knobs each word spends. Absent means 'standard', which sends
   * nothing at all and is exactly what every lesson published before this
   * existed did — the mechanism session.ts documents on `tiltSettle`. /teach
   * opens a new lesson on 'patient' instead, because a new lesson has no
   * behaviour to preserve.
   */
  patience?: Patience;

  /** Last written. Sorts the picker, so the ones in progress stay near. */
  updatedAt?: number;
}

/** A ceiling on one authored Voco Session, in characters of JSON. */
export const MAX_VOCO_SESSION = 20_000;

/** Long enough to be descriptive, short enough to fit the picker. */
export const MAX_VOCO_SESSION_NAME = 60;

/**
 * More than this stops being a lesson and starts being a syllabus.
 *
 * TWENTY, RAISED FROM FIFTEEN when the questions became the bound. Fifteen was
 * never a judgement about lists — it was arithmetic on the clock: at the old
 * MAX_MINUTES and a full list a question got forty seconds, which is about as
 * short as a question with a follow-up can honestly be. A conversation no
 * longer runs to a clock, so that sum has nothing left to protect and the
 * ceiling is free to be what it says it is.
 *
 * Nothing technical binds it. Twenty questions is under two thousand characters
 * against MAX_INSTRUCTIONS' eight thousand, and a rounding error against
 * MAX_VOCO_SESSION. What twenty costs is a learner's attention, and the clock
 * used to be what protected that — so the number is now the teacher's
 * judgement, and /teach says out loud what a list this long implies in minutes
 * rather than leaving them to find out. See Teach.tsx.
 */
export const MAX_QUESTIONS = 20;

/**
 * How many empty question rows /teach opens with.
 *
 * Not MAX_QUESTIONS. Twenty empty boxes on a new lesson is a wall of nothing to
 * scroll past, and most lessons are four to six questions — so the editor opens
 * at five and grows on a button. See Teach.tsx.
 */
export const DEFAULT_QUESTION_ROWS = 5;

/**
 * THE CAP IS A CEILING AND NOTHING ELSE, which is the change this file turns on.
 *
 * `lengthMinutes` used to be both floor and ceiling, and said so: the tutor was
 * told to keep the conversation alive until the number was reached and to begin
 * closing when it was. That floor is what invented questions. A tutor which
 * finished the list with time still on the clock had to produce more
 * conversation from somewhere, so it improvised — and the improvised half is
 * the half the learner never prepared, has no vocabulary for, and may not even
 * understand. It is also the half the report cannot read fairly: the targets
 * were written for the teacher's questions, so an improvised turn invites none
 * of them, and the learner's weakest stretch of speech ends up being the
 * stretch that had nothing to do with the lesson. Removing the floor removes
 * all of that in one move. See `composeTutorPrompt` in tutorPrompt.ts.
 *
 * WHAT IS LEFT IS A COST BOUND. A lesson ends when its questions are answered;
 * the cap is what stops a call that will never answer them — a tutor
 * under-reporting its progress, a learner who has gone quiet, a socket nobody
 * hung up on — from running on the meter. It should rarely be the thing that
 * ends a lesson, and when it is, it ends it with a goodbye rather than a cut.
 * See TIME_UP_SIGNAL and Eleve.tsx.
 *
 * THE TUTOR IS NEVER TOLD THIS NUMBER, and that is a rule rather than an
 * omission to tidy up later. A model handed a length paces to fill it: told it
 * has twenty minutes it will stretch eight questions across twenty rather than
 * ask eight questions and stop. The floor would come straight back in prose,
 * through the back door. The client owns the cap and nothing upstream knows it
 * exists — `composeTutorPrompt` takes no minutes at all, which enforces it.
 */

/** Short, but still a conversation. Below this a cap would cut good lessons. */
export const MIN_CAP_MINUTES = 5;

/**
 * Thirty, raised from ten, because twenty questions cannot happen in ten.
 *
 * A question asked properly — asked, answered in a full sentence, one follow-up,
 * a remark about the answer — is a minute and a half at conversational pace, so
 * a full list is about half an hour of talking. Ten was a fair ceiling when a
 * lesson was six questions and the clock was the point. Against MAX_QUESTIONS
 * it would be a guillotine through the middle of every long lesson, which is
 * the one thing a backstop must never be.
 */
export const MAX_CAP_MINUTES = 30;

/**
 * What a new lesson opens at.
 *
 * NOT THE FLOOR, unlike the length it replaces, and the inversion is the whole
 * of it. A default set too low truncates lessons; a default set too high costs
 * nothing, because a cap is only spent when it is actually reached and a lesson
 * that finishes its questions ends long before. Fifteen covers about ten
 * questions at pace, and a teacher writing a longer list is told to raise it.
 */
export const DEFAULT_CAP_MINUTES = 15;

/**
 * What one question really takes, asked properly.
 *
 * Used to warn a teacher and never to pace a tutor — see the note above on why
 * no number resembling this one may reach the model. It is the same figure the
 * MAX_CAP_MINUTES comment reasons with, named once so /teach's arithmetic and
 * that argument cannot drift apart.
 */
export const MINUTES_A_QUESTION = 1.5;

/**
 * The teacher's cap, clamped. Absent, absurd and out-of-range all land here.
 *
 * `lengthMinutes` is what rows written before the cap existed carry, and
 * reading it as a ceiling reinterprets it — it was a length. The
 * reinterpretation is safe in the only direction it can move: an old ten-minute
 * lesson now ends when its questions run out and still stops at ten if they
 * never do, so nothing that used to fit stops fitting.
 */
export function capMinutesOf(
  session: Pick<VocoSession, 'capMinutes' | 'lengthMinutes'>,
): number {
  const asked = session.capMinutes ?? session.lengthMinutes;
  if (typeof asked !== 'number' || !Number.isFinite(asked)) return DEFAULT_CAP_MINUTES;
  return Math.min(MAX_CAP_MINUTES, Math.max(MIN_CAP_MINUTES, Math.round(asked)));
}

/** True when the cap will land mid-list rather than after it. /teach says so. */
export function capLooksTight(questionCount: number, capMinutes: number): boolean {
  return questionCount > 0 && capMinutes < questionCount * MINUTES_A_QUESTION;
}

/**
 * More targets than one conversation can evidence.
 *
 * Six is already generous: each becomes a row in the report that has to come
 * back met or not, and a target with no evidence reads to a learner as a
 * failure rather than as a conversation that went elsewhere. The ceiling is
 * here to stop a term's worth of grammar landing in one lesson.
 */
export const MAX_TARGETS = 6;

/** The consigne is read on a phone-width panel. This is about a paragraph. */
export const MAX_BRIEF = 600;

/** Time for ordering, entropy so two saves in one millisecond stay distinct. */
export function newVocoSessionId(): string {
  return `voco:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The editor's format for a list: one entry per line.
 *
 * Not parseBands' shape, because there is no nesting to express. A question is
 * a line and a target is a line, so the parse is a split, and the failures
 * worth reporting are the counted ceilings above rather than a syntax.
 *
 * Leading bullets and numbers are stripped rather than rejected. A teacher
 * pastes a numbered list out of a worksheet, and a lesson that then renders
 * "1. 1. Qu'as-tu fait" is the app being pedantic about something it can
 * simply handle.
 */
export function splitLines(text: string, limit: number): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

export const joinLines = (entries: string[]): string => entries.join('\n');

/** Shape check shared by the save route and the picker. */
export function looksLikeVocoSession(value: unknown): value is VocoSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<VocoSession>;
  const strings = (list: unknown): list is string[] =>
    Array.isArray(list) && list.every((entry) => typeof entry === 'string');

  return (
    typeof session.id === 'string' &&
    session.id.length > 0 &&
    typeof session.name === 'string' &&
    typeof session.brief === 'string' &&
    strings(session.targets) &&
    strings(session.questions) &&
    session.questions.length > 0
  );
}
