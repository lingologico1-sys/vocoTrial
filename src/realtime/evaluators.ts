/**
 * Level evaluators: named scales you author, against which a finished
 * conversation is read to say where the learner sits.
 *
 * WHAT AN EVALUATOR IS. A whole ladder, not one rung. Placing a learner needs
 * every band available at once — a single "B1" cannot report that somebody is
 * below it, only that they failed to reach it, and "failed to reach B1" is a
 * useless thing to tell an A2 speaker who had a good conversation. So an
 * evaluator carries its bands in order and the report names one of them.
 *
 * WHAT IT IS NOT. It never reaches the tutor. The evaluator reads a transcript
 * after the call and changes nothing about how the call went, which is what
 * keeps it reworkable: a scale can be rewritten and the same recorded
 * conversation re-read against it, with no new call and nothing to hold
 * constant. The moment an evaluator steers the tutor, every preset comparison
 * in instructions.ts starts meaning something different.
 *
 * Shared by the browser and the Pages Functions for the same reason
 * languages.ts is, and free of imports for the same reason: functions/ compiles
 * against workers-types with no DOM lib.
 *
 * THE BUILT-IN IS A SEED, NOT A CEILING. Same arrangement as
 * INSTRUCTION_PRESETS: one written into the app so the feature works before
 * anybody authors anything, and saved ones alongside it. The difference from
 * presets is where saved ones live — R2 rather than localStorage, because an
 * evaluator authored on this laptop has to reach a student on another one. See
 * functions/api/evaluators/.
 */

/** One rung. Ordered lowest to highest by position in `bands`. */
export interface Band {
  /** Short key shown in the report — 'A2', 'Secure', 'Band 3'. */
  code: string;
  /** The human name for the rung. May repeat the code; often does not. */
  label: string;
  /**
   * The can-do statement, in the learner's terms rather than a grammarian's.
   *
   * Goes into the prompt verbatim. "Can use the conditional" is a syllabus
   * item; "can say what they would do in a situation they are not in" is a
   * thing somebody wants to be able to do, and is also something a model can
   * look for in a transcript without being told the grammar.
   */
  descriptor: string;
  /**
   * What the report looks for as evidence of this band.
   *
   * Language-neutral by convention rather than by enforcement. CEFR is written
   * that way and it is worth copying: "comparing two things" is true of every
   * language, where "the comparative with plus … que" is true of one, and the
   * model instantiates the neutral phrasing for whatever language the call was
   * in. Nothing stops an author writing a French-specific scale — it will work,
   * and it will only work for French.
   */
  structures: string[];
}

export interface Evaluator {
  id: string;
  /** What the picker shows. */
  name: string;
  /** One line under the picker, on what this scale is for. */
  note: string;
  /** Lowest first. The report names one of these. */
  bands: Band[];
  /** Absent on the built-in, which is not stored anywhere. */
  updatedAt?: number;
}

/** Custom ids are namespaced so they can never collide with the built-in's. */
export const BUILTIN_EVALUATOR_ID = 'builtin:cefr';

/** A ceiling on one authored evaluator, in characters of JSON. */
export const MAX_EVALUATOR = 20_000;

/** More rungs than this stops being a scale and starts being a rubric. */
export const MAX_BANDS = 12;

/** Long enough to be descriptive, short enough to fit the picker. */
export const MAX_EVALUATOR_NAME = 60;

/**
 * CEFR A1–C1, as the one that ships.
 *
 * NO C2. It is a real level and a ten-minute voice call is the wrong instrument
 * for it: the C1/C2 boundary is about precision and register sustained over
 * long discourse, and this cannot produce the evidence. A band that can only
 * ever come back unmet reads as the learner failing rather than as the ruler
 * being too short. An author who wants it can add it.
 */
export const BUILTIN_EVALUATOR: Evaluator = {
  id: BUILTIN_EVALUATOR_ID,
  name: 'CEFR speaking (A1–C1)',
  note: 'The common European bands, written to fit any language.',
  bands: [
    {
      code: 'A1',
      label: 'Getting started',
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
    },
    {
      code: 'A2',
      label: 'Everyday things',
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
    },
    {
      code: 'B1',
      label: 'Holding a conversation',
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
    },
    {
      code: 'B2',
      label: 'Arguing a point',
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
    },
    {
      code: 'C1',
      label: 'Saying it precisely',
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
    },
  ],
};

/**
 * The authoring format: a scale as text, because that is how one gets written.
 *
 * A nested form for twelve bands of six structures each is forty-odd inputs and
 * a tab order nobody enjoys. A scale is a document — it gets drafted elsewhere,
 * pasted in, reordered, and diffed by eye — so it is edited as one, and parsed
 * on the way in.
 *
 *   A2 | Everyday things
 *   Can talk about their daily routine in simple terms.
 *   - telling what happened, as a finished event
 *   - comparing two things
 *
 *   B1 | Holding a conversation
 *   ...
 *
 * A band opens on a line containing a pipe. The first line after it that is not
 * a bullet is the descriptor; bullets are structures. Blank lines separate
 * bands and are otherwise ignored, so the spacing above is a convention rather
 * than a rule.
 */
export function formatBands(bands: Band[]): string {
  return bands
    .map((band) =>
      [`${band.code} | ${band.label}`, band.descriptor, ...band.structures.map((s) => `- ${s}`)].join(
        '\n',
      ),
    )
    .join('\n\n');
}

export interface ParseResult {
  bands: Band[];
  /** Human-readable and shown inline. Empty means the text parsed. */
  error?: string;
}

export function parseBands(text: string): ParseResult {
  const bands: Band[] = [];
  let current: Band | null = null;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('-')) {
      const structure = line.slice(1).trim();
      if (!current) return { bands: [], error: 'A bullet appears before any band heading.' };
      if (structure) current.structures.push(structure);
      continue;
    }

    const pipe = line.indexOf('|');
    if (pipe !== -1 && !current?.descriptor) {
      // A heading, unless the band above is still waiting for its descriptor —
      // in which case a pipe is just punctuation somebody wrote in a sentence.
      const code = line.slice(0, pipe).trim();
      const label = line.slice(pipe + 1).trim();
      if (!code) return { bands: [], error: 'A band heading has no code before the pipe.' };
      current = { code, label: label || code, descriptor: '', structures: [] };
      bands.push(current);
      continue;
    }

    if (!current) return { bands: [], error: 'Text appears before any band heading.' };
    // Second and later descriptor lines join on, so a wrapped sentence survives.
    current.descriptor = current.descriptor ? `${current.descriptor} ${line}` : line;
  }

  if (!bands.length) return { bands: [], error: 'No bands found. Each one starts with `code | name`.' };
  if (bands.length > MAX_BANDS) return { bands: [], error: `That is more than ${MAX_BANDS} bands.` };

  const empty = bands.find((band) => !band.descriptor);
  if (empty) return { bands: [], error: `Band ${empty.code} has no description under it.` };

  return { bands };
}

/** Shape check shared by the save route and the picker. */
export function looksLikeEvaluator(value: unknown): value is Evaluator {
  if (!value || typeof value !== 'object') return false;
  const evaluator = value as Partial<Evaluator>;
  return (
    typeof evaluator.id === 'string' &&
    evaluator.id.length > 0 &&
    typeof evaluator.name === 'string' &&
    Array.isArray(evaluator.bands) &&
    evaluator.bands.length > 0 &&
    evaluator.bands.every(
      (band) =>
        !!band &&
        typeof band.code === 'string' &&
        typeof band.descriptor === 'string' &&
        Array.isArray(band.structures),
    )
  );
}
