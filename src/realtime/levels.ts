/**
 * The level a learner is working towards, and what counts as evidence of it.
 *
 * Shared by the browser and the Pages Functions for the same reason
 * languages.ts is: the picker and the prompt cannot drift apart, and a level
 * code the client sends is looked up here before anything is built from it.
 *
 * Deliberately free of imports: functions/ compiles against workers-types with
 * no DOM lib, so this has to stay pure data.
 *
 * TWO LEVELS EXIST AND ONLY ONE IS STORED. This table is the level a student is
 * *aspiring* to — a declaration only they can make. The level they are actually
 * at is read out of the transcript by the report pass, and storing that would
 * mean maintaining a number the next conversation immediately restates. The
 * report is the gap between the two.
 *
 * WHY THE INVENTORY IS LANGUAGE-NEUTRAL
 *
 * CEFR is written to be, which is the whole reason it is worth borrowing: "can
 * give reasons for an opinion" is a claim about what the speaker can do, not
 * about which verb form they did it with. So this table stays one-dimensional
 * and the model instantiates each item for whichever language the call was in —
 * French subjunctive, German subordinate word order, Japanese plain/polite
 * register, all of them evidence of the same underlying ability.
 *
 * The alternative is a grammar syllabus per language: twenty tables to write,
 * twenty to keep right, and a wrong one that nothing would catch. If a language
 * ever needs a genuine exception, add it as an override keyed on the language
 * code rather than forking the table.
 *
 * NO C2. It is a real level and this is the wrong instrument for it: the C1/C2
 * boundary is about precision and register sustained over long discourse, and a
 * ten-minute voice call cannot produce the evidence. Offering it would mean
 * reporting "not demonstrated" every time, which reads as failure rather than
 * as the measurement being out of range.
 */

export interface LevelChoice {
  /** CEFR code. The key the client sends; also what the report is built from. */
  code: string;
  /** What the picker shows. */
  label: string;
  /**
   * The can-do statement, in the learner's terms rather than a grammarian's.
   *
   * Goes into the report prompt verbatim, so it has to read as something a
   * student would recognise as a goal. "Can use the conditional" is a syllabus
   * item; "can say what they would do in a situation they are not in" is a
   * thing somebody actually wants to be able to do.
   */
  descriptor: string;
  /**
   * What the report pass checks the transcript against, one entry at a time.
   *
   * Kept to six per level on purpose. This list becomes a section of the
   * report, and a checklist long enough to be exhaustive is one nobody reads —
   * the same reason the report caps error patterns at three.
   */
  structures: string[];
  /**
   * Question strategies that force the structures above into the open.
   *
   * NOTHING READS THIS YET. It belongs to the live tutor prompt rather than the
   * report — the argument being that asking a learner to "use a comparative"
   * produces nothing, while asking which of their two brothers is taller
   * produces one without the learner knowing they were steered. Written as
   * strategies rather than sentences so they survive the language changing.
   *
   * Left unwired because instructions.ts holds the wordings being compared
   * against each other, and a block appended to every preset changes what those
   * comparisons mean. Wire it the way withPersona is wired — a labelled block
   * around byte-identical preset text — when the student page needs it.
   */
  elicit: string[];
}

/**
 * Ascending, and the default is named rather than positional.
 *
 * languages.ts can say "first entry is the default" because its order is
 * arbitrary. This one's is not: a level picker that does not run A1 to C1 is
 * broken, and A1 is the one level nobody aspires to. So the convention is
 * dropped here rather than bent, and defaultLevelCode says which it is.
 */
export const LEVELS: LevelChoice[] = [
  {
    code: 'A1',
    label: 'A1 — Getting started',
    descriptor:
      'Can introduce themselves, answer simple questions about who they are and what they like, and get by on single words and set phrases.',
    structures: [
      'present tense of the most common verbs',
      'naming things and describing them with a simple adjective',
      'numbers, dates and prices',
      'simple questions — what, where, who',
      'saying no, and saying what they do not have',
      'saying what they like and do not like',
    ],
    elicit: [
      'ask their name, where they live, what they like — one question per turn',
      'offer two possible answers to choose between rather than an open question',
      'ask them to count, or to say a date or a price',
    ],
  },
  {
    code: 'A2',
    label: 'A2 — Everyday things',
    descriptor:
      'Can talk about their background, daily routine and immediate surroundings in simple terms, and handle a short everyday exchange.',
    structures: [
      'telling what happened, as a finished event',
      'saying what they are going to do',
      'comparing two things',
      'joining sentences with and, but, because, so',
      'saying how often, and when',
      'asking for something, and offering something',
    ],
    elicit: [
      'ask what they did yesterday or at the weekend',
      'ask them to compare two things they own, or two places they know',
      'ask what they are doing later, and why',
    ],
  },
  {
    code: 'B1',
    label: 'B1 — Holding a conversation',
    descriptor:
      'Can string sentences together to describe experiences, give reasons for an opinion, and cope with most situations that come up while travelling.',
    structures: [
      'contrasting a finished event with one that was going on or used to happen',
      'saying what they would do in a situation they are not in',
      'clauses joined with that, which, who',
      'an opinion followed by the reason for it',
      'reporting what somebody else said',
      'saying what they must, can, and are allowed to do',
    ],
    elicit: [
      'ask why they prefer one thing over another, and follow up on the reason',
      'ask what they would do in a named situation they are not in',
      'ask what someone else said to them, and what they said back',
      'ask about something that used to be true and no longer is',
    ],
  },
  {
    code: 'B2',
    label: 'B2 — Arguing a point',
    descriptor:
      'Can talk at length on a range of subjects, argue a position and follow somebody else down theirs, and keep up without either side slowing down.',
    structures: [
      'saying what would have happened if things had gone differently',
      'describing something without saying who did it',
      'conceding a point — although, even if, admittedly',
      'shifting between formal and informal ways of saying the same thing',
      'sustaining one argument across several turns',
      'hedging — saying how sure they are, and how sure they are not',
    ],
    elicit: [
      'ask what they would have done differently, looking back',
      'ask them to argue the case against their own position',
      'ask how something is done where they live, without naming who does it',
      'disagree with them mildly and see whether they concede or hold the line',
    ],
  },
  {
    code: 'C1',
    label: 'C1 — Saying it precisely',
    descriptor:
      'Can say what they mean fluently and without visibly searching for it, and bend the language to the situation rather than the other way round.',
    structures: [
      'idiom, and the words that habitually go together',
      'fine degrees of certainty, obligation and reluctance',
      'markers that hold a long turn together — mind you, that said, in any case',
      'catching and repairing their own slip without losing the thread',
      'irony, understatement, saying one thing and meaning another',
      'adjusting how they speak to who they are speaking to',
    ],
    elicit: [
      'ask them to sum up, fairly, an argument they disagree with',
      'ask them to choose between two options that are genuinely close',
      'ask a question that invites an idiom rather than a literal answer',
    ],
  },
];

export function findLevel(code: string): LevelChoice | undefined {
  return LEVELS.find((level) => level.code === code);
}

/**
 * B1, not A1 and not the first entry.
 *
 * It is the level most people mean by "I want to be able to hold a
 * conversation", which is what a student opening this page came for. A beginner
 * aiming at B1 gets a report full of "not attempted", and that is the honest
 * reading of a target rather than a failure of the measurement.
 */
export function defaultLevelCode(): string {
  return 'B1';
}
