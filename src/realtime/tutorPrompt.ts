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
 * Deliberately free of imports beyond two types: functions/ compiles against
 * workers-types with no DOM lib, and the publish route reads this file to
 * measure a prompt before it stores a lesson.
 */

import type { Persona } from '../facekit/persona';
import type { LanguageChoice } from './languages';

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
 * The other thing a tutor says that was never meant to be speech: its own
 * bookkeeping call, pronounced.
 *
 * OBSERVED, NOT GUARDED AGAINST IN ADVANCE. On 2026-08-28 a turn came back as
 * `call:${PROGRESS_TOOL}{number:3}On dirait que vous avez une bonne ambiance!`
 * — the model writing a text-shaped version of the tool call into the channel
 * that is read aloud, with its actual reply carrying straight on afterwards.
 * The page counts real tool calls and never saw this one, so nothing about the
 * lesson went wrong; what went wrong is that a beginner in the middle of a
 * French sentence heard an identifier and a brace.
 *
 * THE NAME ALONE IS ENOUGH TO CUT ON. `${PROGRESS_TOOL}` is camelCase English
 * inside a lesson taught in something else — no tutor has any reason to utter
 * it in any language, so there is no sentence this can take away. The openers
 * and the argument blob are matched only to widen the cut: an orphaned `call:`
 * left standing would be the same fault with fewer letters.
 *
 * IT EXCISES RATHER THAN TRUNCATES, which is the one place it disagrees with
 * withoutSystemNote above. An invented note replaces a turn — nothing has ever
 * been observed after one — but this arrived welded to the front of a real
 * reply the learner is listening to as it is cut. Blanking that would put a
 * silent bubble under a talking face to punish the model for a token.
 *
 * AND IT IS COSMETIC, WHICH IS WORTH BEING PLAIN ABOUT. The audio was generated
 * and played before any of this ran. What this protects is the bubble, the
 * report and the words a learner can tap on — not their ears. The ears are the
 * prompt's problem, under REPORTING YOUR PROGRESS in composeTutorPrompt.
 */
const OPENERS = ['function call', 'tool call', 'tool_call', 'toolcall', 'api call', 'call'];

/** The whole construct, once enough of it has arrived to be sure. */
const SPOKEN_TOOL = new RegExp(
  `(?:\\b(?:${OPENERS.join('|')})\\s*[:=]?\\s*)?` +
    PROGRESS_TOOL +
    String.raw`\s*(?:\{[^}]*\}|\([^)]*\))?`,
  'gi',
);

/**
 * How far back from the tail a cut might still reach, in characters.
 *
 * The construct is an opener, a name and an argument blob, and only the blob
 * has no length of its own. Sixty-four covers every one yet seen with room to
 * spare, and it bounds a scan that runs on every fragment of every turn.
 */
const LOOKBACK = 64;

/**
 * Whether what is left at the end of a fragment could still grow into one.
 *
 * THE HALF THAT KEEPS THE CUT MONOTONIC. Text is put on screen as it becomes
 * audible and cannot be taken back, so a tail that might turn out to be the
 * front of a spoken tool call has to be withheld until the next fragment says
 * which it was. Without it the four characters of `call:` are painted, the name
 * completes, the cut moves underneath what is already on screen, and the words
 * after it are sliced at the wrong offset — corrupt output, which is worse than
 * the token this exists to remove.
 *
 * IT OVER-WITHHOLDS AND THAT IS THE CHEAP DIRECTION. `que` is the front of
 * `${PROGRESS_TOOL}` as far as three letters can tell, and it ends a great many
 * French clauses; those are held for one fragment — a fraction of a second,
 * against audio that is still playing — and released whole. Being wrong the
 * other way is a permanent mark on the screen.
 */
function couldBeSpokenTool(rest: string): boolean {
  const low = rest.toLowerCase();
  const name = PROGRESS_TOOL.toLowerCase();

  // The name itself, arriving a letter at a time.
  if (name.startsWith(low)) return true;
  // The name, followed by an argument blob that has not closed yet.
  if (low.startsWith(name)) {
    const after = low.slice(name.length).trimStart();
    return after === '' || (/^[{(]/.test(after) && !/[)}]/.test(after));
  }
  // An opener, arriving or arrived, with however much has followed it.
  for (const opener of OPENERS) {
    if (opener.startsWith(low)) return true;
    if (!low.startsWith(opener)) continue;
    const after = low.slice(opener.length).replace(/^[\s:=]*/, '');
    if (after === '' || couldBeSpokenTool(after)) return true;
  }
  return false;
}

/**
 * The tutor's words with any spoken bookkeeping taken out.
 *
 * `done` releases whatever was being withheld: a turn that has finished has no
 * next fragment to prove itself in, and "question" — a prefix of the name and
 * an ordinary French word — is a likely enough last word that losing it would
 * be a worse bug than the one being fixed.
 */
export function withoutSpokenTool(text: string, done: boolean): string {
  /*
   * WITHHELD FIRST, CUT SECOND, AND THE ORDER IS THE WHOLE CORRECTNESS OF THIS.
   * Done the other way round, `${PROGRESS_TOOL}{num` has its name taken out —
   * the name is complete, after all — and the orphaned `{num` left behind is
   * not the front of anything this recognises, so it goes on screen and the
   * `ber:3}` that closes it follows a fragment later. Deciding what is still in
   * flight before cutting anything means the only thing the cut ever sees is a
   * construct that has finished arriving.
   */
  let arrived = text;
  if (!done) {
    for (let take = Math.min(text.length, LOOKBACK); take > 0; take--) {
      if (couldBeSpokenTool(text.slice(text.length - take))) {
        arrived = text.slice(0, text.length - take);
        break;
      }
    }
  }
  return arrived.replace(SPOKEN_TOOL, '');
}

/**
 * Whether the tutor said its bookkeeping out loud, for the account.
 *
 * Unlike the note above, this earns a line even though the transcript comes out
 * clean, and precisely because it does: the reader of a diagnostic is looking
 * for why a learner reported hearing gibberish, and a cut that left no trace
 * would send them looking at the audio pipe.
 */
export function spokeATool(text: string): boolean {
  SPOKEN_TOOL.lastIndex = 0;
  return SPOKEN_TOOL.test(text);
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
 * The same silence, when the page knows the learner filled it and the tutor
 * never got the words.
 *
 * A DIFFERENT SILENCE NEEDS A DIFFERENT NOTE. KEEP_GOING_SIGNAL asks a tutor
 * that stopped to start again, and it is right whenever the quiet is the
 * tutor's own. This one is for the quiet that is the transport's: the
 * microphone heard an answer's worth of speech, no transcript ever committed,
 * and the tutor is sitting on a question it believes is still unanswered. Sent
 * KEEP_GOING there, it carries on from a lesson whose last event, as far as it
 * knows, is its own question — so it re-asks, or fills the air, and the
 * learner who just spoke for fifteen seconds is answered as though they had
 * said nothing.
 *
 * SO IT NAMES THE FAILURE AND ASKS FOR THE REPAIR, which is a thing the style
 * block already tells the tutor to do — say you did not catch it and ask for
 * it again, rather than guessing. The note only supplies the fact the tutor
 * has no way to know: that there was something to catch. Measured on
 * 2026-08-27, where a 15.7-second answer to question three never reached
 * Google and the lesson died there.
 *
 * IT DOES NOT NAME THE QUESTION, for the reason KEEP_GOING_SIGNAL does not:
 * the tutor knows where it is, and the page guessing would be its count
 * overruling the conversation.
 */
export const NOT_HEARD_SIGNAL = `${SYSTEM_NOTE} The learner answered, but their words never reached you — this is a fault on the line, not a silence. Tell them you did not catch that, warmly and briefly, and ask them to say it again. Do not move on to the next question, and do not guess at what they said.`;

/**
 * The note that puts a brand-new socket back into a lesson already in progress.
 *
 * THE ONE NOTE HERE THAT NAMES A QUESTION, and the exception proves the rule.
 * KEEP_GOING_SIGNAL deliberately does not: the tutor it is talking to knows
 * where it is, and a page that guessed would be overruling it on the strength
 * of its own count. This one is talking to a tutor that has just been created.
 * It holds the system instructions and an empty conversation — no greeting, no
 * answers, no sense of place at all — so the page's count is not a rival
 * account of where the lesson is, it is the only one left. Withholding it here
 * would produce a tutor that starts the lesson over from question one, which is
 * the failure this note exists to prevent.
 *
 * IT MUST ALSO STOP THE GREETING. `openingSignal` is what asks for one, and it
 * is not sent on a resume — but a model handed an empty conversation and a
 * prompt whose HOW THIS STARTS section describes saying hello will very often
 * say hello anyway. To the learner that reads as the lesson restarting, which
 * is exactly as bad as actually restarting it.
 *
 * WHAT IT DOES NOT DO IS EXPLAIN ITSELF. The learner is not told there was a
 * fault, because from where they sit there was a pause and then the tutor
 * carried on — and a tutor announcing a technical problem to a beginner in a
 * language they are still assembling sentences in is worse than the pause was.
 *
 * `next` is the question to ask; null with a list behind it means the list is
 * finished and all that is left is the ending the prompt describes. `total` is
 * the length of that list, and zero means there is no list at all — the
 * workshop's case, where there is no position to restore and the note falls
 * back to what KEEP_GOING_SIGNAL would have said.
 */
export function resumeSignal(next: number | null, total: number): string {
  /*
   * Four shapes, and every one of them is a case that actually arises.
   *
   * The `next === 1` branch exists because "questions 1 to 0" is what one
   * subtraction and no thought produces, and the stall it describes — before a
   * single question was answered — is the likeliest one of all. The singular
   * branch under it is the same care one question further on.
   */
  const where =
    total === 0
      ? `Carry on out loud from wherever the conversation had got to.`
      : next === null
        ? `Every question on your list has been answered. Do not ask another one: comment on where the conversation had got to, say the warm and specific sentence about how they did, and say goodbye — the ending your instructions describe.`
        : next === 1
          ? `Nothing on your list has been answered yet. Ask question 1 now and carry on down the list from there.`
          : next === 2
            ? `Question 1 on your list has been asked and answered already. Do not go back over it and do not ask it again. Ask question 2 now, and carry on down the list from there.`
            : `Questions 1 to ${next - 1} on your list have been asked and answered already. Do not go back over them and do not ask them again. Ask question ${next} now, and carry on down the list from there.`;
  return `${SYSTEM_NOTE} The connection dropped and has been remade, so you have lost your memory of this conversation — the learner has not, and they are mid-lesson with you. ${where} Do not greet them, do not introduce yourself and do not say hello: you are picking a conversation back up, not starting one. Say nothing about the connection, the fault or your memory of it.`;
}

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

/**
 * How fast the tutor talks, as a teacher asks for it.
 *
 * THERE IS NO KNOB FOR THIS AND THERE IS NOT GOING TO BE ONE. The Live API's
 * `speechConfig` takes a voice and a language code; a speaking rate is an open
 * request against it and nothing more. This rig used to have one — the settings
 * table carried OpenAI Realtime's speaking rate until that provider came out —
 * and what replaced it on Gemini is this: prose, composed into the prompt.
 *
 * SO IT IS WRITTEN AS STRUCTURE AND NEVER AS A RATE, which is the whole design
 * and it is not a preference. "Speak slowly" is a rate instruction, and rate is
 * the first thing these models revert on: it holds for two or three turns and
 * then climbs back to the register the model prefers. A ceiling on the words in
 * a sentence and an explicit pause between sentences produce slow speech as a
 * consequence of structure, and structure survives a long call. The A1 preset
 * in instructions.ts found that out first and says so at length; this is the
 * same finding, made available to every manner rather than to one preset.
 *
 * IT IS A TEACHER'S AND NOT AN ADMINISTRATOR'S, which is `patience`'s argument
 * in vocoSessions.ts and the reason the two sit beside each other on /teach.
 * They are the two halves of one question: patience is how long the tutor waits
 * for the learner, this is how fast it talks at them, and how much of either a
 * room needs is known by the person standing in it.
 *
 * NATURAL SENDS NOTHING, in the sense the whole rig means it — not a paragraph
 * asking for an ordinary pace, but no paragraph at all, which is the prompt
 * every lesson published before this control existed composed. See `PATIENCE`
 * in settings.ts, which makes the same distinction about a knob.
 *
 * WHAT IT CANNOT DO, said here because it is invisible from the outside: this
 * is an instruction and not a setting, so it is followed rather than obeyed.
 * You cannot read a payload back to check it took, the way `silenceDurationMs`
 * can be read back. The only test is listening to a call.
 *
 * ON ONE PROVIDER THAT IS NO LONGER THE WHOLE STORY. OpenAI's realtime session
 * takes `audio.output.speed`, which is a rate applied to the synthesis rather
 * than a request made of the model — obeyed, and readable back off the payload.
 * So each entry below now carries a `speed` as well as its prose, and the
 * publish route spends both where the model has one. They are not alternatives:
 * the prose shortens sentences and narrows the vocabulary, which no playback
 * rate can do, and the rate slows delivery, which no instruction reliably does.
 *
 * THE NUMBERS ARE CONSERVATIVE AND SHOULD BE TUNED BY EAR, like PATIENCE's. The
 * field's range is 0.25–1.5 and the bottom of it is unintelligible; these are
 * two small steps down, on the reasoning that a tutor already speaking six-word
 * sentences does not also need to sound slowed down on a tape.
 */
export type Pace = 'natural' | 'measured' | 'slow';

export const PACE: Array<{
  key: Pace;
  label: string;
  hint: string;
  /** The block composed under HOW YOU SPEAK. Empty composes no section at all. */
  text: string;
  /**
   * The synthesis rate, where the model takes one. Absent sends no field, on
   * the same terms as every other absent setting — see SessionSettings.
   */
  speed?: number;
}> = [
  {
    key: 'natural',
    label: 'Natural',
    hint: "The tutor's own pace. What every lesson used before this control existed.",
    text: '',
  },
  {
    key: 'measured',
    label: 'Measured',
    hint: 'Shorter sentences, one idea at a time. For a class that follows but has to work at it.',
    text: `Keep each sentence to about ten words and put one idea in each. Finish a
sentence before you start the next, and leave a beat between them. Prefer the
everyday word to the exact one.`,
    speed: 0.9,
  },
  {
    key: 'slow',
    label: 'Slow',
    hint: 'Six-word sentences with a pause between them. For beginners assembling a sentence a word at a time.',
    text: `Keep each sentence to about six words. Say one thing at a time, and leave a
clear pause before the next sentence. Use the same small set of everyday words
over and over rather than reaching for a new one. When a word matters, say it
once on its own before you use it in a sentence.`,
    speed: 0.8,
  },
];

/** The block a lesson's pace asks for. Unknown reads as natural, like patience. */
export function paceText(pace: string | undefined): string {
  return (PACE.find((entry) => entry.key === pace) ?? PACE[0]).text;
}

/**
 * The synthesis rate a lesson's pace asks for, where the model has one.
 *
 * Undefined for `natural` and for anything unrecognised, which is the same
 * answer `paceText` gives and means the same thing: send no field.
 */
export function paceSpeed(pace: string | undefined): number | undefined {
  return (PACE.find((entry) => entry.key === pace) ?? PACE[0]).speed;
}

/**
 * How the tutor sounds — the accent, not the language.
 *
 * WHAT THIS IS FIXING. The French voices on gpt-realtime speak French with an
 * American accent, which for a rig whose whole purpose is a language tutor is
 * close to the worst available defect: the learner is copying it. There is no
 * setting for this. OpenAI's realtime API has no accent or locale field at all
 * — `audio.output.voice` takes a bare name, and the ISO code we send goes to
 * the *transcriber* and never touches synthesis (see openAiSession in
 * functions/api/live/_setup.ts). The prompt is the only lever there is.
 *
 * AND WE HAD NEVER PULLED IT. Every preset in instructions.ts says "Speak
 * French", which is an instruction about *which language* and says nothing
 * about how it should sound. Nothing anywhere in this file asserted a native
 * identity. The documented lever had simply never been used.
 *
 * THE SHAPE IS OPENAI'S OWN, from their realtime prompting guide: name the
 * variety in the role line, say it has to hold, and do not be vague. Their
 * worked example is "You are french quebecois speaking customer service bot" —
 * a nationality stated flatly, up front. The guide is explicit that vague
 * phrasing ("sound French") causes drift and, worse, unintended language
 * switching, which is why the last paragraph below exists to nail the accent
 * and the language apart.
 *
 * IT GOES AT THE TOP OF THE PROMPT, WHICH BREAKS THIS FILE'S OTHER RULE.
 * composeTutorPrompt's header says a constraint that must hold for a whole call
 * survives longest at the *end*. That rule is right about pace and wrong here,
 * because OpenAI's guide puts accent in the role line specifically and the
 * stability clause is what carries the duration instead of the position. If it
 * turns out to drift anyway, moving it down beside HOW YOU SPEAK is the first
 * thing to try — and unlike most of this file, that is an afternoon's test
 * rather than an argument.
 *
 * HOW FAR IT CAN GET, said plainly because the ceiling is low and known. This
 * is an instruction, so it is followed rather than obeyed — the same caveat
 * PACE makes above, with no readable-back field to check it against. Beyond
 * that, accent quality on this provider is a reported regression: it collapsed
 * at gpt-realtime-1.5 and has not recovered through 2.x, with French named
 * repeatedly as one of the worst affected. OpenAI's own guide concedes that
 * prompting "cannot fully replace voice design", and points at Custom Voices,
 * which are gated behind their sales team. So: try this, listen, and if it is
 * not enough the next lever is pinning the older gpt-realtime — deprecated but
 * served until 2027-01-20 — not a better paragraph here.
 */
export type Accent = 'native' | 'off';

/**
 * ABSENT MEANS `native`, WHICH INVERTS THIS APP'S USUAL RULE ON PURPOSE.
 * Everywhere else — see SessionSettings — an unset field means "send nothing
 * and leave the decision upstream", because upstream has a default worth
 * deferring to. There is no upstream default here. There is only prose we
 * either send or do not, and *not sending it is the thing that produces the
 * American accent*. So the good value is the one you get by doing nothing, and
 * `off` is an explicit opt-out kept for one purpose: measuring a run against
 * the lessons composed before this existed.
 */
export const ACCENT: Array<{
  key: Accent;
  label: string;
  hint: string;
  /** The block composed above the prompt. Empty composes nothing at all. */
  render: (language: LanguageChoice) => string;
}> = [
  {
    key: 'native',
    label: 'Native speaker',
    hint: "Names the variety the tutor speaks and asks it to hold. French gets Parisian; see `variety` in languages.ts.",
    render: (language) => {
      /*
       * "a native Parisian French speaker", or "a native Japanese speaker"
       * where no variety is filled in. The unregioned form is still worth
       * sending: it is the assertion of nativeness doing most of the work, and
       * a language with no `variety` should not silently compose nothing.
       */
      const variety = language.variety
        ? `${language.variety} ${language.label}`
        : language.label;

      return `You are a native ${variety} speaker. You have spoken it all your life, and
it is the accent you have when you are not thinking about it: its vowels, its
rhythm, where it puts the stress in a phrase. Hold it steady from your first
word to your last — not just in your opening turn, but in the twentieth one
too.

Sound like an ordinary person from where you are from, not like someone doing
an impression of one. Do not exaggerate it, and never let it cost you clarity:
the person you are talking to is learning this language and is listening to you
for how the sounds are supposed to go.

This is about how you sound and nothing else. It never changes which language
you speak, and it never changes what you say.`;
    },
  },
  {
    key: 'off',
    label: 'Say nothing about it',
    hint: 'Composes no accent block. What every lesson ran on before this control existed, and the only way to A/B against one.',
    render: () => '',
  },
];

/**
 * The accent block to put above a prompt, for a language and a choice.
 *
 * Unknown reads as `native` rather than as `off`, which is the same fallback
 * `paceText` makes and means something stronger here: a lesson carrying a value
 * this build no longer recognises should get the good accent, not lose it.
 */
export function accentText(language: LanguageChoice, accent: string | undefined): string {
  const entry = ACCENT.find((option) => option.key === accent) ?? ACCENT[0];
  return entry.render(language);
}

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
  /**
   * How fast the tutor talks, or absent for its own pace.
   *
   * The teacher's, off the lesson rather than out of the house library — see
   * `PACE` above on why this one is not an administrator's. Absent and
   * 'natural' compose the same prompt, which is the prompt every lesson
   * published before this existed composed.
   */
  pace?: string;
  questions: string[];
  /**
   * Whether this call has the progress tool. Absent reads as yes.
   *
   * A PROMPT THAT DESCRIBES A CHANNEL THE CALL DOES NOT HAVE IS A PROMPT THAT
   * INVITES THE MODEL TO IMPROVISE ONE. The reporting section is nine hundred
   * characters telling the tutor to call a tool, insisting the call is silent,
   * and warning it not to read the name aloud — and where no tool is declared,
   * every one of those sentences is about nothing. The likeliest thing a model
   * does with an instruction it cannot follow is say it.
   *
   * So the section is composed only where the tool exists. See
   * `acceptsProgressTool` in models.ts for which surfaces those are, and
   * `acceptProgress` in useVoiceCall.ts for what counts the questions when this
   * is false.
   */
  reportsProgress?: boolean;
}

/**
 * The progress protocol, composed only where a tool exists to carry it.
 *
 * LIFTED OUT OF THE TEMPLATE RATHER THAN WRAPPED IN A TERNARY INSIDE IT,
 * because it is the longest single section in the prompt and a conditional in
 * the middle of the composed string is where a missing newline hides. The
 * template now reads as the order of the sections, which is what the note on
 * composeTutorPrompt says it is for.
 */
function REPORTING(count: number): string {
  return `REPORTING YOUR PROGRESS
Call ${PROGRESS_TOOL} as soon as the learner has finished answering a question,
with that question's number — once each, in order, up to ${count}. Finished is
about their answer and not about your reply: make the call at the top of the
turn you take in response, alongside whatever you say in it. Do not wait until
you have replied, and do not carry it into a later turn — a later turn may never
come, and the learner is left sitting in silence while you hold a call back.

The number is the question they just answered — the one you last asked — and
never the one you are about to ask. Almost every turn you take does both things
at once: you comment on their answer to a question and then ask the next one. In
that turn the number is the question you are commenting on, not the question you
are asking. So a turn where you go on to ask question 3 carries the call for
question 2.

Never spend a turn on the call alone either: a turn with nothing but bookkeeping
in it is silence too. It is between you and the program, so never mention it,
never say how many questions are left, and carry straight on talking.

Making the call is not saying it. It goes out through the tool, on a channel of
its own that the learner never hears. Its name written into your turn is not the
call at all — that is you pronouncing "${PROGRESS_TOOL}", or worse
"call:${PROGRESS_TOOL}{number:2}", out loud to a beginner in the middle of a
sentence they are trying to follow. If the tool is not there to call, say nothing
about it and carry on with the lesson.

`;
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

  /*
   * The pace block, or nothing at all.
   *
   * PLACED AFTER THE RULES AND BEFORE THE PROTOCOL, which is a choice between
   * two of this file's own arguments. It could sit under YOUR JOB, where it
   * would read as a qualification of the manner — but pace is the constraint
   * that drifts soonest, and the header's rule is that what has to hold for a
   * whole call survives longest late in the prompt. So it goes with the other
   * pedagogy, at the end of it, under a heading of its own that the model can
   * hold on to. The protocol below it is machinery and reads as machinery.
   *
   * A heading with no body would be worse than no heading: an empty section is
   * a section the model fills in for itself. Natural composes neither.
   */
  const pace = paceText(parts.pace);
  const paceBlock = pace ? `HOW YOU SPEAK\n${pace}\n\n` : '';

  /*
   * The whole protocol section, or nothing where there is no tool to describe.
   *
   * NOTHING REPLACES IT. There is no weaker instruction to fall back on —
   * "keep track of where you are" is the tutor's own business and it does that
   * anyway, and saying it aloud is how a tutor comes to announce its position
   * on the list, which HOW THIS STARTS spends a paragraph forbidding. Where
   * there is no tool the program does the counting and never asks about it.
   */
  const reporting = parts.reportsProgress === false ? '' : REPORTING(count);

  /*
   * NOTES FROM THE SYSTEM ends by saying the one thing the tutor can tell the
   * program goes out as a tool call. Where there is no tool there is no such
   * thing, and the honest ending is that nothing goes back at all.
   */
  const backChannel =
    parts.reportsProgress === false
      ? `There is nothing you can say to the
program, and nothing you can send it either: everything you produce is speech.`
      : `There is nothing you can say to the
program: the one thing you can tell it goes out as a tool call and not as words.`;

  return `${personaBlock(parts.persona)}YOUR JOB
${parts.style.trim()}

THE LESSON
These ${count} questions are the whole lesson. Ask them in order, one at a time:

${questions.join('\n')}

${rules}

${paceBlock}${reporting}HOW THIS STARTS
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
beginner in the middle of their lesson. ${backChannel}
Everything in a turn, they hear.`;
}
