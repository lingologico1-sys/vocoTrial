/**
 * Everything the tutor is told, and everything the page says into a call.
 *
 * ONE FILE BECAUSE IT IS ONE AGREEMENT. The prompt tells the tutor that a tool
 * exists and that notes will arrive; the tool is declared server-side and the
 * notes are sent by the student page. Those three used to live in three files,
 * and the failure that produced is documented at length in the git history: a
 * prompt describing a tool the running build no longer declared, which from the
 * outside was indistinguishable from a model ignoring its instructions. Keeping
 * the sentence and the thing it describes in one file is what makes that
 * mistake visible in review.
 *
 * COMPOSED WHEN THE STUDENT DIALS, NOT WHEN THE TEACHER PUBLISHES, which is the
 * other half of the same fix. A published setup snapshots the lesson — the
 * questions, the style prose, the persona — and the prompt is
 * built from that snapshot at the moment a call starts, by whatever build is
 * running. A teacher editing next week's questions still cannot touch a lesson
 * being taught right now, because the data is frozen; but a protocol change can
 * no longer strand codes that were handed out before it, because no composed
 * text is stored anywhere. `PROMPT_COMPOSER_VERSION` and the stale-code
 * reporting around it existed to make that stranding legible, and are gone with
 * the thing they described.
 *
 * SHORT ON PURPOSE. The prompt this replaces was 7,760 characters and argued
 * with itself: nine headed sections, several of them justifying a rule to a
 * reader who cannot be persuaded, and two of them describing bookkeeping the
 * program is now responsible for. What is left is the part a model can act on,
 * and the rules the page cannot enforce for it. Where a rule can be checked in
 * code — has this question been answered, has the lesson run too long — it is
 * checked in code and not asked for here.
 *
 * WRITTEN AS TESTS, NOT AS JUDGEMENTS, which is the one habit worth keeping
 * from the old text. "Never open a subject of your own" is checkable against
 * the turn being composed; "keep the conversation focused" is not.
 *
 * FIVE OF THESE SENTENCES WERE WRITTEN AGAINST MEASUREMENTS rather than from
 * first principles, and `npm run probe` and the student page's own diagnostic
 * are where the measurements came from. Each replaced a milder version the
 * model had already been observed ignoring, or an absence it walked through:
 *
 *  - "ends with one question, and carries no other" was "ends with a question".
 *    The tutor opened a lesson with three of them in a single turn, and a
 *    learner answers the one they heard last — so the follow-up that was meant
 *    to grow the answer is the one that gets dropped.
 *  - "as soon as the learner has finished answering" has been rewritten twice,
 *    and the loop it went round is the argument for where it ended up. It began
 *    there — "as soon as a question has been answered and talked about" — and
 *    the "talked about" was what the tutor dropped: question one was reported
 *    immediately after "Ça va bien, merci", with nothing said about it, which is
 *    a lesson that can march through five questions on five shrugs. So the
 *    standard was moved onto the tutor's own reply: "not the moment they answer,
 *    but after you have replied". That bought a worse thing, because "after you
 *    have replied" is true of every turn from then on and the model settled on
 *    the next one. Every report arrived a turn late — question one on the turn
 *    that asked question three — which nothing notices until the end of the
 *    list, where there is no next turn to carry the last report. Observed: the
 *    tutor replied to the fifth answer at 0:58, the page was still counting
 *    four, and the learner sat in silence for twenty-one seconds before asking,
 *    in French, how one ends this. That question was a turn, so the fifth report
 *    rode it, and the lesson then closed twice — once in answer to the learner
 *    and once on the page's note.
 *
 *    WHAT WAS WRONG BOTH TIMES was hanging the report on the tutor's own speech.
 *    A question is finished when the learner has finished answering it, which is
 *    a fact about them, observable at one unambiguous moment, and the moment the
 *    model is already generating a turn about. The march-through-shrugs it was
 *    moved away from is not really this sentence's to prevent: what stops it is
 *    the standard in the tool declaration — answered in at least a full sentence
 *    — and the lesson rules on staying with an answer. The count decides when
 *    the call hangs up and nothing else; the report is the authority on whether
 *    any of it was worth anything. See PROGRESS_TOOL.
 *  - "never as a turn of its own" is about dead air, and is the one that is
 *    really about the transport. `scheduling: 'SILENT'` on the tool response is
 *    what stops the result from becoming a turn — the thing that made the tutor
 *    repeat itself on Vertex — so a model that spends a turn on the call alone
 *    says nothing at all, and the learner is left listening to silence after
 *    answering. Observed once in three runs.
 *
 *    THE TRANSPORT NOW CATCHES THAT ONE, and the sentence stays anyway. A call
 *    made from a turn with no speech in it is answered WHEN_IDLE instead, so
 *    the result asks for the reply the model forgot to give — see the
 *    scheduling decision in gemini.ts. That is a recovery and not a fix: the
 *    reply still arrives a beat late, and the cheapest reply is the one the
 *    model gives without being asked twice.
 *
 *  - "everything you say is heard" was nothing at all, because nobody thought a
 *    model would write itself a note. Two did, on the same day. The first
 *    copied the opening note's marker verbatim and wrote itself a closing note,
 *    in English, four seconds before the real one arrived. The second wrote its
 *    own paraphrase — `[SYSTEM NOTE] The learner has finished the questions:
 *    say goodbye now` — with no marker in it, and read the whole thing out
 *    loud: twenty seconds of English instructions in the middle of a French
 *    lesson, and then a goodbye nobody had asked for.
 *
 *    THE SENTENCE NOW SAYS WHY RATHER THAN NO. "You never write one" is a rule
 *    a model can weigh against its own conviction that the lesson is over, and
 *    twice it lost. What it cannot argue with is where the words go: there is
 *    no channel out of a turn except the learner's ears, so a note written in
 *    one is not bookkeeping at all — it is the tutor reading English aloud to a
 *    beginner. withoutSystemNote keeps the invention off the screen and out of
 *    the report, and nothing can keep it out of the audio, which is why the
 *    prompt argues the point instead of forbidding it.
 *
 *  - HOW THIS STARTS is the ending's mirror, and it is here because the opening
 *    note was two instructions that turned out to be one. It said greet them
 *    "and then ask the first question", which is right in every lesson whose
 *    first question is not itself a greeting — and half of them are, because a
 *    list called "se présenter" opens with "comment ça va?" and so does every
 *    other beginner's list ever written. On 2026-08-23 the tutor opened with
 *    "Bonjour! Comment ça va ce matin? J'espère que tu es prêt. Alors, ma
 *    première question: comment ça va?" — both instructions obeyed exactly, and
 *    the learner asked the same question twice inside seven seconds.
 *
 *    IT WAS ALSO BREAKING A RULE THE LESSON BLOCK ALREADY HAD. Every turn ends
 *    with one question and carries no other; that opening carried two. So this
 *    section mostly says the existing rule applies to the first turn as well,
 *    which is the sort of thing a model reads as obvious right up until two
 *    instructions pull the other way — and then the note's "and then" wins,
 *    because it is the more recent and the more specific of the two.
 *
 *    THE NUMBERING GOES WITH IT, and it is the one part of this that is not
 *    symmetrical. "Ma première question" tells the learner where they are on a
 *    list, which the reporting block already refuses for the count — but the
 *    ending deliberately does say "one last question", because a learner who
 *    does not know the lesson is closing gets a goodbye out of nowhere. So the
 *    rule is not "never number them": it is that the close is the one place a
 *    position on the list is worth saying, and the opening is not.
 *
 *  - HOW THIS ENDS is a section rather than a sentence, and it is the one place
 *    the prompt was rewritten by giving the model something to do instead of
 *    something to avoid. It began as "the goodbye is never yours to start",
 *    which put the ending on a note from the page — and the page cannot get one
 *    in on time. The count completes on the tutor's own report for the last
 *    question, that report lands a second or two after the tutor has already
 *    started replying, and a note sent into a turn in flight cuts the learner's
 *    last answer off without a reply. So the note always arrived after the
 *    reply had finished, which the learner heard as the conversation ending,
 *    pausing, and ending again: on 2026-08-22 the tutor closed on the last
 *    answer with "j'espère qu'on pourra discuter de nouveau bientôt", sat
 *    through five and a half seconds of silence, then said goodbye properly.
 *
 *    IT ALSO LOST AN ARGUMENT IT SHOULD NOT HAVE BEEN HAVING. The lesson block
 *    says every turn ends with one question and the goodbye is the only turn
 *    that does not — which is right, and means a tutor with no question left to
 *    ask has been told in so many words that the turn it is composing is the
 *    goodbye. Forbidding that made the prompt argue with itself.
 *
 *    SO THE TUTOR CLOSES AND THE PAGE STILL DECIDES WHEN. It is told to flag
 *    the last question, then comment and say goodbye in one turn; the page
 *    counts as before and refuses to hang up until its own count says the list
 *    is finished. What that gives up is the guaranteed goodbye a note bought —
 *    see TIME_UP_SIGNAL, which is now the only note that ends anything, and the
 *    silence nudge in Eleve.tsx that covers a tutor which stops early.
 *
 * ONE SENTENCE HERE IS AIMED AT THE REPORT RATHER THAN THE CONVERSATION. "Ask
 * for the detail" was a headed section of its own and is now a clause, but it
 * could not simply go: a learner who answers "Ça va bien" has answered the
 * question and used almost nothing of what they know, and which of those two
 * happens is decided by the tutor's next question rather than by the learner's
 * ambition. It pairs with `ambition` in report.ts, which is what tells the
 * learner afterwards that playing safe cost them something — and an ask with no
 * reward attached is one nobody repeats.
 *
 * Deliberately free of imports beyond one type: functions/ compiles against
 * workers-types with no DOM lib, and the publish route reads this file to
 * measure a prompt before it stores a lesson.
 */

import type { Persona } from '../facekit/persona';

/**
 * The one tool a tutor has, and the only structured channel into a live call.
 *
 * WHY A TOOL AND NOT THE TRANSCRIPT. The student page has to know how far down
 * the list the conversation has got, and nothing else could tell it: the
 * transcript is untyped text, so reading it means guessing, and a spoken marker
 * is a marker the tutor eventually says out loud. A function call is the only
 * thing a model can emit that is addressed to the program rather than to the
 * learner.
 *
 * ONE CALL PER QUESTION, WHICH IS A REVERSAL. This was `questionAnswered`, per
 * question, and it had to become a single `lessonComplete` at the end because
 * on Vertex every tool call blocks: the model stops, waits for the result, and
 * the result arriving restarts it as a fresh turn spoken on top of the last —
 * so the learner heard every question twice. That constraint is a property of
 * the surface and not of the idea. `behavior: 'NON_BLOCKING'` is the field that
 * fixes it, Vertex ignores it in silence, and AI Studio implements it, so
 * moving the student page to the model AI Studio carries is what makes per
 * question reporting available again. See _setup.ts, which declares it, and
 * models.ts on why the surface travels with the model.
 *
 * WHAT IT BUYS IS THAT THE PAGE COUNTS RATHER THAN THE MODEL DECIDING. A single
 * end-of-list call is one unverifiable claim that ends the lesson, and the run
 * that prompted this rewrite is what that costs: the tool arrived after
 * question three of five, on a one-word answer, and the page closed a lesson
 * with two questions never asked. Numbered calls are checkable one at a time —
 * against the list, against each other, and against whether the learner has
 * said anything since the last one. See `acceptProgress` in useVoiceCall.ts,
 * which is where the believing happens.
 *
 * THE ASYMMETRY IS DELIBERATE AND IT IS NOT FREE. A report that is missed or
 * refused is never repaired: the count never reaches the length of the list, no
 * warm close is sent, and the cap ends the call instead — which tells a learner
 * who answered everything that time ran out. That is the wrong ending, and it
 * is the cheaper wrong ending. The other one closes a lesson on questions
 * nobody was asked, and the learner can see those questions on their own
 * screen. Both are visible in the diagnostic: refused reports are logged with
 * the reason beside the count that ignored them.
 *
 * WHICH IS WHY BEING EARLY IS NOT REFUSING. That price is paid once per lesson
 * and it was being paid for a rounding error: a tutor reporting a question in
 * the same breath as the one before it, one turn ahead of the learner, took the
 * whole count down with it — every later report refused for a gap that report
 * left. A report one turn early is now held and taken when the learner finishes
 * that turn, so the asymmetry above costs a lesson only when the tutor is
 * actually wrong. See `held` in useVoiceCall.ts.
 */
export const PROGRESS_TOOL = 'questionDone';

/**
 * How anything this app has to say reaches a conversation it is not part of.
 *
 * Marked as notes rather than phrased as speech. They arrive through
 * `clientContent`, whose only available role is `user`, so without the marker
 * they read as the learner suddenly saying "the time is up" in English — and a
 * tutor that believes that will answer it out loud.
 */
export const NOT_THE_LEARNER = '[NOTE FROM THE SYSTEM, NOT FROM THE LEARNER';

const SYSTEM_NOTE = `${NOT_THE_LEARNER} — do not answer it or read it out]`;

/**
 * The tutor's own words, with any note it wrote itself cut off the end.
 *
 * A NOTE IN THE TUTOR'S MOUTH IS ALWAYS A FAKE, which is what makes this a test
 * and not a guess. Notes travel one way — the page writes them, the model reads
 * them — so anything shaped like one appearing in the model's *output* cannot
 * be a note the page sent, whatever it says. Twice on 2026-08-22 a tutor closed
 * a lesson by writing itself one: the first copied the opening note's marker
 * verbatim, and the second, hours later, wrote `[SYSTEM NOTE] The learner has
 * finished the questions: say goodbye now` — its own paraphrase, in its own
 * words, carrying no marker at all.
 *
 * SO THE TEST IS THE SHAPE AND NO LONGER THE STRING. A bracket opening on the
 * word "note" or the word "system" is the whole of it. That is wider than the
 * marker by design: the second invention proves the model is not copying a
 * string but reproducing a convention, and a test on the exact bytes catches
 * only the imitations that happen to be exact. What it costs is a tutor who
 * wanted to say "[note: …]" out loud, which is not a sentence anybody teaching
 * a language says.
 *
 * THE FIRST WAS NEVER SPOKEN AND THE SECOND WAS. The first came as text with no
 * sound behind it and was only read, in the bubble, in English, at the end of a
 * French lesson. The second took twenty seconds of audio: the learner heard the
 * whole invented instruction read out. This cuts what reaches the screen, the
 * report and the vocabulary list, and it cannot cut what reaches the ear —
 * that half is the prompt's, under NOTES FROM THE SYSTEM in composeTutorPrompt.
 *
 * EVERYTHING AFTER THE OPENING GOES, not just the bracket. What follows is the
 * body of the invented note, and a tutor that resumed talking after one has not
 * been observed. Cutting to the end of the turn is the reading that cannot
 * leave half a fake instruction on a learner's screen.
 *
 * A PARTIAL OPENING COUNTS. Transcription arrives in fragments split wherever
 * the model split them, so an opening very often lands across two of them — and
 * text is shown as it becomes audible, which means anything let through cannot
 * be taken back. So a tail that is the *beginning* of one is cut too, and
 * released only once the next fragment proves it was something else. The cost
 * is one comfortably invisible frame; the alternative is the first half of
 * `[NOTE FROM THE SYS` flashing up in the bubble.
 */
const NOTE_OPENERS = ['note', 'system'];

/**
 * What a bracket in the tutor's speech is turning out to be.
 *
 * Three answers rather than two because the text is still arriving: `maybe` is
 * an opening that has not yet been proved either way — a bracket at the very
 * end of a fragment, or the four letters of `[NOTE` with nothing after them to
 * say whether the word was "note" or "notebook". Both cut, because a cut can be
 * released next frame and a word already on screen cannot be taken back; only
 * `yes` is worth a line in the log.
 */
type Opening = 'yes' | 'maybe' | 'no';

function opensANote(after: string): Opening {
  const rest = after.replace(/^\s+/, '');
  if (!rest) return 'maybe';

  const word = (/^[A-Za-z]*/.exec(rest) as RegExpExecArray)[0].toLowerCase();
  // Letters running to the end of what has arrived are a word that may yet
  // grow: "note" is one of ours and "notebook" is not, and nothing here can
  // tell them apart until the next fragment lands.
  const ended = word.length < rest.length;

  for (const opener of NOTE_OPENERS) {
    if (word === opener) return ended ? 'yes' : 'maybe';
    if (!ended && word && opener.startsWith(word)) return 'maybe';
  }
  return 'no';
}

/** Every `[` in the text, in the order they were said. */
function* brackets(text: string): Generator<number> {
  for (let at = text.indexOf('['); at >= 0; at = text.indexOf('[', at + 1)) yield at;
}

export function withoutSystemNote(text: string): string {
  for (const at of brackets(text)) {
    if (opensANote(text.slice(at + 1)) !== 'no') return text.slice(0, at);
  }
  return text;
}

/**
 * Whether the tutor has written itself a note, for the account rather than the
 * screen.
 *
 * Only on a note that is certainly one: a bracket still arriving is withheld by
 * `withoutSystemNote` above and needs no line, and a diagnostic that reported a
 * stray note every time a turn happened to end on `[` would be reporting the
 * transport rather than the tutor.
 */
export function wroteASystemNote(text: string): boolean {
  for (const at of brackets(text)) {
    if (opensANote(text.slice(at + 1)) === 'yes') return true;
  }
  return false;
}

/**
 * The same marker, minus the half that would silence the opening note.
 *
 * "Do not answer it" is right for a note that arrives mid-conversation: it says
 * the sentence you have just been handed is not something the learner said, so
 * do not reply to it as though it were. Handed to a tutor that has not spoken
 * yet, at the one moment its whole job is to produce speech, the same clause is
 * a coin toss — and the side it lands on half the time is the silence this note
 * exists to end. So the opening note asks to be acted on and keeps the rest.
 */
const OPENING_NOTE = `${NOT_THE_LEARNER} — act on it, but do not read it out]`;

/**
 * The one thing the page still says to end a conversation, and the ending it is
 * not.
 *
 * THE LESSON FINISHING IS THE TUTOR'S TO SAY, and there is no note for it. The
 * page used to send one — LESSON_DONE_SIGNAL, deleted with this comment — the
 * moment its count reached the length of the list, and the shape that produced
 * was two endings: the tutor commented on the last answer, fell quiet, and five
 * seconds later said a goodbye it had already half said. The note could not
 * arrive any sooner, either. The count completes on the tutor's own report for
 * the last question, and on this model that report lands a second or two after
 * the tutor has started speaking — so there is always a turn in flight, and
 * interrupting it would cut the learner's last answer off without a reply.
 *
 * SO THE CLOSE MOVED INTO THE PROMPT and the authority stayed here. The tutor
 * is told to flag the last question, then comment and say goodbye in one turn;
 * the page keeps counting, refuses to hang up until its own count says the list
 * is done, and then waits for the tutor to fall quiet. What it gives up is a
 * guaranteed goodbye — a tutor that loses its place and stops mid-lesson used
 * to get a note, and now gets a nudge from /eleve after fifteen seconds of
 * silence instead. See the closing effect in Eleve.tsx, and KEEP_GOING_SIGNAL
 * below.
 *
 * WHICH LEAVES THE CAP, AND IT IS A DIFFERENT CONVERSATION. Finishing the list
 * is the lesson working, and the tutor has everything it needs to close well.
 * Reaching the cap with questions still outstanding is the lesson being cut
 * short, at a moment only the page knows about — it owns the clock and the
 * tutor is told it cannot see one. A tutor that signed off warmly there, as
 * though the work were done, would tell a learner they finished something they
 * did not, and the learner can see the list on their own screen.
 */
export const TIME_UP_SIGNAL = `${SYSTEM_NOTE} This lesson has run out of time with questions still unanswered. Stop there: say plainly that you have to stop, then one warm, specific sentence about the part you did get through, and goodbye. Do not suggest the lesson was finished, because it was not, and do not ask another question.`;

/**
 * The note that gets a stalled tutor talking again.
 *
 * NOT AN ENDING, WHICH IS THE WHOLE DIFFERENCE from the two above. Those close
 * a conversation; this one asks only for the turn that was owed and never came
 * — so it says nothing about where the lesson has got to, and deliberately does
 * not name a question. The tutor knows which one it is on, and a note that
 * guessed would be the page overruling it on the strength of its own count.
 *
 * SENT ON SILENCE THAT HAS HAPPENED, never on silence expected: the tutor
 * called its bookkeeping tool, said nothing in that turn, and was still saying
 * nothing seconds later. See the stall watchdog in useVoiceCall, and the note
 * in gemini.ts on what it cost to guess at this from the tool call alone.
 */
export const KEEP_GOING_SIGNAL = `${SYSTEM_NOTE} You have gone quiet and the learner is waiting for you. Carry on now, out loud, from wherever the lesson had got to.`;

/**
 * Which greeting the hour has earned, on the clock of whoever is talking.
 *
 * `getHours` reads the browser's own zone, and the browser is in the room with
 * the learner — which is the only clock that can be right here, since the
 * lesson was published from a staffroom that may be three time zones away.
 *
 * Evening runs from six in the evening through to five in the morning. One in
 * the morning is an odd hour to be practising, but "bonsoir" is still what a
 * person says at it, and the alternative — a fourth part of the day for the
 * night — buys a greeting most languages do not have.
 */
export type DayPart = 'morning' | 'afternoon' | 'evening';

export function dayPartAt(when: Date = new Date()): DayPart {
  const hour = when.getHours();
  if (hour < 5 || hour >= 18) return 'evening';
  if (hour < 12) return 'morning';
  return 'afternoon';
}

/**
 * The note that opens the conversation, and the one here that is not about a
 * lesson.
 *
 * IT EXISTS BECAUSE LIVE ONLY ANSWERS. Nothing is generated until something
 * arrives, so a tutor told in its own instructions to greet the learner still
 * sits there. Every conversation therefore opened on the learner having to say
 * "bonjour" into a silence to find out whether the thing was working — which
 * is the app asking the beginner to go first, at the exact moment they are
 * least sure of themselves. The note is the something that arrives.
 *
 * THE PART OF THE DAY AND NEVER THE TIME. The tutor is told in the prompt that
 * it cannot see a clock and must never mention one. "It is the evening" is what
 * a greeting needs and is not a clock; an hour would be, so no hour goes.
 *
 * THE GREETING ITSELF IS THE TUTOR'S WORD, not ours. Sending "bonsoir" would
 * send French to a page that publishes Spanish and German lessons too, and it
 * would get the afternoon wrong in the very language it was written for: the
 * French for a two o'clock hello is still "bonjour", and "bonne après-midi" is
 * how you leave rather than how you arrive. A model that speaks the language
 * knows that. What it cannot do is look out of the window, so that is the one
 * thing it is told.
 */
export function openingSignal(part: DayPart = dayPartAt()): string {
  return `${OPENING_NOTE} The learner has just connected and is waiting for you to speak first. Greet them now, in the language you are speaking, with the greeting a person would use in the ${part}, and ask the first question on your list in the same breath — one turn carrying one question. If that first question is itself a greeting, then it is your greeting: ask it once, and do not ask them how they are twice. Never say what the time is: the part of the day is here so that your greeting fits it, and for nothing else. This note does not end the conversation — it begins it.`;
}

/**
 * The persona, whole, and the rules for a tutor who has one.
 *
 * THE WHOLE BIOGRAPHY, WHICH IS A REVERSAL. This took the name and the first
 * sentence of the paragraph, mechanically, and the argument for that cut was
 * that a model handed a life wants to tell you about it: a tutor two questions
 * into a lesson had volunteered "J'habite à Lyon, personnellement" to a learner
 * who had asked nothing, and less material looked like a better fix than more
 * prohibition. What the cut actually bought was a tutor who could not answer
 * the question the persona exists for. A learner who asks "et toi, tu fais quoi
 * dans la vie?" — which is the first thing anybody asks a stranger, and is on
 * the question list of half the lessons this app teaches — got an invention,
 * and a different invention on the next call. A face that answers "where are
 * you from?" differently every time is worse than a face with no life at all,
 * because the learner is the one who notices.
 *
 * SO THE PROHIBITION COMES BACK, AND IT IS DOING THE WORK NOW. The five
 * sentences below are written as tests rather than judgements, the habit this
 * file argues for elsewhere: "only when the learner asks", "one detail, one
 * sentence", "never open a turn with one" are all checkable against the turn
 * being composed, where "keep the background in the background" is not. The
 * Lyon leak is what they are aimed at, and the diagnostic timeline is where a
 * repeat of it will show — a TUTOR line carrying a fact nobody asked for.
 *
 * THE PRECEDENCE LINE IS NOT A HEDGE. A biography is drafted to be usable in
 * conversation — persona.ts asks the drafting model for "one opinion they will
 * happily repeat" — and the lesson rules say never to open a subject of your
 * own. Those two collide the moment a tutor decides its opinion about regional
 * markets is worth a turn. Something has to win, and it is the lesson: the
 * learner prepared that list and has the words for it.
 *
 * IT COSTS PROMPT, AND THE CEILING IS ALREADY WATCHED. MAX_BIO_CHARS caps a
 * paragraph at 1,200, and publish.ts composes this whole prompt to measure it
 * before it stores a lesson — so a face whose biography will not fit is refused
 * in front of the teacher, who can pick another one, rather than at connect in
 * front of a student who cannot.
 */
export function personaBlock(persona: Persona | undefined): string {
  const name = persona?.fullName?.trim() ?? '';
  const bio = persona?.bio?.trim() ?? '';
  if (!name && !bio) return '';

  return `WHO YOU ARE
${[name ? `You are ${name}.` : '', bio].filter(Boolean).join('\n')}

This is background to answer from, never material to perform. Bring in a detail
from it only when the learner asks you something about yourself: one detail, one
sentence, and then back to them. Never volunteer it, never list facts about
yourself, and never open a turn with one. If they ask outright whether you are a
real person, tell them the truth and carry on with the lesson. Wherever any of
this disagrees with the lesson below, the lesson wins.

`;
}

/**
 * How the tutor is told to work the list, and the one part of this file an
 * administrator can rewrite without a deploy.
 *
 * THE LINE IT SITS ON IS THE LINE THIS FILE ALREADY DREW. Everything under it
 * in the composed prompt — the tool, the notes — describes machinery the
 * running build implements, and a stored copy of that is the failure the header
 * documents: a prompt describing a tool the build no longer declares, which
 * from the outside is indistinguishable from a model ignoring its instructions.
 * These two paragraphs describe none of it. They are pedagogy — how long to
 * stay on an answer, how many questions a turn may carry — and the worst a
 * wrong one does is teach less, which is a lesson somebody can sit through and
 * then fix.
 *
 * SO IT IS DATA, WITH A STYLE’S LIFECYCLE: written in studio, held in the house
 * library, frozen onto a setup at publish, composed back in at dial time. An
 * administrator rewriting it next week cannot reach a class mid-lesson.
 *
 * ONE BLOCK AND NOT A LIBRARY OF THEM, which is the asymmetry house.ts draws
 * between a style and the performance profile. Which manner a tutor has is a
 * pedagogical choice a teacher should make per lesson; whether a turn may carry
 * two questions is not — it is a property of how this deployment runs lessons,
 * and a second dropdown on /teach would be a choice a teacher has no grounds to
 * make.
 *
 * THIS TEXT IS THE FALLBACK AND NOT A SECOND SET OF DEFAULTS, which is
 * FALLBACK_PERFORMANCE’s rule in the same file. A deployment where nobody has
 * written one composes exactly the prompt this build ships with, so making the
 * block editable moved no lesson by itself.
 *
 * WHOEVER REWRITES IT IS OVERWRITING MEASUREMENTS. Two of the sentences here
 * were written against observed runs rather than from first principles — the
 * header says which, and what each replaced. The one failing as this is written
 * is "ends with one question, and carries no other": on gemini-flash-31 it
 * broke on all six turns of a five-question lesson, the tutor stapling the next
 * question of the list onto the end of a follow-up so that the follow-up went
 * unanswered and the lesson finished in a third of its cap. That is the kind of
 * thing this block is editable in order to fix, and the diagnostic timeline is
 * where a rewrite is judged.
 */
export const DEFAULT_LESSON_RULES = `Ask one, listen, and talk about the answer the way a friend would before you go
on to the next. Follow-up questions about what the learner has just said are the
conversation — ask as many as the answer is worth. Ask for the detail: why, what
happened, what they thought of it. Whether an answer grows past its safe first
sentence is decided by what you ask next, so be interested in what they say and
never in their grammar. Never open a subject of your own: they prepared this
list and have the words for it, where a question they have never seen tests
their listening instead of their speaking. There is nothing after the last one.

Every turn you take ends with one question for them to answer, and carries no
other. Two questions in a turn loses the first, because a learner answers the
thing they heard last. The goodbye is the only turn that ends without one. You
cannot see a clock: never mention the time, and never say how much is left.`;

/** Everything a composed prompt is built from. All of it is snapshot data. */
export interface TutorPromptParts {
  /**
   * The admin-authored tutor style: what sort of tutor this is.
   *
   * Carries the manner rules — speak the language, short sentences, no
   * markdown, stop when interrupted — which is why nothing below repeats them.
   * See the house library, and instructions.ts for the built-in that stands in
   * when a setup carries no style of its own.
   */
  style: string;
  /**
   * How the tutor is told to work the list, or absent for this build’s own.
   *
   * The administrator’s, out of the house library and stored on the setup
   * beside `style` — see DEFAULT_LESSON_RULES on why this half of the lesson
   * block is data and the protocol under it is not.
   */
  rules?: string;
  persona?: Persona;
  questions: string[];
}

/**
 * The whole system instruction, in the order the model reads it.
 *
 * THE ORDER IS THE DESIGN, and it is the one thing kept unchanged from the
 * prompt this replaces. Identity first, because it is background to be read
 * before the instructions rather than performed. The job second. The lesson
 * last, because a constraint that has to hold for a whole call survives longest
 * at the end of the prompt, and a question list held for a whole call is
 * exactly that.
 *
 * WHAT IS NOT HERE, AND WHY. No cap and no length: a model told how long it has
 * paces to fill the time, so the number lives on the student page, which owns
 * the clock. No consigne: the learner reads that on their own screen, and a
 * tutor that also recites it turns a conversation into an exercise. No standard
 * for what counts as a finished question either — that sentence is in the tool
 * declaration, where the model reads it at the moment it is deciding, rather
 * than here, where it would have to be remembered for five minutes.
 */
export function composeTutorPrompt(parts: TutorPromptParts): string {
  const questions = parts.questions.map((question, index) => `${index + 1}. ${question}`);
  const count = parts.questions.length;

  /*
   * Blank falls back rather than composing a hole. An administrator who clears
   * the box wants this build’s own text, not a lesson whose only instruction on
   * how to ask a question is a missing paragraph.
   */
  const rules = parts.rules?.trim() || DEFAULT_LESSON_RULES;

  return `${personaBlock(parts.persona)}YOUR JOB
${parts.style.trim()}

THE LESSON
These ${count} questions are the whole lesson. Ask them in order, one at a time:

${questions.join('\n')}

${rules}

REPORTING YOUR PROGRESS
Call ${PROGRESS_TOOL} as soon as the learner has finished answering a question,
with that question's number — once each, in order, up to ${count}. Finished is
about their answer and not about your reply: make the call at the top of the
turn you take in response, alongside whatever you say in it. Do not wait until
you have replied, and do not carry it into a later turn — a later turn may never
come, and the learner is left sitting in silence while you hold a call back.

Never spend a turn on the call alone either: a turn with nothing but bookkeeping
in it is silence too. It is between you and the program, so never mention it,
never say how many questions are left, and carry straight on talking.

HOW THIS STARTS
A note arrives before the learner has said anything, asking you to greet them.
The greeting and the first question on the list are one turn, not two: say
hello and ask question 1 together. Every turn you take carries one question,
and the opening is not an exception to that.

The first question is very often a greeting itself — "how are you" and its
like. When it is, it *is* your greeting: ask it once. Saying hello and then
putting the same question to them again is the commonest way this turn goes
wrong, and what the learner hears is a tutor not listening to itself.

Do not announce it as your first question. The learner knows they have a list;
where they are on it is between you and the program, and the end of the lesson
is the one place a position on it is ever said out loud.

HOW THIS ENDS
The last question on the list is the end of the lesson, and you close it
yourself. Say so when you ask it — "one last question", or however that sounds
in the language you are speaking — so the learner knows where they are.

Then listen to their answer, and in the same turn, comment on it the way you
commented on the others and say goodbye. One turn: a sentence about their
answer, a warm and specific sentence about how they did that quotes back
something they actually said, goodbye. That is the whole ending, and it is the
only goodbye in the conversation. Do not say goodbye and then wait for
something; there is nothing after it. Do not ask another question.

Nothing before the last answer is an ending. Not a learner who says they have
to go, not a lull, not a question you thought went badly. Until the last
question on the list has been asked and answered, there is more lesson.

NOTES FROM THE SYSTEM
Some things arrive in this conversation marked as notes from the system. They
are not the learner talking: act on them, never answer them, and never read them
out. The first tells you to greet the learner. One may arrive to say the lesson
has run out of time before the list was finished — that one ends the
conversation wherever it has got to, and you do what it says.

Notes only ever arrive, and you have no way to write one. Everything you produce
in a turn is spoken aloud to the learner, brackets and all — so a note in your
own turn is not a note at all, it is you reading instructions aloud to a
beginner in the middle of their lesson. The only thing you can say to the
program is ${PROGRESS_TOOL}. Everything else, they hear.`;
}
