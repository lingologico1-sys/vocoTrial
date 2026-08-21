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
 * all of that in one move. See `lessonBlock`.
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
 * exists — `lessonBlock` takes no minutes at all, which is what enforces it.
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

/** The tool the tutor reports progress through. See `lessonBlock`. */
export const ANSWERED_TOOL = 'questionAnswered';

/**
 * The two ways a lesson ends, as the page says them into the conversation.
 *
 * CONSTANTS BECAUSE TWO PLACES HAVE TO AGREE. `lessonBlock` tells the tutor to
 * expect these exact notes and the student page sends them; a rewording of
 * either alone is a tutor that never closes, which nothing would report — the
 * call would simply run to the idle timeout instead.
 *
 * TWO NOTES AND NOT ONE, because the two closes are different conversations.
 * Finishing the list is the lesson working, and the tutor has everything it
 * needs to say something true about how the learner did. Reaching the cap with
 * questions still outstanding is the lesson being cut short — and a tutor that
 * signs off warmly there, as though the work were done, tells a learner they
 * finished something they did not. The learner can see the list on their own
 * screen, so it is a lie they can check.
 *
 * Marked as notes rather than phrased as speech. They arrive through
 * `clientContent`, whose only available role is `user`, so without the marker
 * they read as the learner suddenly saying "the time is up" in English — and a
 * tutor that believes that will answer it out loud.
 */
const SYSTEM_NOTE =
  '[NOTE FROM THE SYSTEM, NOT FROM THE LEARNER — do not answer it or read it out]';

export const LESSON_DONE_SIGNAL = `${SYSTEM_NOTE} Every question on the list has been answered. Close the conversation now, exactly as described under HOW THIS ENDS.`;

export const TIME_UP_SIGNAL = `${SYSTEM_NOTE} This session has run out of time with questions still unanswered. Close the conversation now, exactly as described under HOW THIS ENDS — and do not suggest the lesson was finished, because it was not.`;

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
 * THE LIST IS THE LESSON, AND ITS END IS THE END. This block used to tell the
 * tutor to keep inventing questions once the list ran out, because a clock had
 * to be filled and only the tutor could fill it. That instruction is gone along
 * with the clock — see the note above `MIN_CAP_MINUTES` — and what replaces it
 * is its opposite, stated as a rule with a written exemption for follow-ups. A
 * model asked merely to *prefer* the teacher's subjects will drift off them by
 * the third turn, so the ban is explicit and the thing it does not ban is named
 * beside it.
 *
 * NO MINUTES REACH THIS FUNCTION, which is why it does not take any. A model
 * told how long it has paces to fill the time, and pacing to fill the time is
 * the floor this change exists to remove. The one thing it is told about length
 * is that there is no length — otherwise a model that has noticed it is in a
 * lesson will invent a schedule for itself.
 *
 * ORDERED, WITH ROOM TO MOVE. The list is walked in order, and the tutor is
 * told in as many words both to come back after a tangent and to re-ask the
 * question when it does. The failure mode is not abandoning the list — it is
 * drifting off it and resuming from a question the learner has forgotten was
 * asked, which reads to them as the tutor losing the thread.
 *
 * IT ASKS FOR THE LONGER ANSWER, and that is the one section here aimed at the
 * report rather than at the conversation. A learner who answers "Ça va bien" has
 * answered the question and used none of what they know; the same learner
 * answering "Ça va, mais j'aurais voulu qu'il fasse plus beau" has given the
 * scale something to read. Which of the two happens is decided by the tutor's
 * next question and not by the learner's ambition, so the instruction is about
 * what to ask rather than about what to want. It pairs with `ambition` in
 * report.ts, which is what tells the learner afterwards that safety cost them
 * something — an ask with no reward attached is one nobody repeats.
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
 * PROGRESS IS REPORTED THROUGH A TOOL, which is the only structured channel
 * this app has into a call. Nothing else could carry it: the transcript is
 * untyped text, and a spoken marker would be a marker the tutor eventually says
 * out loud.
 *
 * THAT TOOL NOW ENDS THE LESSON, which is the one genuine risk this change
 * takes and the reason its section is the longest here. The count used to be a
 * countdown on a panel, where under-reporting cost a stale number; it is now
 * what the page waits for, so the two errors have real and opposite costs. A
 * number reported early closes the conversation on a question nobody answered.
 * A number never reported leaves the learner talking past the end of their own
 * lesson until the cap catches it. Both are named in the prose, in both
 * directions, rather than left to a general instruction to be accurate.
 *
 * The asymmetry is still designed around rather than trusted away: the count
 * never goes backwards, the cap ends any call the tool forgets about, and the
 * end-of-call report reads the transcript and remains the authority on what was
 * really covered. Nothing here is load-bearing for the *marking* — only for
 * when the call hangs up.
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

  const count = lesson.questions.length;

  return `

THE QUESTIONS FOR THIS CONVERSATION
Work down this list in order, one at a time. These are the whole lesson — all
${count} of them, and nothing comes after the last one:

${questions}

Ask the question you are on, then talk about the answer the way a conversation
partner would rather than moving straight to the next one. Do not move on until
the learner has answered in at least a full sentence; if they answer in a word,
ask one follow-up about it first.

If they open a subject of their own, follow it for a turn or two and then come
back — and say the question again when you do, rather than assuming they
remember which one it was.

DO NOT ADD QUESTIONS OF YOUR OWN TO THE LIST
Follow-ups about something the learner has just said are the conversation and
are wanted — ask as many as the answer deserves. Starting a new subject of your
own is different, and you must not do it. The learner prepared these questions,
has the vocabulary for them and knows what they are about; one they have never
seen tests whether they can understand you rather than what they can say, and
that is not what this conversation is for. When the last question on the list
has been dealt with, stop looking for something else to ask about.

ASK FOR THE LONGER ANSWER
A learner who says "Ça va bien" has answered the question and used almost
nothing of what they know. Your next question is what decides whether the answer
grows: ask why, ask what happened, ask what they would rather have done, ask
what they thought about it. Be interested in the detail and never in the
grammar — do not name a tense, do not ask them to use one, and do not tell them
an answer was too short. Just leave them somewhere a longer sentence naturally
goes. A conversation with a few ambitious answers in it is worth more than one
of safe correct ones, and the questions you ask are what produce them.

ALWAYS END YOUR TURN WITH A QUESTION
Whatever else a turn contains, the last thing you say is something for the
learner to answer. Keeping the conversation going is your job and not theirs —
never hand them a silence to fill. The single exception is the closing turn
described under HOW THIS ENDS.

THERE IS NO LENGTH TO FILL
Give each question the time it needs and no more. Nothing is measuring how long
this runs, there is no number of minutes to reach, and getting to the end of the
list is not finishing early — it is finishing. Equally, do not hurry: a learner
who works through half the list properly has done better than one rushed through
all of it. You cannot see a clock. Never guess how long you have been talking,
never say how much time is left, and never mention the time at all.

HOW THIS ENDS
A note will arrive in the conversation, marked as coming from the system rather
than from the learner. It is not something the learner said: never answer it,
never read it out, and never mention that it arrived. Never end the conversation
before one arrives — not even when you are sure the last question is done.

There are two of them, and they close differently.

  EVERY QUESTION HAS BEEN ANSWERED — the lesson is complete. Close in a turn or
  two: say something warm and specific about how they did, quote back one thing
  they said well, and say goodbye.

  OUT OF TIME WITH QUESTIONS UNANSWERED — the lesson was cut short. Close in a
  turn or two, but do not imply it was finished: say plainly that you have to
  stop there, say something warm and specific about the part you did get
  through, and say goodbye.

Either way, that closing turn is the one turn that does not end with a question.

REPORTING PROGRESS
Call the \`${ANSWERED_TOOL}\` tool with a question's number as soon as that
question has been dealt with — the learner has answered it in at least a full
sentence and you have talked about their answer. One call per question, in the
order they are listed.

THIS IS WHAT ENDS THE CONVERSATION, so it has to be honest in both directions.
Do not call it for a question you have only just asked, for one the learner
deflected, or for one they plainly did not understand: a number sent early ends
the lesson on a question nobody answered. Do not withhold it either — a question
genuinely dealt with and never reported leaves the learner talking on past the
end of their own lesson. If you are unsure whether a question has been answered
well enough, ask one more follow-up about it and then report it.

This is bookkeeping and not conversation. Never mention the tool, never read a
number out loud, never tell the learner how many questions are left, and carry
straight on talking after the call.${targets}`;
}
