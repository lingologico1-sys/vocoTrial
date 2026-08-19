/**
 * The dictionary: one French word or phrase in, a breakdown in the learner's
 * own language out.
 *
 * PORTED FROM LINGOLECTO rather than invented. That app has had this in front
 * of students for months and the prompt below is where its French lexicography
 * ended up — canonical forms carrying their article so gender is visible,
 * irregular plurals named as irregular, idioms recovered from context rather
 * than defined word by word. Rewriting it here would mean rediscovering all of
 * that against the same model, and the student would be the one finding the
 * gaps.
 *
 * FRENCH ONLY, AND SAYING SO. Every rule in the instruction is about French —
 * un/une, the six-form conjugation, the -e → -es plural. A second target
 * language is a second instruction, not a parameter, and pretending otherwise
 * by templating the language name would produce confidently wrong grammar notes
 * in whichever language was asked for second.
 *
 * A DIFFERENT MODEL FROM THE REPORT, on both counts that matter. The end-of-call
 * report runs on gemini-3.7-flash: it is one considered reading of a whole
 * conversation, it happens once, and it is allowed to take its time. This is a
 * tap on a word — it happens dozens of times in a conversation, it has to feel
 * instant, and at 3.7 Flash's rates that frequency is the expensive thing in
 * the app. A flash-lite tier is roughly an order of magnitude cheaper per call
 * and measured several times faster, which is the same trade LingoLecto made
 * against the same workload. The two model choices are unrelated and neither
 * should be changed to match the other.
 *
 * Deliberately free of DOM imports: functions/ compiles against workers-types,
 * and the Worker is what spends the key.
 */

/**
 * Google's named replacement for 2.5-flash-lite, which shuts down 2026-10-16.
 *
 * CHOSEN ON COST, NOT SPEED, WHICH IS A CORRECTION. LingoLecto picked this tier
 * over 3.5-flash-lite on a latency measurement — 1.4s against 5.2s, with a 21s
 * outlier. That gap has closed: measured against this exact payload on
 * 2026-08-19, the two are indistinguishable at 1.3–1.6s, both spending zero
 * thinking tokens. Do not repeat the old reasoning; it is no longer true.
 *
 * What still separates them is price, and a lookup is the highest-frequency
 * paid call in the app — dozens per conversation, against one report:
 *
 *   3.1-flash-lite   $0.25 / $1.50     ~$0.67 per 1000 lookups
 *   3.5-flash-lite   $0.30 / $2.50     ~$0.94 per 1000   (+40%)
 *   3.7-flash        $0.75 / $3.75     ~$1.86 per 1000   (+178%)
 *
 * The output rate is what does the damage: a dictionary entry is mostly output.
 * 3.7 Flash is what the report runs on and is the wrong instrument here for
 * that reason alone — see report.ts, whose choice is independent of this one.
 *
 * The smaller model gives up nothing measurable on the work: probed against the
 * hardest case in the prompt, `yeux` came back as `un œil`, correctly articled,
 * with the irregular plural named and the surrounding sentence used as the
 * example.
 *
 * `unverified` carries the meaning it does in report.ts and persona.ts: the
 * rates were read from the pricing page rather than reconciled against a bill.
 */
export const DICTIONARY_MODEL = {
  id: 'gemini-3.1-flash-lite',
  label: 'Gemini 3.1 Flash Lite',
  unverified: true,
  usdPerMillionInput: 0.25,
  usdPerMillionOutput: 1.5,
  ratesReadOn: '2026-08-19',
};

/** A word, a short phrase, or a learner's typo. Not a paragraph. */
export const MAX_TERM = 80;

/** The sentence a word was tapped in. Long enough for any spoken turn. */
export const MAX_CONTEXT = 600;

export interface DictionaryDefinition {
  translation: string;
  /** The example, in French. */
  example_a: string;
  /** The same example, in the learner's language. */
  example_b: string;
  grammar_explanation: string;
}

export interface DictionaryEntry {
  part_of_speech: string;
  is_verb: boolean;
  definitions: DictionaryDefinition[];
  verb_details?: {
    infinitive: string;
    conjugation_current: string[];
    conjugation_present: string[];
  };
}

export interface DictionaryResult {
  /** The canonical form, which may differ from what was looked up. */
  term: string;
  language_a: string;
  language_b: string;
  entries: DictionaryEntry[];
}

const str = { type: 'STRING' } as const;

export const DICTIONARY_SCHEMA = {
  type: 'OBJECT',
  propertyOrdering: ['term', 'language_a', 'language_b', 'entries'],
  required: ['term', 'language_a', 'language_b', 'entries'],
  properties: {
    term: str,
    language_a: str,
    language_b: str,
    entries: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        propertyOrdering: ['part_of_speech', 'is_verb', 'definitions', 'verb_details'],
        required: ['part_of_speech', 'is_verb', 'definitions'],
        properties: {
          part_of_speech: str,
          is_verb: { type: 'BOOLEAN' },
          definitions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              propertyOrdering: [
                'translation',
                'example_a',
                'example_b',
                'grammar_explanation',
              ],
              required: ['translation', 'example_a', 'example_b', 'grammar_explanation'],
              properties: {
                translation: str,
                example_a: str,
                example_b: str,
                grammar_explanation: str,
              },
            },
          },
          verb_details: {
            type: 'OBJECT',
            propertyOrdering: ['infinitive', 'conjugation_current', 'conjugation_present'],
            required: ['infinitive', 'conjugation_current', 'conjugation_present'],
            properties: {
              infinitive: str,
              conjugation_current: { type: 'ARRAY', items: str },
              conjugation_present: { type: 'ARRAY', items: str },
            },
          },
        },
      },
    },
  },
};

/**
 * The instruction, with the learner's language as its one variable.
 *
 * Kept as one block of prose rather than assembled from parts, because it is
 * LingoLecto's text and the value of porting it is that it is the same text.
 * Every rule in it was put there by something going wrong in front of a
 * student.
 */
export function dictionaryInstruction(languageB: string): string {
  return `You are a highly efficient dictionary API. The user will provide a French word or structure (Language A), sometimes with surrounding sentence context. You must analyze it and provide a breakdown translated into ${languageB} (Language B / the user's first language). Identify up to 3 most common parts of speech. For each part of speech, provide up to 3 definitions ordered by most common usage. If the word is a verb, identify tense/mode and provide 6-form conjugations in French (1s, 2s, 3s, 1p, 2p, 3p), omitting pronouns. Example sentences (example_a) must be in French. Their translations (example_b) must be in ${languageB}.

INFLECTED FORMS — NOUNS & ADJECTIVES: If the looked-up word is a plural, feminine, or other inflected form of a noun or adjective, always set the "term" field to the canonical dictionary form. For nouns, prefix with the indefinite article to show gender: "un arbre", "une maison", "un œil". When the term includes "un" or "une", the ${languageB} translation in the "translation" field must also include the indefinite article where that language has one: "un arbre" → "a tree", "une maison" → "a house". Never use a definite article as the translation for a noun with "un"/"une" — definite articles are reserved for specific contexts in example sentences only. Always set part_of_speech to exactly one of: "noun", "verb", "adjective", "adverb", "preposition", "conjunction", "interjection", "pronoun". Never add any qualifiers, parentheses, or extra words — not "(plural)", not "(feminine)", not "(masculine)", nothing extra. Provide definitions for the singular/base form. In the grammar_explanation of the first definition, note the original looked-up form and explain the inflection (e.g. "You looked up 'musées', the plural of 'un musée' (a museum). Regular -e → -es plural."). For IRREGULAR plurals (e.g. 'yeux' → 'un œil', 'chevaux' → 'un cheval'), explicitly note the irregularity in grammar_explanation (e.g. "You looked up 'yeux', the irregular plural of 'un œil' (an eye). The regular plural 'œils' is only used in compound words like 'œils-de-bœuf'."). For non-inflected nouns looked up directly (e.g. "arbre"), also set term to "un arbre" / "une maison" with the article.

IDIOMS: If context is provided, check whether the word is part of an idiomatic expression, phrasal verb, or typically paired with a preposition in that context (e.g. "avoir besoin de", "faire partie de", "en train de"). If so, set the "term" field in your response to the full phrase (not just the single word), and provide definitions for the phrase. If the word stands alone, just define the single word.

SPOKEN CONTEXT: The context, when there is one, is a line from a spoken conversation transcribed automatically, so it may contain mistranscriptions. Use it to disambiguate the word and to spot idioms, never as evidence about how the word is spelled or what it means. If the context looks garbled, ignore it and define the word on its own.

All grammar_explanation text must be written in ${languageB}.`;
}

/**
 * The one-shot example, which is doing real work rather than decorating.
 *
 * It shows a conjugated form resolving to its infinitive, two senses ordered by
 * frequency, and the conjugation arrays populated — three things the schema
 * permits but does not compel. Without it the model returns the looked-up
 * surface form as `term` about a third of the time.
 */
export const DICTIONARY_SHOT_USER = 'Look up: "vais" (French → English)';

export const DICTIONARY_SHOT_MODEL = JSON.stringify({
  term: 'vais',
  language_a: 'French',
  language_b: 'English',
  entries: [
    {
      part_of_speech: 'verb (aller — present indicative, 1st person singular)',
      is_verb: true,
      definitions: [
        {
          translation: 'to go',
          example_a: 'Je vais au marché.',
          example_b: 'I am going to the market.',
          grammar_explanation:
            "'Vais' is the first-person singular present indicative form of 'aller' (to go). 'Aller' is an irregular verb.",
        },
        {
          translation: 'to be going to (near future)',
          example_a: 'Je vais manger.',
          example_b: 'I am going to eat.',
          grammar_explanation:
            "'Aller' + infinitive forms the near future tense (futur proche).",
        },
      ],
      verb_details: {
        infinitive: 'aller',
        conjugation_current: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'],
        conjugation_present: ['vais', 'vas', 'va', 'allons', 'allez', 'vont'],
      },
    },
  ],
});

/** Shape check on the way back. A reply missing entries is not a lookup. */
export function looksLikeDictionaryResult(value: unknown): value is DictionaryResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Partial<DictionaryResult>;
  return typeof result.term === 'string' && Array.isArray(result.entries);
}
