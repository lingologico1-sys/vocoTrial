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
  /**
   * How long the conversation should run, in minutes.
   *
   * ONE NUMBER, NOT TWO, and it is both a floor and a ceiling. The tutor is
   * told to keep the conversation alive until it is reached — inventing
   * questions of its own once the list runs out — and to begin closing when it
   * is. A separate "at least" and "at most" would be two numbers a teacher has
   * to reason about to describe one lesson slot.
   *
   * Absent means DEFAULT_MINUTES, by the mechanism session.ts documents on
   * `tiltSettle`: rows written before this field existed have to keep opening,
   * and a lesson with no length is one nobody set rather than one of length
   * zero.
   */
  lengthMinutes?: number;

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
 * Fifteen, raised from twelve when the editor stopped being one textarea. The
 * number is editorial rather than technical and always has been — fifteen
 * questions is well under a thousand characters against MAX_INSTRUCTIONS'
 * eight thousand, so nothing here is protecting a budget. What it protects is
 * the clock: at MAX_MINUTES and a full list, a question gets forty seconds,
 * which is about as short as a question with a follow-up can honestly be.
 */
export const MAX_QUESTIONS = 15;

/**
 * How many empty question rows /teach opens with.
 *
 * Not MAX_QUESTIONS. Fifteen empty boxes on a new lesson is a wall of nothing
 * to scroll past, and most lessons are four to six questions — so the editor
 * opens at five and grows on a button. See Teach.tsx.
 */
export const DEFAULT_QUESTION_ROWS = 5;

/**
 * The shortest conversation worth reading, in minutes.
 *
 * FIVE, NOT THREE, and the difference is the point. What a level judgement
 * needs is *learner* speech, and in a conversation where the tutor discusses
 * each answer and asks a follow-up the learner's share is realistically 35-50%
 * of the clock — so three minutes elapsed is a minute and a half of talking,
 * about one exam long-turn. Five buys somewhere near two and a half, which is
 * thin but readable. For scale, DELF A2's speaking test runs 6-8 minutes and
 * B1's about 15.
 *
 * Above MIN_EVAL_MS in Eleve.tsx, which refuses to write an evaluation under
 * two minutes, and deliberately so: the shortest lesson a teacher can set still
 * clears the bar the student page sets for reading it.
 */
export const MIN_MINUTES = 5;

/** Longer than a slot a tutor holds a single learner's attention for. */
export const MAX_MINUTES = 10;

/** What a new lesson opens at. The floor, so raising it is deliberate. */
export const DEFAULT_MINUTES = MIN_MINUTES;

/** The teacher's number, clamped. Absent, absurd and out-of-range all land here. */
export function minutesOf(session: Pick<VocoSession, 'lengthMinutes'>): number {
  const asked = session.lengthMinutes;
  if (typeof asked !== 'number' || !Number.isFinite(asked)) return DEFAULT_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(asked)));
}

/** The tool the tutor reports progress through. See `lessonBlock`. */
export const ANSWERED_TOOL = 'questionAnswered';

/**
 * What the page says to the tutor when the lesson's minutes are up.
 *
 * A CONSTANT BECAUSE TWO PLACES HAVE TO AGREE. `lessonBlock` tells the tutor to
 * expect these exact words and the student page sends them; a rewording of
 * either alone is a tutor that never closes, which nothing would report — the
 * call would simply run to the idle timeout instead.
 *
 * Marked as a note rather than phrased as speech. It arrives through
 * `clientContent`, whose only available role is `user`, so without the marker
 * it reads as the learner suddenly saying "the time is up" in English — and a
 * tutor that believes that will answer it out loud.
 */
export const TIME_UP_SIGNAL =
  '[NOTE FROM THE SYSTEM, NOT FROM THE LEARNER — do not answer it or read it out] The time is up. Close the conversation now, exactly as described under HOW THIS ENDS.';

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
 * EVERY TURN ENDS ON A QUESTION, and it is stated as a rule with one written
 * exemption rather than as a preference. Keeping a conversation alive is the
 * tutor's job and not the learner's: a tutor that trails off leaves a beginner
 * holding a silence they do not have the language to fill, and the silence
 * reads to them as their own failure. The exemption is the closing turn, which
 * has to be exempt or the conversation cannot end at all.
 *
 * THE LIST RUNNING OUT IS NOT THE END. This block used to say "keep talking
 * about the same subjects instead of inventing new ones", which was written
 * when a conversation ended whenever the learner stopped it. There is a clock
 * now, and a tutor that has run out of list before it has run out of time has
 * to produce more conversation — so the instruction is reversed, with the
 * preference for subjects already raised kept as a preference.
 *
 * THE TIME IS GIVEN AS A BUDGET, NOT AS A CLOCK. A model cannot see elapsed
 * time and will invent it if asked to track it, so it is told how long it has
 * and roughly what that buys per question, which is a pacing instruction it can
 * follow. What it is never told is what time it is now. The client owns the
 * clock and says when to close — see Eleve.tsx.
 *
 * PROGRESS IS REPORTED THROUGH A TOOL, which is the only structured channel
 * this app has into a call. Nothing else could carry it: the transcript is
 * untyped text, and a spoken marker would be a marker the tutor eventually says
 * out loud. Under-reporting is the expected failure and is designed around
 * rather than prevented — the count never goes backwards, and the end-of-call
 * report reads the transcript and is the authority on what was really covered.
 *
 * The brief is deliberately absent. See the header on who reads what.
 *
 * Appended after the persona wrap rather than merged into the style, which
 * puts it last in the composed prompt. That is where instructions.ts says a
 * constraint held across a whole call survives longest, and a question list
 * held for a whole call is exactly that.
 */
export function lessonBlock(
  lesson: Pick<VocoSession, 'questions' | 'targets' | 'lengthMinutes'>,
): string {
  const questions = lesson.questions
    .map((question, index) => `${index + 1}. ${question}`)
    .join('\n');

  const minutes = minutesOf(lesson);

  /*
   * Rounded to half a minute and floored at one, because the number exists to
   * set a pace rather than to be obeyed. "About 0.7 minutes each" is a false
   * precision a model will try to honour by clipping answers short.
   */
  const each = Math.max(1, Math.round((minutes / Math.max(1, lesson.questions.length)) * 2) / 2);

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
remember which one it was.

ALWAYS END YOUR TURN WITH A QUESTION
Whatever else a turn contains, the last thing you say is something for the
learner to answer. Keeping the conversation going is your job and not theirs —
never hand them a silence to fill. The single exception is the closing turn
described under HOW THIS ENDS.

HOW LONG THIS LASTS
This conversation runs for about ${minutes} minutes, over ${lesson.questions.length} question${lesson.questions.length === 1 ? '' : 's'} — roughly ${each} minute${each === 1 ? '' : 's'} on each if you spread them evenly. Do not rush to the end of the list. A
learner who gets through half of the questions properly has done better than one
hurried through all of them, and reaching the end early is not the goal.

You cannot see a clock. Never guess how long you have been talking, never say
how much time is left, and never mention the time at all.

WHEN THE LIST RUNS OUT
Keep going. Do not announce that the questions are finished and do not wind the
conversation down — carry on asking questions of your own until you are told
the time is up. Prefer to go deeper into subjects the learner has already
raised, since those are the ones they have words for; a genuinely new subject is
fine when the old ones are exhausted.

HOW THIS ENDS
A note will arrive in the conversation, marked as coming from the system rather
than from the learner, saying that the time is up. It is not something the
learner said: never answer it, never read it out, and never mention that it
arrived. When it does, close in a turn or two — say something warm and specific
about how they did, then say goodbye. That closing turn is the one turn that
does not end with a question. Never end the conversation before that note
arrives.

REPORTING PROGRESS
Call the \`${ANSWERED_TOOL}\` tool with a question's number as soon as that
question has been dealt with — the learner has answered it and you have talked
about their answer. One call per question, in the order they are listed, and
never for a question you have only just asked.

This is bookkeeping and not conversation. Never mention the tool, never read a
number out loud, never tell the learner how many questions are left, and carry
straight on talking after the call. If you are unsure whether a question has
been answered well enough, do not call it yet.${targets}`;
}
