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
  /** Asked in this order. See `lessonBlock` on how strictly. */
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

  /** Last written. Sorts the picker, so the ones in progress stay near. */
  updatedAt?: number;
}

/** A ceiling on one authored Voco Session, in characters of JSON. */
export const MAX_VOCO_SESSION = 20_000;

/** Long enough to be descriptive, short enough to fit the picker. */
export const MAX_VOCO_SESSION_NAME = 60;

/** More than this stops being a lesson and starts being a syllabus. */
export const MAX_QUESTIONS = 12;

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

/**
 * The lesson as the tutor reads it, appended to the composed instructions.
 *
 * WRITTEN AS TESTS, NOT AS JUDGEMENTS, for the reason `selective` and
 * `beginner` in instructions.ts are written that way: a rule asking a model to
 * decide whether it has done enough is one it stops applying three turns in,
 * and a rule giving it something to compare against survives. "Do not move on
 * until the learner has answered in at least a full sentence" is checkable
 * against the last turn; "make sure they answer properly" is not.
 *
 * ORDERED, WITH ROOM TO MOVE. The list is walked in order, and the tutor is
 * told in as many words both to come back after a tangent and to re-ask the
 * question when it does. The failure mode is not abandoning the list — it is
 * drifting off it and resuming from a question the learner has forgotten was
 * asked, which reads to them as the tutor losing the thread.
 *
 * THE TARGETS ARE STEERED TOWARDS, NEVER ANNOUNCED. The student has already
 * read the consigne on their own screen; a tutor that also says "now use the
 * passé composé" turns a conversation into an exercise, and a model handed a
 * grammar target will otherwise narrate it. The escape hatch — let a turn go if
 * it does not invite one — is what keeps the steering from eating the
 * conversation, and it gets its own sentence for the reason `selective` gives
 * its no-echo rule one: an exemption buried in a clause is dropped first.
 *
 * The brief is deliberately absent. See the header on who reads what.
 *
 * Appended after the persona wrap rather than merged into the style, which
 * puts it last in the composed prompt. That is where instructions.ts says a
 * constraint held across a whole call survives longest, and a question list
 * held for a whole call is exactly that.
 */
export function lessonBlock(lesson: Pick<VocoSession, 'questions' | 'targets'>): string {
  const questions = lesson.questions
    .map((question, index) => `${index + 1}. ${question}`)
    .join('\n');

  const targets = lesson.targets.length
    ? `

WHAT THE LEARNER IS PRACTISING
${lesson.targets.map((target) => `- ${target}`).join('\n')}

Steer towards these when a turn invites it: ask something whose natural answer
uses one, or use one yourself so they hear it. Never name a grammatical
structure out loud, and never tell the learner what they are practising — they
have already been told. If a turn does not invite one, let it go and carry on
talking.`
    : '';

  return `

THE QUESTIONS FOR THIS CONVERSATION
Work down this list in order, one at a time:

${questions}

Ask the question you are on, then talk about the answer the way a conversation
partner would rather than moving straight to the next one. Do not move on until
the learner has answered in at least a full sentence; if they answer in a word,
ask one follow-up about it first.

If they open a subject of their own, follow it for a turn or two and then come
back — and say the question again when you do, rather than assuming they
remember which one it was. Once every question has been answered, keep talking
about the same subjects instead of inventing new ones.${targets}`;
}
