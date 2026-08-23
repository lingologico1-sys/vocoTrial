/**
 * The elicitation tiers, and the question bank that reaches them.
 *
 * WHY A TIER EXISTS AT ALL. The advanced marker can only read what the
 * conversation produced. A structure is assessable only where a question
 * created an obligatory context for it — rule R3 — so a lesson that never asks
 * for past narration produces no evidence about past narration, and the marker
 * correctly reports that as unprobed rather than as a failure. The consequence
 * for a teacher is concrete and not obvious: a present-tense-only lesson cannot
 * tell a 5 apart from a 7, because everything separating them was never asked
 * for. That is a fact about the lesson, not about the students.
 *
 * IT IS NOT A CAP, AND THE COPY MUST NEVER SAY IT IS. Low coverage does not
 * suppress a mark; per R3 the marker scores what was elicited with no ceiling
 * applied. What narrow coverage costs is discrimination, not marks. "This
 * lesson will mark low" is false and reads as the tool punishing a teacher's
 * students for the teacher's question list; "this lesson will not separate a 5
 * from a 7" is true and is the thing worth acting on. See `computeConfidence`.
 *
 * TAGS FIRST, CUES ONLY AS A FALLBACK. Every question below carries the tier it
 * belongs to, so a teacher who inserts from the bank gets a reading that is
 * exactly right and cannot false-positive. Cue matching runs only over
 * free-typed questions, only for tiers 3 and 4, and only on phrases that are
 * hard to write by accident. A free-typed question matching nothing is reported
 * as nothing — it is not guessed at, and the hint stays silent rather than
 * wrong.
 *
 * A PRESENT-TENSE LESSON IS A LEGITIMATE LESSON. Early in the year, with
 * beginners, or as a warm-up, Tier 1 alone is the right list. Everything built
 * on this file informs and never blocks, and nothing in it is phrased as a
 * correction.
 *
 * Deliberately free of DOM imports, so the same tags are available to anything
 * that later wants to read them server-side.
 */

export type Tier = 1 | 2 | 3 | 4;

/** What each tier is for, in the terms a teacher thinks in. */
export const TIER_NOTES: Record<Tier, { name: string; targets: string }> = {
  1: {
    name: 'Present tense, familiar environment',
    targets: 'présent, thematic vocabulary, il y a, aimer / détester + infinitive',
  },
  2: {
    name: 'Past events',
    targets: 'passé composé, time markers — hier, la semaine dernière, il y a deux ans',
  },
  3: {
    name: 'Past narration and description',
    targets: 'passé composé — imparfait contrast, sequencing connectors, depuis / il y a',
  },
  4: {
    name: 'Projection, opinion, justification',
    targets: 'futur simple, conditionnel, si + présent + futur, subordination, justification',
  },
};

/**
 * The two tiers that separate one band from another.
 *
 * Tiers 1 and 2 establish a floor: a student who handles them is somewhere at
 * or above A2. Neither can distinguish an A2 from a B1, because nothing in
 * either requires a structure a secure A2 does not already have. Tier 3 forces
 * the imparfait/passé composé contrast and Tier 4 forces the conditionnel and
 * the si clause, and those are the whole of what a 6 and a 7 are made of.
 */
export const DISCRIMINATING_TIERS: Tier[] = [3, 4];

export interface BankQuestion {
  text: string;
  tier: Tier;
}

/** Spec §13, tier tags intact. Ordered so a teacher reads the ladder. */
export const QUESTION_BANK: BankQuestion[] = [
  // Tier 1 — present tense, familiar environment.
  { text: 'Parlez-moi de votre famille.', tier: 1 },
  { text: 'Quels sont vos loisirs ?', tier: 1 },
  { text: 'Décrivez votre lycée.', tier: 1 },
  { text: "Qu'est-ce que vous faites le week-end ?", tier: 1 },
  { text: 'Comment est votre ville ?', tier: 1 },
  { text: 'Vous avez des animaux à la maison ?', tier: 1 },

  // Tier 2 — past events.
  { text: "Qu'est-ce que vous avez fait le week-end dernier ?", tier: 2 },
  { text: 'Quel est le dernier film que vous avez vu ?', tier: 2 },
  { text: 'Vous avez déjà visité un autre pays ?', tier: 2 },
  { text: "Qu'est-ce que vous avez mangé hier soir ?", tier: 2 },
  { text: "Parlez-moi d'une fête que vous avez célébrée récemment.", tier: 2 },

  // Tier 3 — past narration and description.
  { text: "Racontez-moi vos dernières vacances. Comment c'était ?", tier: 3 },
  { text: 'Décrivez une journée dont vous vous souvenez bien. Que s’est-il passé ?', tier: 3 },
  { text: 'Comment était votre vie quand vous étiez enfant ?', tier: 3 },
  { text: 'Parlez-moi de votre premier jour dans ce lycée.', tier: 3 },
  { text: "Vous apprenez le français depuis combien de temps ? Comment ça a commencé ?", tier: 3 },

  // Tier 4 — projection, opinion, justification.
  { text: 'Qu’aimeriez-vous faire après vos études, et pourquoi ?', tier: 4 },
  { text: 'Si vous pouviez changer une chose dans votre lycée, ce serait quoi ?', tier: 4 },
  { text: 'Où est-ce que vous habiterez dans dix ans, à votre avis ?', tier: 4 },
  { text: "Qu'est-ce que vous feriez avec beaucoup d'argent ?", tier: 4 },
  { text: 'Pensez-vous que les réseaux sociaux sont bons pour les jeunes ? Pourquoi ?', tier: 4 },
  { text: 'Quel conseil donneriez-vous à un élève qui commence le français ?', tier: 4 },
];

/**
 * Flatten a question for comparison: no case, no accents, no punctuation.
 *
 * Accents come off so a teacher who typed a bank question without them still
 * matches it, and apostrophes are levelled because a browser, a paste from Word
 * and this file's own source all disagree about which character that is.
 */
function flatten(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['‘’`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BANK_BY_TEXT = new Map(QUESTION_BANK.map((q) => [flatten(q.text), q.tier]));

/**
 * Phrases that are hard to write by accident, for free-typed questions only.
 *
 * DELIBERATELY UNDER-INCLUSIVE. A cue list that catches everything would catch
 * things it should not — `pourquoi` alone appears in plenty of Tier 1 questions
 * — and a hint that fires wrongly is worse than one that stays quiet, because a
 * teacher who is told they have covered Tier 4 stops looking. Missing a genuine
 * Tier 4 question costs one unnecessary hint; claiming one that is not there
 * costs the coverage the hint exists to protect.
 */
const TIER_CUES: Record<3 | 4, string[]> = {
  // Written post-`flatten`: no accents, and hyphens have already become spaces,
  // so "pensez-vous" is matched by the cue "pensez vous".
  3: [
    'racontez', 'racontes', "comment c'etait", 'comment etait',
    'quand vous etiez', 'quand tu etais', "que s'est il passe",
  ],
  4: [
    'aimeriez', 'aimerais', 'si vous pouviez', 'si tu pouvais',
    'pensez vous', 'penses tu', 'feriez', 'ferais',
    'donneriez', 'donnerais', 'a votre avis', 'ce serait quoi',
  ],
};

/**
 * Which tier a question reaches: its tag if it came from the bank, otherwise a
 * cue match for tiers 3 and 4, otherwise nothing.
 *
 * `null` means "not one of the two tiers that discriminate", not "tier 1". The
 * distinction matters: nothing here claims to classify a free-typed question
 * into tier 1 or 2, because nothing needs it to.
 */
export function tierOf(question: string): Tier | null {
  const flat = flatten(question);
  if (!flat) return null;

  const tagged = BANK_BY_TEXT.get(flat);
  if (tagged) return tagged;

  for (const tier of [3, 4] as const) {
    if (TIER_CUES[tier].some((cue) => flat.includes(cue))) return tier;
  }

  return null;
}

/** Which of the two discriminating tiers this question list actually reaches. */
export function discriminatingTiersCovered(questions: string[]): Tier[] {
  const found = new Set<Tier>();
  for (const question of questions) {
    const tier = tierOf(question);
    if (tier === 3 || tier === 4) found.add(tier);
  }
  return DISCRIMINATING_TIERS.filter((tier) => found.has(tier));
}

/** The discriminating tiers this list does not reach. Empty means covered. */
export function missingDiscriminatingTiers(questions: string[]): Tier[] {
  const covered = new Set(discriminatingTiersCovered(questions));
  return DISCRIMINATING_TIERS.filter((tier) => !covered.has(tier));
}

/** Every bank question at one tier, for one-tap insertion. */
export function bankFor(tier: Tier): BankQuestion[] {
  return QUESTION_BANK.filter((question) => question.tier === tier);
}

/**
 * What the hint says about one missing tier: what it costs, and the fix.
 *
 * ONE SENTENCE OF CONSEQUENCE, ONE OFFER. Named here rather than in the JSX so
 * the wording and the tier definitions cannot drift apart, and so the rule
 * about what this may not claim — see the header — is enforceable by reading
 * one function.
 */
export function tierHint(tier: Tier): string {
  if (tier === 3) {
    return 'No question here asks for past narration, so students cannot show the imparfait — ' +
      'this lesson will not separate a 5 from a 7 on grammar.';
  }
  if (tier === 4) {
    return 'No question here asks for an opinion or a projection, so students cannot show the ' +
      'conditionnel or a si clause — this lesson will not separate a 6 from a 7.';
  }
  return '';
}
