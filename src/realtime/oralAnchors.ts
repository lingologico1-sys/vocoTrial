/**
 * Calibration anchors: worked examples that are also regression tests.
 *
 * TWO JOBS, ONE FILE. `ANCHOR_6_7` is injected into every marking call as the
 * single few-shot example — spec §10b calls that the highest-leverage change
 * available for Flash-tier banding consistency, at about 1.5k extra input
 * tokens and a fraction of a cent. All five are run through Stage 1 and Stage 3
 * by `npm run anchors`, which asserts the pipeline still reproduces every
 * `expected_final` and that every quoted line genuinely appears in its own
 * transcript.
 *
 * THE LADDER, and why it is shaped like this:
 *
 *   5_clean          A2 secure, no boundary band
 *   5_6_boundary     limiting criterion is Language
 *   6_clean          the spec's own §12 example
 *   6_7_boundary     limiting criterion is Interactive Skills
 *   7_clean          the same performance, plus independent contribution
 *
 * The last two are deliberately near-identical in Language and Vocabulary and
 * differ almost only in unprompted contribution, which isolates the single
 * discriminator between a 6 and a 7 on Criterion C. That is the call the marker
 * gets wrong most often, which is why it is also the anchor that ships in the
 * prompt.
 *
 * THESE ARE SYNTHETIC AND THAT IS A LIMITATION, NOT A DETAIL. They are written
 * to exercise the rubric, not sampled from this app's own pipeline — so they
 * carry none of the disfluency, mishearing or speech-model tidying a real
 * transcript from /eleve carries. Spec §14 is blunt about the remedy: hand-mark
 * ten real transcripts and replace these. Until that happens the anchors prove
 * the arithmetic is right and prove nothing about whether the bands land on
 * real students.
 *
 * `expected_final` DELIBERATELY OMITS THE CONFIDENCE FIELDS. Confidence is a
 * function of how the *examiner* behaved, and these transcripts are examiner
 * fiction; asserting on it would freeze a property of the fixture rather than
 * of the code. Coverage and sample are still printed by the runner so a drift
 * is visible without being fatal.
 *
 * Deliberately free of DOM imports: the marking route reads this in a Worker.
 */

import type { OralLlmOutput } from './oralRubric';
import type { OralFinal } from './oralMarker';

/** What `expected_final` asserts. A subset of OralFinal — see the header. */
export type ExpectedFinal = Pick<
  OralFinal,
  | 'criterion_scores'
  | 'raw_weighted_score'
  | 'final_ib_mark'
  | 'display_mark'
  | 'is_boundary'
  | 'guards_applied'
  | 'cefr_verdict'
> &
  Partial<Pick<OralFinal, 'boundary_leaning' | 'limiting_criterion'>>;

export interface OralAnchor {
  id: string;
  label: string;
  /** What this anchor is in the suite to prove. */
  purpose: string;
  transcript: string;
  expected_llm_output: OralLlmOutput;
  expected_final: ExpectedFinal;
}

const ANCHOR_5_CLEAN: OralAnchor = {
  id: 'anchor_5_clean',
  label: 'Clean 5 — A2 secure',
  purpose:
    'Baseline. Présent and passé composé reliable, no imparfait despite a Tier 3 probe, ' +
    'minimal development, one comprehension breakdown. Tests that a competent-but-limited ' +
    'student lands squarely on 5 with no boundary band.',
  transcript: [
    'EXAMINATEUR: Bonjour. Parlez-moi de votre famille.',
    'ÉLÈVE: Euh… ma famille. Il y a ma mère, mon père et ma sœur. Ma sœur a quinze ans.',
    "EXAMINATEUR: Et qu'est-ce que vous faites le week-end ?",
    'ÉLÈVE: Le week-end je joue au foot. Et je regarde la télé avec mes amis.',
    "EXAMINATEUR: Qu'est-ce que vous avez fait le week-end dernier ?",
    "ÉLÈVE: Euh… le week-end dernier… j'ai joué au foot. Et après j'ai mangé à la maison.",
    "EXAMINATEUR: Racontez-moi vos dernières vacances. Comment c'était ?",
    'ÉLÈVE: Pardon ?',
    'EXAMINATEUR: Vos dernières vacances. Racontez-moi.',
    "ÉLÈVE: Ah oui. Euh… je suis allé au Mexique avec ma famille. C'était bien. Il y a beaucoup de plages.",
    "EXAMINATEUR: Et qu'est-ce que vous aimeriez faire après vos études ?",
    "ÉLÈVE: Euh… je vais étudier à l'université. Parce que je aime les maths.",
  ].join('\n'),
  expected_llm_output: {
    insufficient_evidence: false,
    evidence: {
      tiers_probed: [1, 2, 3, 4],
      tenses_accurate: [
        { form: 'présent', quote: 'je joue au foot' },
        { form: 'passé_composé', quote: "j'ai joué au foot" },
        { form: 'futur_proche', quote: "je vais étudier à l'université" },
      ],
      tenses_attempted_with_errors: [
        {
          form: 'imparfait',
          quote: 'Il y a beaucoup de plages',
          correction: 'Il y avait beaucoup de plages',
        },
      ],
      b1_structures_found: [],
      connectors_used: ['et', 'parce que', 'après'],
      longest_accurate_utterance: 'je suis allé au Mexique avec ma famille',
      meaning_obscuring_errors: [],
      self_corrections: [],
      precise_vocabulary: ['plages', 'maths'],
      l1_insertions: [],
      successful_paraphrases: [],
      problem_turns: [
        {
          examiner_question: "Racontez-moi vos dernières vacances. Comment c'était ?",
          student_answer: 'Pardon ?',
          issue: 'NON-ANSWER',
          attributed_to: 'C',
          attribution_ambiguous: false,
          why:
            'The student did not parse the question and asked for it to be repeated. This is a ' +
            'comprehension failure, so it is scored under Criterion C only and does not depress ' +
            'Criterion B.',
        },
        {
          examiner_question: 'Vos dernières vacances. Racontez-moi.',
          student_answer:
            "Ah oui. Euh… je suis allé au Mexique avec ma famille. C'était bien. Il y a beaucoup de plages.",
          issue: 'NO-DEVELOPMENT',
          attributed_to: 'B',
          attribution_ambiguous: false,
          why:
            'The question invited narration but the answer stops at three short statements with a ' +
            'generic evaluation. The student understood; the content did not arrive.',
        },
      ],
      unprompted_contributions: [],
    },
    scores: {
      a_language: {
        score: 5,
        why:
          'Présent, passé composé and futur proche are all used reliably and meaning is clear ' +
          'throughout. Sentences stay simple or compound and linking never goes past et / parce ' +
          'que. The Tier 3 question created an obligatory context for past description, but the ' +
          "student produced 'Il y a beaucoup de plages' in the présent where the imparfait was " +
          "required, so the past-tense contrast is not available. 'je aime' shows elision is not " +
          'yet automatic. This is the profile of a secure A2 rather than an emerging B1.',
        quotes: ["j'ai joué au foot", 'Il y a beaucoup de plages', 'Parce que je aime les maths'],
      },
      b_vocabulary_relevance: {
        score: 5,
        why:
          'Vocabulary is high-frequency and adequate for these familiar topics, but there is ' +
          "nothing precise or topic-specific beyond 'plages' and 'maths'. Every answer is " +
          'relevant to the question asked, which keeps this from dropping to 4, but answers are ' +
          'minimal — one or two short sentences that stop at the literal question with no reason, ' +
          "example or detail unless prompted. 'C'était bien' is the only evaluation offered.",
        quotes: ['Le week-end je joue au foot', "C'était bien"],
        divergence_note: null,
      },
      c_interactive_skills: {
        score: 5,
        why:
          'The exchange is sustained but the examiner is carrying it entirely. One question had ' +
          'to be rephrased before the student could engage with it. Turns are short and ' +
          'consistently close the topic rather than opening it, and the student never volunteers ' +
          'anything or asks a question. Hesitation markers appear at the start of most turns.',
        quotes: ['Pardon ?', 'Et je regarde la télé avec mes amis'],
      },
    },
    flags: { examiner_interference: false, examiner_interference_evidence: [] },
    feedback: {
      strength:
        'You answered every question you understood, and your passé composé is reliable — ' +
        "'j'ai joué', 'j'ai mangé', 'je suis allé' are all correct, including the tricky être verb.",
      fix_1: {
        student_said: 'Il y a beaucoup de plages',
        should_be: 'Il y avait beaucoup de plages',
        why:
          'You were describing what a place was like in the past, which needs the imparfait. ' +
          'This is the single structure standing between you and a 6.',
      },
      fix_2: {
        student_said: 'Parce que je aime les maths',
        should_be: "Parce que j'aime les maths",
        why:
          "Je becomes j' before a vowel. It is a small thing, but it appears constantly and " +
          'examiners notice it immediately.',
      },
      practise: {
        structure: 'imparfait for description in the past',
        model_sentence: 'Il y avait beaucoup de touristes et il faisait très chaud.',
        practice_prompt: 'Comment était votre vie quand vous étiez enfant ?',
      },
    },
  },
  expected_final: {
    criterion_scores: { A: 5, B: 5, C: 5 },
    raw_weighted_score: 5,
    final_ib_mark: 5,
    display_mark: '5',
    is_boundary: false,
    guards_applied: [],
    cefr_verdict: 'A2 confirmed',
  },
};

const ANCHOR_5_6: OralAnchor = {
  id: 'anchor_5_6_boundary',
  label: '5/6 leaning 6 — limiting criterion is Language',
  purpose:
    'A chatty, engaged student whose grammar has a hard ceiling. Vocabulary and interaction are ' +
    'both a 6; Language stays at 5 because every past description comes out in the présent. ' +
    'Tests the boundary band and the limiting_criterion field.',
  transcript: [
    'EXAMINATEUR: Bonjour. Parlez-moi un peu de vos loisirs.',
    "ÉLÈVE: Alors, j'adore la musique. Je joue de la guitare et je fais partie d'un groupe avec mes copains du lycée. On répète le mardi soir dans le garage de mon ami Thomas.",
    "EXAMINATEUR: Et qu'est-ce que vous avez fait le week-end dernier ?",
    "ÉLÈVE: Le week-end dernier on a fait un petit concert dans un café. Euh… il y a beaucoup de personnes, peut-être quarante. J'ai chanté deux chansons. J'ai très stressé mais c'est bien.",
    "EXAMINATEUR: Racontez-moi vos dernières vacances. Comment c'était ?",
    "ÉLÈVE: Euh… l'été dernier je suis allé en Californie avec ma famille. On a visité San Francisco et on a mangé beaucoup de fruits de mer. Il fait très chaud et il y a beaucoup de touristes. J'ai adoré les plages et le pont rouge.",
    "EXAMINATEUR: Et qu'est-ce que vous aimeriez faire après vos études ?",
    "ÉLÈVE: Je veux étudier la musique à l'université. Parce que c'est ma passion. C'est difficile mais je vais essayer. Mes parents préfèrent les sciences.",
  ].join('\n'),
  expected_llm_output: {
    insufficient_evidence: false,
    evidence: {
      tiers_probed: [1, 2, 3, 4],
      tenses_accurate: [
        { form: 'présent', quote: "Je joue de la guitare et je fais partie d'un groupe" },
        { form: 'passé_composé', quote: 'On a visité San Francisco' },
        { form: 'futur_proche', quote: 'je vais essayer' },
      ],
      tenses_attempted_with_errors: [
        {
          form: 'imparfait',
          quote: 'il y a beaucoup de personnes, peut-être quarante',
          correction: 'il y avait beaucoup de personnes',
        },
        {
          form: 'imparfait',
          quote: 'Il fait très chaud et il y a beaucoup de touristes',
          correction: 'Il faisait très chaud et il y avait beaucoup de touristes',
        },
        {
          form: 'passé_composé',
          quote: "J'ai très stressé mais c'est bien",
          correction: "J'étais très stressé mais c'était bien",
        },
      ],
      b1_structures_found: [],
      connectors_used: ['et', 'mais', 'parce que', 'alors'],
      longest_accurate_utterance:
        "Je joue de la guitare et je fais partie d'un groupe avec mes copains du lycée",
      meaning_obscuring_errors: [],
      self_corrections: [],
      precise_vocabulary: [
        'guitare', 'groupe', 'répète', 'concert', 'fruits de mer', 'passion', 'sciences',
      ],
      l1_insertions: [],
      successful_paraphrases: ['le pont rouge'],
      problem_turns: [],
      unprompted_contributions: [],
    },
    scores: {
      a_language: {
        score: 5,
        why:
          'Présent, passé composé and futur proche are reliable and never obscure meaning. But ' +
          'the Tier 3 question created a clear obligatory context for past description and the ' +
          "student produced the présent every time: 'il y a beaucoup de personnes' and 'Il fait " +
          "très chaud' both describe past scenes. 'J'ai très stressé' compounds this by using the " +
          'passé composé where an imparfait state was needed. Linking stays at et / mais / parce ' +
          'que. No conditionnel, no futur simple, no relative pronoun. The absence here is ' +
          'assessable because the opportunity was created.',
        quotes: [
          'Il fait très chaud et il y a beaucoup de touristes',
          "J'ai très stressé mais c'est bien",
          'On a visité San Francisco et on a mangé beaucoup de fruits de mer',
        ],
      },
      b_vocabulary_relevance: {
        score: 6,
        why:
          'Vocabulary is well beyond high-frequency and clearly tied to each topic — guitare, ' +
          'répète, concert, fruits de mer, passion. Every answer addresses the question asked and ' +
          'each one carries supporting detail supplied without prompting: the rehearsal night, ' +
          "the size of the audience, the specific city. 'le pont rouge' is a successful workaround " +
          "for a word the student did not have. This falls short of 7 only because 'c'est bien' " +
          "and 'C'est difficile' are generic evaluations where a stronger candidate would qualify " +
          'or justify.',
        quotes: [
          "On répète le mardi soir dans le garage de mon ami Thomas",
          'il y a beaucoup de personnes, peut-être quarante',
          "J'ai adoré les plages et le pont rouge",
        ],
        divergence_note: null,
      },
      c_interactive_skills: {
        score: 6,
        why:
          'Every question is understood at first asking; the examiner never repeats, rephrases or ' +
          'falls back on English. Turns are consistently multi-sentence and the student is doing ' +
          'most of the talking. Hesitation appears but never stalls a turn. This stops at 6 rather ' +
          'than 7 because the student never opens a direction the examiner did not raise and never ' +
          "asks the examiner anything — 'Mes parents préfèrent les sciences' is the closest thing " +
          'to an independent contribution, but it closes the answer rather than opening a new thread.',
        quotes: ["Alors, j'adore la musique", 'Mes parents préfèrent les sciences'],
      },
    },
    flags: { examiner_interference: false, examiner_interference_evidence: [] },
    feedback: {
      strength:
        'Your vocabulary is genuinely strong and you always give more than the minimum — the ' +
        'rehearsal night, the size of the audience, the specific places. That habit of adding ' +
        'detail without being asked is what a 7 sounds like.',
      fix_1: {
        student_said: 'Il fait très chaud et il y a beaucoup de touristes',
        should_be: 'Il faisait très chaud et il y avait beaucoup de touristes',
        why:
          'You were describing what California was like last summer, so this needs the imparfait. ' +
          'You did this in every past description, which is the one thing holding your Language ' +
          'mark at 5.',
      },
      fix_2: {
        student_said: "J'ai très stressé mais c'est bien",
        should_be: "J'étais très stressé mais c'était bien",
        why:
          'How you felt is a state, not an event, so it takes the imparfait rather than the passé ' +
          "composé. Events use j'ai chanté; states use j'étais.",
      },
      practise: {
        structure: 'imparfait for description and states in the past',
        model_sentence: "Il faisait beau, il y avait du monde, et j'étais un peu nerveux.",
        practice_prompt: "Parlez-moi de votre premier jour dans ce lycée. Comment c'était ?",
      },
    },
  },
  expected_final: {
    criterion_scores: { A: 5, B: 6, C: 6 },
    raw_weighted_score: 5.6,
    final_ib_mark: 6,
    display_mark: '5/6',
    is_boundary: true,
    boundary_leaning: '6',
    limiting_criterion: 'Language',
    guards_applied: [],
    cefr_verdict: 'A2 confirmed',
  },
};

/**
 * The spec's own §12 worked example, brought in as a fifth rung.
 *
 * ITS `expected_final` IS COMPUTED, NOT COPIED. §12 prints a "verified Stage 1
 * and Stage 3 output" block that reports confidence MEDIUM on a THIN sample
 * because the student "produced 149 words, slightly under the 150-word target".
 * No 150-word target exists in §9.2's code: sample is ADEQUATE at four
 * questions and sixty words, and §9.2 argues at length that gating on word
 * count would systematically mark weaker candidates low-confidence for being
 * weak. That block is stale prose from an earlier revision of the rule. The
 * criterion scores and the mark in it are consistent with the code and are what
 * this anchor asserts; the confidence line is not asserted by any anchor.
 */
const ANCHOR_6_CLEAN: OralAnchor = {
  id: 'anchor_6_clean',
  label: 'Clean 6 — the spec’s §12 example',
  purpose:
    'Five tenses accurate including the imparfait/passé composé contrast and a conditionnel, but ' +
    'no si clause and no futur simple. Uniform 6/6/6, so it lands on a whole number with no ' +
    'boundary band — the control against which the two boundary anchors are read.',
  transcript: [
    'EXAMINATEUR: Bonjour. Parlez-moi un peu de votre famille.',
    'ÉLÈVE: Euh… oui. Dans ma famille nous sommes quatre. Il y a ma mère, mon père et mon petit frère qui a douze ans. Ma mère est infirmière et mon père travaille dans un bureau. On habite ensemble à Vancouver.',
    "EXAMINATEUR: Et qu'est-ce que vous avez fait le week-end dernier ?",
    "ÉLÈVE: Le week-end dernier je suis allé… je suis allée au cinéma avec deux amies. On a vu un film français, euh, c'était vraiment bien. Après on a mangé une pizza parce que on avait très faim.",
    'EXAMINATEUR: Racontez-moi vos dernières vacances.',
    "ÉLÈVE: Alors, l'été dernier je suis allée en France avec ma famille. Euh… on a visité Paris et Lyon. Il faisait très chaud et il y avait beaucoup de touristes. J'ai adoré le musée, euh, comment dire… le musée d'Orsay. C'était magnifique.",
    "EXAMINATEUR: Et qu'est-ce que vous aimeriez faire après vos études ?",
    "ÉLÈVE: Euh… je voudrais étudier la médecine. Parce que ma mère est infirmière et j'aime beaucoup aider les gens. Peut-être je vais aller à l'université à Montréal.",
  ].join('\n'),
  expected_llm_output: {
    insufficient_evidence: false,
    evidence: {
      tiers_probed: [1, 2, 3, 4],
      tenses_accurate: [
        { form: 'présent', quote: 'Ma mère est infirmière et mon père travaille dans un bureau' },
        { form: 'passé_composé', quote: 'on a visité Paris et Lyon' },
        { form: 'imparfait', quote: 'Il faisait très chaud et il y avait beaucoup de touristes' },
        { form: 'conditionnel', quote: 'je voudrais étudier la médecine' },
        { form: 'futur_proche', quote: "je vais aller à l'université à Montréal" },
      ],
      tenses_attempted_with_errors: [],
      b1_structures_found: [
        { type: 'relatif', quote: 'mon petit frère qui a douze ans' },
        {
          type: 'imparfait_narratif',
          quote: 'Il faisait très chaud et il y avait beaucoup de touristes',
        },
        { type: 'conditionnel', quote: 'je voudrais étudier la médecine' },
      ],
      connectors_used: ['parce que', 'et', 'après', 'alors', 'peut-être'],
      longest_accurate_utterance: "l'été dernier je suis allée en France avec ma famille",
      meaning_obscuring_errors: [],
      self_corrections: ['je suis allé… je suis allée'],
      precise_vocabulary: [
        'infirmière', 'bureau', 'touristes', "musée d'Orsay", 'la médecine', 'université',
      ],
      l1_insertions: [],
      successful_paraphrases: [],
      problem_turns: [],
      unprompted_contributions: [],
    },
    scores: {
      a_language: {
        score: 6,
        why:
          'Five tenses used accurately, including the passé composé/imparfait contrast in the ' +
          'holiday narration and a conditionnel de politesse. A relative pronoun appears ' +
          'naturally. Subordination goes beyond parce que but multi-clause sentences do not yet ' +
          "outnumber single-clause ones, and 'parce que on avait' shows the elision (parce qu'on) " +
          'is not yet automatic. No si clause and no futur simple, so the top band is not reached.',
        quotes: [
          'Il faisait très chaud et il y avait beaucoup de touristes',
          'mon petit frère qui a douze ans',
          'je voudrais étudier la médecine',
        ],
      },
      b_vocabulary_relevance: {
        score: 6,
        why:
          'Vocabulary is precise and topic-specific (infirmière, touristes, la médecine) with ' +
          'almost no generic adjectives and no L1. Every answer addresses the question asked, and ' +
          'each carries a supporting detail without being prompted. Development stays at one or ' +
          "two supporting elements rather than the sustained expansion of a 7, and 'c'était " +
          "vraiment bien' is the one generic evaluation.",
        quotes: [
          "Parce que ma mère est infirmière et j'aime beaucoup aider les gens",
          "J'ai adoré le musée, euh, comment dire… le musée d'Orsay",
        ],
        divergence_note: null,
      },
      c_interactive_skills: {
        score: 6,
        why:
          'Every question understood at first asking; the examiner never repeats, rephrases or ' +
          'uses English. Turns are consistently multi-sentence and the word ratio is comfortably ' +
          'above 2:1. Hesitation is present but the student always recovers, notably working ' +
          "around a retrieval problem with 'comment dire' before landing the word. No independent " +
          'contribution: the student never volunteers a new direction or asks the examiner ' +
          'anything, which holds this at 6 rather than 7.',
        quotes: [
          "J'ai adoré le musée, euh, comment dire… le musée d'Orsay",
          'Après on a mangé une pizza parce que on avait très faim',
        ],
      },
    },
    flags: { examiner_interference: false, examiner_interference_evidence: [] },
    feedback: {
      strength:
        'You moved between the passé composé and the imparfait correctly when describing your ' +
        'holiday — that contrast is the single clearest marker of B1-level French, and you ' +
        'handled it without being prompted.',
      fix_1: {
        student_said: 'parce que on avait très faim',
        should_be: "parce qu'on avait très faim",
        why:
          "Que becomes qu' before a vowel. This one is worth drilling because it appears in almost " +
          'every sentence where you give a reason.',
      },
      fix_2: {
        student_said: "Peut-être je vais aller à l'université à Montréal",
        should_be: "J'irai peut-être à l'université à Montréal",
        why:
          'You reached for the futur proche where the futur simple would be stronger. Using the ' +
          'futur simple for real future plans is what separates a 6 from a 7.',
      },
      practise: {
        structure: 'futur simple',
        model_sentence: "L'année prochaine, j'étudierai la médecine à Montréal.",
        practice_prompt: 'Où est-ce que vous habiterez dans dix ans, à votre avis ?',
      },
    },
  },
  expected_final: {
    criterion_scores: { A: 6, B: 6, C: 6 },
    raw_weighted_score: 6,
    final_ib_mark: 6,
    display_mark: '6',
    is_boundary: false,
    guards_applied: [],
    cefr_verdict: 'B1 confirmed',
  },
};

const ANCHOR_6_7: OralAnchor = {
  id: 'anchor_6_7_boundary',
  label: '6/7 leaning 7 — limiting criterion is Interactive Skills',
  purpose:
    'Strong B1 grammar and precise vocabulary, but the student never volunteers anything. Paired ' +
    'with anchor_7_clean, which is near-identical apart from unprompted contribution. This pair ' +
    'isolates the single 6/7 discriminator on Criterion C.',
  transcript: [
    'EXAMINATEUR: Bonjour. Racontez-moi vos dernières vacances.',
    "ÉLÈVE: Alors, l'été dernier je suis allée en Bretagne avec mes grands-parents. On a loué une petite maison près de la mer. Il pleuvait presque tous les jours, mais ça ne me dérangeait pas parce que j'ai passé beaucoup de temps à lire. Un jour, quand le soleil est enfin sorti, on a fait une randonnée qui durait trois heures.",
    "EXAMINATEUR: Et qu'est-ce que vous aimeriez faire après vos études ?",
    "ÉLÈVE: J'aimerais étudier l'architecture. Si je réussis mes examens, j'irai à Montréal l'année prochaine. Mon oncle est architecte et son travail me fascine depuis que je suis petite.",
    'EXAMINATEUR: Pensez-vous que les réseaux sociaux sont bons pour les jeunes ?',
    "ÉLÈVE: C'est compliqué. Je pense qu'ils sont utiles pour rester en contact avec les amis qui habitent loin. Mais beaucoup de personnes passent trop de temps devant leur téléphone, et ça peut être mauvais pour la concentration.",
    'EXAMINATEUR: Et vos loisirs ?',
    "ÉLÈVE: Je fais de la natation trois fois par semaine et je dessine beaucoup. C'est utile pour l'architecture.",
  ].join('\n'),
  expected_llm_output: {
    insufficient_evidence: false,
    evidence: {
      tiers_probed: [1, 3, 4],
      tenses_accurate: [
        { form: 'présent', quote: 'Je fais de la natation trois fois par semaine' },
        { form: 'passé_composé', quote: 'on a fait une randonnée' },
        { form: 'imparfait', quote: 'Il pleuvait presque tous les jours' },
        { form: 'futur_simple', quote: "j'irai à Montréal l'année prochaine" },
        { form: 'conditionnel', quote: "J'aimerais étudier l'architecture" },
      ],
      tenses_attempted_with_errors: [],
      b1_structures_found: [
        {
          type: 'imparfait_narratif',
          quote: 'Il pleuvait presque tous les jours, mais ça ne me dérangeait pas',
        },
        { type: 'si_clause', quote: "Si je réussis mes examens, j'irai à Montréal" },
        { type: 'relatif', quote: 'les amis qui habitent loin' },
        { type: 'conditionnel', quote: "J'aimerais étudier l'architecture" },
        { type: 'futur_simple', quote: "j'irai à Montréal l'année prochaine" },
        { type: 'depuis_il_y_a', quote: 'son travail me fascine depuis que je suis petite' },
        { type: 'subordination', quote: 'quand le soleil est enfin sorti' },
      ],
      connectors_used: ['mais', 'parce que', 'quand', 'et', 'alors', 'depuis que'],
      longest_accurate_utterance:
        "Il pleuvait presque tous les jours, mais ça ne me dérangeait pas parce que j'ai passé beaucoup de temps à lire",
      meaning_obscuring_errors: [],
      self_corrections: [],
      precise_vocabulary: [
        'loué', 'randonnée', 'architecte', 'examens', 'concentration', 'natation', 'dessine',
      ],
      l1_insertions: [],
      successful_paraphrases: [],
      problem_turns: [],
      unprompted_contributions: [],
    },
    scores: {
      a_language: {
        score: 7,
        why:
          'The imparfait and passé composé are contrasted correctly across a sustained narration ' +
          "— 'Il pleuvait' for the ongoing weather against 'le soleil est enfin sorti' for the " +
          'event. A si clause with présent plus futur simple is produced accurately and unforced, ' +
          'alongside a conditionnel de politesse and two relative pronouns. Subordination is ' +
          'varied and multi-clause sentences clearly outnumber single-clause ones. No errors ' +
          'obscure meaning at any point.',
        quotes: [
          'Il pleuvait presque tous les jours, mais ça ne me dérangeait pas',
          "Si je réussis mes examens, j'irai à Montréal l'année prochaine",
          'une randonnée qui durait trois heures',
        ],
      },
      b_vocabulary_relevance: {
        score: 7,
        why:
          'Vocabulary is precise and varied with almost no generic adjectives — loué, randonnée, ' +
          'architecte, concentration. Every answer addresses the exact question. Each is developed ' +
          'without prompting: the holiday answer supplies weather, activity and duration; the ' +
          'opinion answer offers a benefit and a cost rather than a bare yes or no. The final ' +
          'short turn is proportionate to the short question that prompted it.',
        quotes: [
          "Je pense qu'ils sont utiles pour rester en contact avec les amis qui habitent loin",
          'Mon oncle est architecte et son travail me fascine depuis que je suis petite',
        ],
        divergence_note: null,
      },
      c_interactive_skills: {
        score: 6,
        why:
          'Every question is understood at first asking and the examiner never repeats, rephrases ' +
          'or uses English. Participation is sustained and turns are substantial. But the student ' +
          'never volunteers information outside the question, never opens a related sub-topic and ' +
          'never asks the examiner anything — each turn answers fully and then stops. Under the ' +
          '6/7 discriminator, that absence of independent contribution holds this at 6.',
        quotes: ["C'est compliqué", "C'est utile pour l'architecture"],
      },
    },
    flags: { examiner_interference: false, examiner_interference_evidence: [] },
    feedback: {
      strength:
        'Your past narration is genuinely B1: you held the imparfait for the weather and switched ' +
        'to the passé composé for the events, and you produced a si clause with the futur simple ' +
        'without hesitating. That combination is what a 7 in Language looks like.',
      fix_1: {
        student_said: "C'est compliqué. Je pense qu'ils sont utiles pour rester en contact",
        should_be:
          "C'est compliqué. Je pense qu'ils sont utiles pour rester en contact… et vous, vous en pensez quoi ?",
        why:
          'Your French is already strong enough for a 7, but you answer and stop. Turning one ' +
          'answer back on the examiner shows you can drive a conversation, not just respond to one.',
      },
      fix_2: {
        student_said: "C'est utile pour l'architecture",
        should_be:
          "C'est utile pour l'architecture — d'ailleurs, j'ai commencé un cours de dessin technique cette année.",
        why:
          'Adding something the examiner did not ask for is the single behaviour separating your ' +
          'current mark from a 7. Aim to do it at least once per conversation.',
      },
      practise: {
        structure: 'unprompted expansion',
        model_sentence: "D'ailleurs, j'ai oublié de dire que…",
        practice_prompt:
          "After you finish any answer, add one sentence beginning with 'D'ailleurs…' before the examiner speaks again.",
      },
    },
  },
  expected_final: {
    criterion_scores: { A: 7, B: 7, C: 6 },
    raw_weighted_score: 6.7,
    final_ib_mark: 7,
    display_mark: '6/7',
    is_boundary: true,
    boundary_leaning: '7',
    limiting_criterion: 'Interactive Skills',
    guards_applied: [],
    cefr_verdict: 'B1 confirmed',
  },
};

const ANCHOR_7_CLEAN: OralAnchor = {
  id: 'anchor_7_clean',
  label: 'Clean 7 — B1 with independent contribution',
  purpose:
    'Near-identical to anchor_6_7_boundary in Language and Vocabulary. The only material ' +
    'difference is that this student volunteers information, opens a new thread and asks the ' +
    'examiner a question. Tests that Criterion C moves to 7 on that evidence alone.',
  transcript: [
    'EXAMINATEUR: Bonjour. Racontez-moi vos dernières vacances.',
    "ÉLÈVE: Alors, l'été dernier je suis allée en Bretagne avec mes grands-parents. On a loué une petite maison près de la mer. Il pleuvait presque tous les jours, mais ça ne me dérangeait pas parce que j'ai passé beaucoup de temps à lire. Un jour, quand le soleil est enfin sorti, on a fait une randonnée qui durait trois heures. Ah, et j'ai oublié de dire — c'était la première fois que je voyageais sans mes parents, donc c'était un peu bizarre au début. Vous connaissez la Bretagne ?",
    "EXAMINATEUR: Un peu, oui. Et qu'est-ce que vous aimeriez faire après vos études ?",
    "ÉLÈVE: J'aimerais étudier l'architecture. Si je réussis mes examens, j'irai à Montréal l'année prochaine. Mon oncle est architecte et son travail me fascine depuis que je suis petite. D'ailleurs, je voudrais aussi apprendre l'italien, parce que beaucoup de bâtiments que j'admire sont en Italie.",
    'EXAMINATEUR: Pensez-vous que les réseaux sociaux sont bons pour les jeunes ?',
    "ÉLÈVE: C'est compliqué. Je pense qu'ils sont utiles pour rester en contact avec les amis qui habitent loin. Mais beaucoup de personnes passent trop de temps devant leur téléphone, et ça peut être mauvais pour la concentration. Moi, j'ai supprimé une application l'année dernière et franchement je me sens mieux.",
    'EXAMINATEUR: Et vos loisirs ?',
    "ÉLÈVE: Je fais de la natation trois fois par semaine et je dessine beaucoup. C'est utile pour l'architecture. Si un jour j'ai le temps, j'aimerais aussi essayer la poterie — ma grand-mère en faisait quand elle était jeune.",
  ].join('\n'),
  expected_llm_output: {
    insufficient_evidence: false,
    evidence: {
      tiers_probed: [1, 3, 4],
      tenses_accurate: [
        { form: 'présent', quote: 'je me sens mieux' },
        { form: 'passé_composé', quote: "j'ai supprimé une application l'année dernière" },
        { form: 'imparfait', quote: "c'était la première fois que je voyageais sans mes parents" },
        { form: 'futur_simple', quote: "j'irai à Montréal l'année prochaine" },
        { form: 'conditionnel', quote: "je voudrais aussi apprendre l'italien" },
      ],
      tenses_attempted_with_errors: [],
      b1_structures_found: [
        {
          type: 'imparfait_narratif',
          quote: 'Il pleuvait presque tous les jours, mais ça ne me dérangeait pas',
        },
        { type: 'si_clause', quote: "Si je réussis mes examens, j'irai à Montréal" },
        { type: 'relatif', quote: "beaucoup de bâtiments que j'admire sont en Italie" },
        { type: 'conditionnel', quote: "J'aimerais étudier l'architecture" },
        { type: 'futur_simple', quote: "j'irai à Montréal l'année prochaine" },
        { type: 'depuis_il_y_a', quote: 'son travail me fascine depuis que je suis petite' },
        { type: 'subordination', quote: 'quand le soleil est enfin sorti' },
      ],
      connectors_used: ['mais', 'parce que', 'quand', 'donc', "d'ailleurs", 'et', 'alors'],
      longest_accurate_utterance:
        "c'était la première fois que je voyageais sans mes parents, donc c'était un peu bizarre au début",
      meaning_obscuring_errors: [],
      self_corrections: [],
      precise_vocabulary: [
        'loué', 'randonnée', 'architecte', 'bâtiments', 'concentration', 'supprimé',
      ],
      l1_insertions: [],
      successful_paraphrases: [],
      problem_turns: [],
      unprompted_contributions: [
        "Ah, et j'ai oublié de dire — c'était la première fois que je voyageais sans mes parents",
        'Vous connaissez la Bretagne ?',
        "D'ailleurs, je voudrais aussi apprendre l'italien",
        "Moi, j'ai supprimé une application l'année dernière et franchement je me sens mieux",
        "Si un jour j'ai le temps, j'aimerais aussi essayer la poterie — ma grand-mère en faisait quand elle était jeune",
      ],
    },
    scores: {
      a_language: {
        score: 7,
        why:
          'Imparfait and passé composé are contrasted correctly across sustained narration, ' +
          "including the nested 'c'était la première fois que je voyageais'. A si clause with " +
          'futur simple, a conditionnel and two relative pronouns all appear unforced. ' +
          'Subordination is varied and multi-clause sentences dominate. Nothing obscures meaning.',
        quotes: [
          'Il pleuvait presque tous les jours, mais ça ne me dérangeait pas',
          "Si je réussis mes examens, j'irai à Montréal l'année prochaine",
          "c'était la première fois que je voyageais sans mes parents",
        ],
      },
      b_vocabulary_relevance: {
        score: 7,
        why:
          'Precise, varied vocabulary with almost no generic adjectives. Every answer addresses ' +
          'the exact question and every one is developed beyond the minimum without prompting — ' +
          'the holiday answer adds weather, activity, duration and a reflection; the opinion ' +
          'answer supplies a benefit, a cost and a personal example.',
        quotes: [
          'beaucoup de personnes passent trop de temps devant leur téléphone',
          "beaucoup de bâtiments que j'admire sont en Italie",
        ],
        divergence_note: null,
      },
      c_interactive_skills: {
        score: 7,
        why:
          'Every question understood at first asking, with no repetition, rephrasing or English ' +
          'from the examiner. Beyond that, the student repeatedly contributes independently: ' +
          'volunteering an unrequested reflection on travelling alone, asking the examiner a ' +
          'direct question about Brittany, opening an entirely new thread about learning Italian, ' +
          'and supplying a personal example the opinion question did not call for. The student is ' +
          'co-driving the conversation rather than responding to it.',
        quotes: [
          'Vous connaissez la Bretagne ?',
          "D'ailleurs, je voudrais aussi apprendre l'italien",
          "Moi, j'ai supprimé une application l'année dernière",
        ],
      },
    },
    flags: { examiner_interference: false, examiner_interference_evidence: [] },
    feedback: {
      strength:
        'You did the thing most candidates never do: you asked the examiner a question and opened ' +
        'topics nobody requested. Combined with secure past narration and a si clause, that is a ' +
        'complete B1 performance.',
      fix_1: {
        student_said: "c'était un peu bizarre au début",
        should_be: "c'était un peu déroutant au début",
        why:
          'Bizarre is fine but slightly blunt here. Reaching for a more exact adjective is the ' +
          'last refinement at this level.',
      },
      fix_2: {
        student_said: 'franchement je me sens mieux',
        should_be: 'franchement, je me sens beaucoup mieux depuis',
        why:
          'Adding depuis anchors the change in time and gives you another chance to show the ' +
          'depuis construction, which examiners actively look for at B1.',
      },
      practise: {
        structure: 'plus-que-parfait',
        model_sentence: "Je n'avais jamais voyagé sans mes parents avant cet été.",
        practice_prompt: "Racontez une expérience que vous n'aviez jamais eue avant.",
      },
    },
  },
  expected_final: {
    criterion_scores: { A: 7, B: 7, C: 7 },
    raw_weighted_score: 7,
    final_ib_mark: 7,
    display_mark: '7',
    is_boundary: false,
    guards_applied: [],
    cefr_verdict: 'B1 confirmed',
  },
};

/**
 * The one injected into every marking call.
 *
 * THE 6/7 BOUNDARY BY DEFAULT, per spec §10b: it is the hardest call the marker
 * has to make and the one it gets wrong most often, so it is the example worth
 * spending 1.5k input tokens on. Swapping in a better-matched anchor is the
 * first and cheapest remedy if banding starts drifting — before tightening
 * descriptors, before pruning fields, and long before running the call three
 * times and taking a median.
 */
export const ANCHOR_FOR_PROMPT = ANCHOR_6_7;

/** The ladder, lowest first. Run by `npm run anchors`. */
export const ORAL_ANCHORS: OralAnchor[] = [
  ANCHOR_5_CLEAN,
  ANCHOR_5_6,
  ANCHOR_6_CLEAN,
  ANCHOR_6_7,
  ANCHOR_7_CLEAN,
];
