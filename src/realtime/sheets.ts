/**
 * Question sheets: the questions a session is built around, and the consigne
 * the learner is handed with them.
 *
 * WHAT A SHEET IS. One lesson's worth of material — a few questions on a theme,
 * a consigne written to the student, and the structures the teacher wants to
 * hear. It is the thing a teacher prepares before a lesson and reuses next
 * year, which is why it is a library rather than a field on a session.
 *
 * IT IS AN EVALUATOR, NOT A PRESET, and that decides where it lives. Both are
 * authored text, but a preset is the author's own workshop note and stays in
 * localStorage; a sheet is student-facing material that has to reach a browser
 * which has never met the workshop. That is the journey faces and evaluators
 * already made, so this takes their road: R2, one object, read by id. See
 * functions/api/sheets/.
 *
 * THERE IS NO BUILT-IN, unlike evaluators.ts, and the asymmetry is the point. A
 * report with no scale cannot be written at all, so a scale ships in the app. A
 * conversation with no questions is just a conversation — which is what every
 * session before this feature was, and what a session published with no sheet
 * still is. "None" is a supported answer here, and nothing downstream may
 * assume otherwise.
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

/** One prepared lesson. */
export interface QuestionSheet {
  id: string;
  /** What the picker shows. Teacher-facing; never reaches the student. */
  name: string;
  /** One line under the picker, on what this sheet is for. Teacher-facing. */
  note: string;
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
  /** Asked in this order. See `sheetBlock` on how strictly. */
  questions: string[];
  /** Last written. Sorts the picker, so the ones in progress stay near. */
  updatedAt?: number;
}

/** A ceiling on one authored sheet, in characters of JSON. */
export const MAX_SHEET = 20_000;

/** Long enough to be descriptive, short enough to fit the picker. */
export const MAX_SHEET_NAME = 60;

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
export function newSheetId(): string {
  return `sheet:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * The editor's format for a list: one entry per line.
 *
 * Not parseBands' shape, because there is no nesting to express. A question is
 * a line and a target is a line, so the parse is a split, and the failures
 * worth reporting are the counted ceilings above rather than a syntax.
 *
 * Leading bullets and numbers are stripped rather than rejected. A teacher
 * pastes a numbered list out of a worksheet, and a sheet that then renders
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
export function looksLikeSheet(value: unknown): value is QuestionSheet {
  if (!value || typeof value !== 'object') return false;
  const sheet = value as Partial<QuestionSheet>;
  const strings = (list: unknown): list is string[] =>
    Array.isArray(list) && list.every((entry) => typeof entry === 'string');

  return (
    typeof sheet.id === 'string' &&
    sheet.id.length > 0 &&
    typeof sheet.name === 'string' &&
    typeof sheet.brief === 'string' &&
    strings(sheet.targets) &&
    strings(sheet.questions) &&
    sheet.questions.length > 0
  );
}

/**
 * The sheet as the tutor reads it, appended to the composed instructions.
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
 * Appended after the persona wrap rather than merged into the preset, which
 * puts it last in the composed prompt. That is where instructions.ts says a
 * constraint held across a whole call survives longest, and a question list
 * held for a whole call is exactly that.
 */
export function sheetBlock(sheet: QuestionSheet): string {
  const questions = sheet.questions
    .map((question, index) => `${index + 1}. ${question}`)
    .join('\n');

  const targets = sheet.targets.length
    ? `

WHAT THE LEARNER IS PRACTISING
${sheet.targets.map((target) => `- ${target}`).join('\n')}

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
