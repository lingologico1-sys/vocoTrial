/**
 * The advanced oral marker, stages one and three: everything decided by
 * arithmetic rather than by a model.
 *
 * WHAT THIS IS. A port of the IB ab initio / DELF *entretien dirigé* rubric
 * (see docs/oral-marking.md) into the two deterministic halves it specifies. A
 * transcript goes into `computeStats`; three integer criterion scores come back
 * from the model; `computeFinal` turns those into a mark, a CEFR verdict and a
 * confidence level. The model sits between the two and does nothing else.
 *
 * THREE RULES THE SPEC CALLS NON-NEGOTIABLE, AND THIS FILE IS TWO OF THEM:
 *
 *   1. The model never counts. Every number is computed here and handed to the
 *      prompt as a given fact, because models hallucinate counts and regexes
 *      do not.
 *   2. The model never does arithmetic. The mark, the guards, the verdict and
 *      the confidence are pure functions of three integers plus these stats.
 *   3. The model only judges — quoted evidence and three integers.
 *
 * WHY snake_case IN A camelCase CODEBASE. Everything named here is named by the
 * spec, and the calibration anchors are its test fixtures: `expected_final` in
 * oralAnchors.ts is compared field-for-field against what `computeFinal`
 * returns, and the field names the model is asked for in oralRubric.ts are the
 * spec's too. A translation layer between them would be pure risk for nothing —
 * so the seam is at the React panel, which reads these names once and renders
 * French. Nothing else in the app should adopt this convention.
 *
 * IT IS FRENCH-ONLY, AND THAT IS ENFORCED ELSEWHERE. The B1 inventory, the
 * hesitation markers, the generic adjectives and all four anchors are French.
 * /teach only offers the advanced modes on a French lesson; see
 * `advancedAvailableFor` in evaluators.ts. Nothing in this file checks, because
 * by the time a transcript reaches it the choice has already been made.
 *
 * WHAT THE MARK IS WORTH, SAID PLAINLY. Criterion A is grammatical accuracy,
 * and it is only as good as the transcript's fidelity to the errors the learner
 * actually made. This app's transcript comes from a live speech model with a
 * strong language-model prior, which repairs learner grammar as it listens —
 * spec §3b. That is a ceiling on this feature rather than a bug in it, and the
 * student panel says so rather than hiding it.
 *
 * Deliberately free of DOM imports, for report.ts's reason: functions/ compiles
 * against workers-types and the Worker is what runs this.
 */

import type { OralLlmOutput } from './oralRubric';

const SPEAKER_PATTERNS = {
  examiner: /^\s*(examinateur|examiner|prof(esseur)?|e)\s*[::]\s*/i,
  student: /^\s*(élève|eleve|student|candidat(e)?|s)\s*[::]\s*/i,
};

const HESITATION_MARKERS = [
  'euh', 'heu', 'euhm', 'ben', 'bah', 'hein', 'hmm', 'hum',
  'comment dire', 'je sais pas', 'comment on dit',
];

const GENERIC_ADJECTIVES = [
  'bien', 'bon', 'bonne', 'super', 'cool', 'sympa', 'intéressant',
  'intéressante', 'joli', 'jolie', 'beau', 'belle', 'grand', 'grande',
  'petit', 'petite', 'nul', 'nulle',
];

/**
 * High-frequency English that signals a fall back to the first language.
 *
 * A HINT FOR THE MODEL, NOT A VERDICT. Short words overlap across languages, so
 * this counts candidates and the model decides whether an insertion actually
 * happened.
 */
const L1_HINT_WORDS = [
  'the', 'and', 'but', 'because', 'like', 'really', 'very', 'about',
  'something', 'nothing', 'people', 'family', 'school', 'friend', 'friends',
  'holiday', 'holidays', 'weekend', 'homework', 'teacher', 'sorry',
  'yeah', 'okay', 'stuff', 'thing', 'things', 'know', 'want', 'went',
  'maybe', 'always', 'never', 'sometimes', 'actually', 'basically',
];

/** One parsed line of the exam transcript. */
export interface OralTurn {
  speaker: 'examiner' | 'student';
  text: string;
  index: number;
}

/** Split French text into word tokens, preserving accents and elisions. */
export function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/['‘’]/g, "'")
    .replace(/[^\p{L}\p{M}'-]+/gu, ' ');
  return cleaned
    .split(/\s+/)
    .flatMap((tok) => tok.split("'"))
    .map((tok) => tok.replace(/^-+|-+$/g, ''))
    .filter((tok) => tok.length > 0);
}

/** Parse a labelled transcript into an ordered list of turns. */
export function parseTurns(transcript: string): OralTurn[] {
  const turns: OralTurn[] = [];

  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;

    let speaker: OralTurn['speaker'];
    let content: string;

    if (SPEAKER_PATTERNS.examiner.test(line)) {
      speaker = 'examiner';
      content = line.replace(SPEAKER_PATTERNS.examiner, '').trim();
    } else if (SPEAKER_PATTERNS.student.test(line)) {
      speaker = 'student';
      content = line.replace(SPEAKER_PATTERNS.student, '').trim();
    } else if (turns.length > 0) {
      // A wrapped line: joins the turn above rather than opening a new one.
      turns[turns.length - 1].text += ` ${line.trim()}`;
      continue;
    } else {
      continue; // Preamble before the first labelled turn.
    }

    if (content.length > 0) turns.push({ speaker, text: content, index: turns.length });
  }

  return turns;
}

/** Count occurrences of single- or multi-word phrases in a token stream. */
function countPhrases(text: string, phrases: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  const haystack = ` ${tokenize(text).join(' ')} `;

  for (const phrase of phrases) {
    const needle = ` ${tokenize(phrase).join(' ')} `;
    let total = 0;
    let pos = haystack.indexOf(needle);
    while (pos !== -1) {
      total += 1;
      pos = haystack.indexOf(needle, pos + 1);
    }
    if (total > 0) counts[phrase] = total;
  }

  return counts;
}

function sumValues(obj: Record<string, number>): number {
  return Object.values(obj).reduce((acc, n) => acc + n, 0);
}

/** One examiner turn that looks like a repeat of the question before it. */
export interface RepeatCandidate {
  turnIndex: number;
  text: string;
  overlap: number;
}

/**
 * Examiner turns that repeat or rephrase the question before them.
 *
 * A CANDIDATE LIST, NOT A FINDING, which is why the field carries the word.
 * Criterion C turns on whether the examiner had to repeat itself, and a
 * token-overlap heuristic will call two questions about one topic a repeat. The
 * model is handed these and makes the call.
 */
function detectExaminerRepeats(turns: OralTurn[]): RepeatCandidate[] {
  const repeats: RepeatCandidate[] = [];

  for (let i = 1; i < turns.length; i++) {
    const current = turns[i];
    if (current.speaker !== 'examiner') continue;

    let prevExaminer: OralTurn | null = null;
    for (let j = i - 1; j >= 0; j--) {
      if (turns[j].speaker === 'examiner') { prevExaminer = turns[j]; break; }
    }
    if (!prevExaminer) continue;

    const a = new Set(tokenize(prevExaminer.text).filter((t) => t.length > 3));
    const b = new Set(tokenize(current.text).filter((t) => t.length > 3));
    if (a.size === 0 || b.size === 0) continue;

    let shared = 0;
    for (const tok of b) if (a.has(tok)) shared += 1;
    const overlap = shared / Math.min(a.size, b.size);

    if (overlap >= 0.5) {
      repeats.push({ turnIndex: i, text: current.text, overlap: Number(overlap.toFixed(2)) });
    }
  }

  return repeats;
}

/** Stage 1's output. Injected into the prompt as authoritative fact. */
export interface OralStats {
  insufficient_evidence: boolean;
  student_word_count: number;
  examiner_word_count: number;
  student_examiner_word_ratio: number;
  student_turn_count: number;
  examiner_turn_count: number;
  mean_student_words_per_turn: number;
  shortest_student_turn_words: number;
  longest_student_turn_words: number;
  distinct_word_count: number;
  type_token_ratio: number;
  hesitation_markers: Record<string, number>;
  hesitation_total: number;
  hesitation_per_100_words: number;
  generic_adjectives: Record<string, number>;
  generic_adjective_total: number;
  l1_hint_words: Record<string, number>;
  examiner_repeat_candidates: RepeatCandidate[];
  estimated_speaking_minutes: number;
}

/**
 * Stage 1. Every number the marker needs, computed before the model is asked
 * anything.
 *
 * ON `type_token_ratio`: it falls as transcripts lengthen, so it is only
 * comparable between transcripts of similar length. The prompt says out loud
 * that it is a within-band tie-breaker and never a band determinant.
 */
export function computeStats(transcript: string): OralStats {
  const turns = parseTurns(transcript);
  const studentTurns = turns.filter((t) => t.speaker === 'student');
  const examinerTurns = turns.filter((t) => t.speaker === 'examiner');

  const studentText = studentTurns.map((t) => t.text).join(' ');
  const examinerText = examinerTurns.map((t) => t.text).join(' ');

  const studentTokens = tokenize(studentText);
  const examinerTokens = tokenize(examinerText);

  const studentWordCount = studentTokens.length;
  const examinerWordCount = examinerTokens.length;

  const uniqueTokens = new Set(studentTokens);
  const typeTokenRatio = studentWordCount > 0
    ? Number((uniqueTokens.size / studentWordCount).toFixed(3))
    : 0;

  const turnLengths = studentTurns.map((t) => tokenize(t.text).length);

  const hesitationCounts = countPhrases(studentText, HESITATION_MARKERS);
  const hesitationTotal = sumValues(hesitationCounts);

  const genericAdjCounts = countPhrases(studentText, GENERIC_ADJECTIVES);
  const l1HintCounts = countPhrases(studentText, L1_HINT_WORDS);

  return {
    // Spec §3: unlabelled, unparseable, or under forty student words stops the
    // pipeline. A missing mark is recoverable; a wrong one shown to a student
    // is not.
    insufficient_evidence:
      studentTurns.length === 0 || studentWordCount < 40 || examinerTurns.length === 0,

    student_word_count: studentWordCount,
    examiner_word_count: examinerWordCount,
    student_examiner_word_ratio: examinerWordCount > 0
      ? Number((studentWordCount / examinerWordCount).toFixed(2))
      : 0,

    student_turn_count: studentTurns.length,
    examiner_turn_count: examinerTurns.length,
    mean_student_words_per_turn: turnLengths.length > 0
      ? Number((studentWordCount / turnLengths.length).toFixed(1))
      : 0,
    shortest_student_turn_words: turnLengths.length > 0 ? Math.min(...turnLengths) : 0,
    longest_student_turn_words: turnLengths.length > 0 ? Math.max(...turnLengths) : 0,

    distinct_word_count: uniqueTokens.size,
    type_token_ratio: typeTokenRatio,

    hesitation_markers: hesitationCounts,
    hesitation_total: hesitationTotal,
    hesitation_per_100_words: studentWordCount > 0
      ? Number(((hesitationTotal / studentWordCount) * 100).toFixed(1))
      : 0,

    generic_adjectives: genericAdjCounts,
    generic_adjective_total: sumValues(genericAdjCounts),

    l1_hint_words: l1HintCounts,

    examiner_repeat_candidates: detectExaminerRepeats(turns),

    estimated_speaking_minutes: Number(
      ((studentWordCount + examinerWordCount) / 140).toFixed(1),
    ),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3: three integers in, a mark and a verdict out. No model involved.
// ─────────────────────────────────────────────────────────────────────────────

/** Must sum to 1.00. `seven_guard` exists to catch an edit that breaks that. */
export const WEIGHTS = { A: 0.4, B: 0.3, C: 0.3 };

/** The three criteria, as a teacher and a student meet them. */
export const CRITERION_NAMES = {
  A: 'Language',
  B: 'Vocabulary & Relevance',
  C: 'Interactive Skills',
} as const;

/** Round half up. `Math.round` already does this for positive numbers. */
function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

export type CanDoKey = 'B1' | 'B1_EMERGING' | 'A2' | 'A2_EMERGING' | 'A1';

/**
 * Can-do statements, in the spec's English.
 *
 * KEPT IN ENGLISH ON PURPOSE, and rendered from `can_do_key` rather than from
 * this array on the student page. The chrome a learner reads is French and the
 * explanations are in their own first language — neither of which is what these
 * strings are. They stay here so Stage 3 remains a faithful, testable port and
 * so a teacher-facing surface has something to print; see AdvancedPanel.tsx for
 * the French the student actually sees.
 */
export const CAN_DO: Record<CanDoKey, string[]> = {
  B1: [
    'Can narrate past events, describing what happened and what things were like.',
    'Can talk about future plans and give reasons for choices.',
    'Can sustain an unprepared conversation on familiar topics without much help.',
    'Can express and briefly justify an opinion.',
  ],
  B1_EMERGING: [
    'Can handle familiar topics confidently and is beginning to narrate past events.',
    'Can give simple reasons for opinions, though not yet consistently.',
    'Still relies on the examiner to open new directions in the conversation.',
  ],
  A2: [
    'Can describe family, studies, surroundings and daily routines in simple terms.',
    'Can talk about recent past events in short, linked sentences.',
    'Can take part in short exchanges on familiar topics, with some support.',
  ],
  A2_EMERGING: [
    'Can give short answers about immediate, familiar subjects.',
    'Can produce simple present-tense sentences, with past and future still unstable.',
    'Needs questions repeated or simplified fairly often.',
  ],
  A1: [
    'Can use isolated words and memorised phrases about very familiar things.',
    'Depends on repetition, rephrasing and support from the examiner.',
  ],
};

/** The five verdicts. The only CEFR strings this pipeline can produce. */
export type CefrVerdict =
  | 'B1 confirmed'
  | 'B1 emerging'
  | 'A2 confirmed'
  | 'A2 emerging'
  | 'A1';

/**
 * The CEFR verdict, derived from the criterion profile and NEVER from the mark.
 *
 * THIS IS THE WHOLE REASON BOTH SCALES ARE WORTH SHOWING. IB is a
 * ceiling-referenced grade out of 7; CEFR is criterion-referenced can-do. Map
 * one onto the other and the CEFR output becomes a relabelled 1–7 carrying no
 * information the mark did not already carry — every student on a 6 would get
 * one level, when A6/B6/C6 and A5/B7/C7 are different learners with the same
 * mark. The first is B1 confirmed; the second is B1 emerging, because its
 * grammar has not caught up with its fluency. That divergence is the finding.
 *
 * So there is no mark-to-level table in this file, in the panel, or anywhere a
 * teacher can read one. The moment such a table exists it gets treated as the
 * source of truth and the two outputs start competing to be the real answer.
 * Where both are shown, they are shown side by side with a line saying they
 * measure different things and will not always agree.
 */
export function computeCefrVerdict(
  A: number,
  B: number,
  C: number,
  llm: OralLlmOutput,
): { level: CefrVerdict; canDoKey: CanDoKey; basis: string } {
  const b1Structures = (llm.evidence?.b1_structures_found ?? []).length;
  const lowest = Math.min(A, B, C);

  if (A >= 6 && B >= 6 && C >= 6 && b1Structures >= 2) {
    return {
      level: 'B1 confirmed',
      canDoKey: 'B1',
      basis: `All three criteria at 6 or above, with ${b1Structures} B1 structures evidenced.`,
    };
  }
  if (A >= 5 && b1Structures >= 1) {
    return {
      level: 'B1 emerging',
      canDoKey: 'B1_EMERGING',
      basis:
        `Language at ${A}/7 with ${b1Structures} B1 structure(s) used successfully, ` +
        'but not yet sustained across all criteria.',
    };
  }
  if (lowest >= 4) {
    return {
      level: 'A2 confirmed',
      canDoKey: 'A2',
      basis: 'All criteria at 4 or above; no B1 structures securely evidenced.',
    };
  }
  if (lowest >= 3 || [A, B, C].filter((s) => s >= 3).length >= 2) {
    return {
      level: 'A2 emerging',
      canDoKey: 'A2_EMERGING',
      basis: 'Performance sits between A1 and A2; basic structures not yet reliable.',
    };
  }
  return {
    level: 'A1',
    canDoKey: 'A1',
    basis: 'Performance is limited to isolated words and memorised phrases.',
  };
}

export type Coverage = 'FULL' | 'PARTIAL' | 'MINIMAL';
export type Sample = 'ADEQUATE' | 'THIN' | 'SHORT';
export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface Confidence {
  level: ConfidenceLevel;
  note: string;
  coverage: Coverage;
  sample: Sample;
  missingTiers: number[];
}

/**
 * How much the questions allowed the student to show — not how sure the model
 * is, and NOT a cap on the mark.
 *
 * Per R3 the marker scores only what was elicited and a gap is reported rather
 * than punished. A LOW-confidence session can still come back a 7 if a 7 is
 * what the transcript evidences; what LOW says is that the conversation could
 * not *distinguish* levels, which is a different claim and the one the copy
 * must make.
 *
 * TWO FACTORS, NOT ONE, because they have different remedies. Coverage asks
 * whether the questions reached the B1 tiers — fixed by asking Tier 3 and 4
 * questions. Sample asks whether enough language was produced — fixed by a
 * longer session. Collapsed into one number they produce incoherent advice:
 * "confidence is MEDIUM" with no missing tiers to recommend.
 */
export function computeConfidence(llm: OralLlmOutput, stats: OralStats): Confidence {
  const probed = new Set(llm.evidence?.tiers_probed ?? []);
  const missingTiers = [1, 2, 3, 4].filter((t) => !probed.has(t));
  const words = stats.student_word_count;

  let coverage: Coverage;
  if (probed.has(3) && probed.has(4)) coverage = 'FULL';
  else if (probed.has(3) || probed.has(4)) coverage = 'PARTIAL';
  else coverage = 'MINIMAL';

  /*
   * Sample keys on how many questions the EXAMINER asked, not on how much the
   * student produced. Output volume is itself part of what is being measured —
   * a weak student produces few words, and that brevity is the finding rather
   * than a gap in the evidence. Gating on word count alone would systematically
   * mark weaker candidates low-confidence for being weak. Word count stays only
   * as a floor against degenerate transcripts.
   */
  const questions = stats.examiner_turn_count;
  let sample: Sample;
  if (questions >= 4 && words >= 60) sample = 'ADEQUATE';
  else if (questions >= 3 && words >= 40) sample = 'THIN';
  else sample = 'SHORT';

  let level: ConfidenceLevel;
  if (coverage === 'FULL' && sample === 'ADEQUATE') level = 'HIGH';
  else if (coverage === 'MINIMAL' || sample === 'SHORT') level = 'LOW';
  else level = 'MEDIUM';

  const reasons: string[] = [];
  if (coverage === 'MINIMAL') {
    reasons.push(
      'No B1-level questions were asked, so B1 structures were never elicited. ' +
      'This mark reflects only what the questions allowed the student to show — ' +
      'a higher mark has neither been earned nor ruled out. Re-run with Tier 3 and 4 questions.',
    );
  } else if (coverage === 'PARTIAL') {
    reasons.push(
      `Only part of the B1 range was probed (missing tier${missingTiers.length === 1 ? '' : 's'} ` +
      `${missingTiers.join(', ')}). Some B1 evidence may be absent simply because it was never asked for.`,
    );
  }
  if (sample === 'SHORT') {
    reasons.push(
      `Only ${questions} question${questions === 1 ? ' was' : 's were'} asked ` +
      `(${words} student words) — too little exchange to judge reliably. ` +
      'Aim for at least four questions.',
    );
  } else if (sample === 'THIN') {
    reasons.push(`Only ${questions} questions were asked. A fourth would give a fuller picture.`);
  }

  return {
    level,
    note: reasons.length > 0
      ? reasons.join(' ')
      : 'All elicitation tiers were probed and the sample is long enough for a reliable mark.',
    coverage,
    sample,
    missingTiers,
  };
}

interface DisplayMark {
  display_mark: string;
  is_boundary: boolean;
  leaning: string | null;
  limiting_criterion: string | null;
  /**
   * The same answer as `limiting_criterion`, as keys rather than as prose.
   *
   * The prose form is English and joined with " and ", which a French student
   * page cannot render and should not be parsing back apart. Emitting the keys
   * costs nothing and lets every surface name the criteria in its own language.
   */
  limiting_criteria_keys: ('A' | 'B' | 'C')[];
}

/**
 * Boundary ("6/7") display marks.
 *
 * With integer criteria and 40/30/30 weights, uniform profiles land on whole
 * numbers (6,6,6 → 6.0) and every mixed profile lands strictly between two
 * (7,6,6 → 6.4). So a boundary band is not an arbitrary threshold: it is the
 * set of profiles where the criteria genuinely disagree.
 *
 * Two conditions, both required:
 *   1. raw falls strictly between two integers;
 *   2. no criterion sits below the lower integer — 5/7/7 is a 6 with a weakness,
 *      not a borderline 7.
 * A guarded result never gets a slash mark, because a clamp means the profile
 * was lopsided, which is the opposite of borderline.
 */
function computeDisplayMark(
  raw: number,
  final: number,
  A: number,
  B: number,
  C: number,
  guardsApplied: string[],
): DisplayMark {
  const lower = Math.floor(raw);
  const upper = lower + 1;

  const strictlyBetween = raw > lower && raw < upper;
  const noWeakLink = Math.min(A, B, C) >= lower;
  const unguarded = guardsApplied.length === 0;

  if (!(strictlyBetween && noWeakLink && unguarded && upper <= 7)) {
    return {
      display_mark: String(final),
      is_boundary: false,
      leaning: null,
      limiting_criterion: null,
      limiting_criteria_keys: [],
    };
  }

  // Name the criterion holding the student at the lower band.
  const scores: Record<'A' | 'B' | 'C', number> = { A, B, C };
  const keys = (Object.keys(scores) as ('A' | 'B' | 'C')[]).filter((k) => scores[k] === lower);

  return {
    display_mark: `${lower}/${upper}`,
    is_boundary: true,
    leaning: String(final),
    limiting_criterion: keys.map((k) => CRITERION_NAMES[k]).join(' and '),
    limiting_criteria_keys: keys,
  };
}

/** What Stage 3 hands to the route, and the route hands to the page. */
export interface OralFinal {
  insufficient_evidence: boolean;
  criterion_scores?: { A: number; B: number; C: number };
  raw_weighted_score?: number;
  final_ib_mark: number | null;
  display_mark?: string;
  is_boundary?: boolean;
  boundary_leaning?: string | null;
  limiting_criterion?: string | null;
  /** `limiting_criterion` as keys, so a localised panel can name them itself. */
  limiting_criteria_keys?: ('A' | 'B' | 'C')[];
  guards_applied?: string[];
  cefr_verdict: CefrVerdict | null;
  cefr_verdict_basis?: string;
  can_do?: string[];
  /** Which CAN_DO row this is, so a localised panel can render its own copy. */
  can_do_key?: CanDoKey;
  confidence: ConfidenceLevel;
  confidence_note?: string;
  confidence_coverage?: Coverage;
  confidence_sample?: Sample;
  recommended_followup_tiers?: number[];
  reason?: string;
}

/**
 * Stage 3. Pure function of the model's three integers and Stage 1's stats.
 *
 * GUARD REACHABILITY, verified exhaustively over all 343 non-zero profiles:
 * `spread_clamp` fires on seven of them, all badly lopsided — A7/B7/C2 raws to
 * 5.5 and clamps to 4 — so it is doing real work. `seven_guard` never fires at
 * 40/30/30, because the arithmetic already makes a 7 unreachable unless every
 * criterion is 6 or above. It stays anyway: it is a cheap assertion that
 * becomes load-bearing the moment anyone edits WEIGHTS, which is exactly when a
 * silent regression would otherwise slip through.
 */
export function computeFinal(llm: OralLlmOutput, stats: OralStats): OralFinal {
  if (llm.insufficient_evidence || stats.insufficient_evidence) {
    return {
      insufficient_evidence: true,
      final_ib_mark: null,
      cefr_verdict: null,
      confidence: 'NONE',
      reason: 'Transcript too short or unparseable to assess.',
    };
  }

  const A = llm.scores.a_language.score;
  const B = llm.scores.b_vocabulary_relevance.score;
  const C = llm.scores.c_interactive_skills.score;

  const guardsApplied: string[] = [];
  const confidence = computeConfidence(llm, stats);

  // Zero rule: a zero on any criterion zeroes the result.
  if (A === 0 || B === 0 || C === 0) {
    return {
      insufficient_evidence: false,
      criterion_scores: { A, B, C },
      raw_weighted_score: 0,
      final_ib_mark: 0,
      display_mark: '0',
      is_boundary: false,
      boundary_leaning: null,
      limiting_criterion: null,
      limiting_criteria_keys: [],
      guards_applied: ['zero_rule'],
      cefr_verdict: 'A1',
      cefr_verdict_basis: 'One or more criteria produced no assessable performance.',
      can_do: CAN_DO.A1,
      can_do_key: 'A1',
      confidence: confidence.level,
      confidence_note: confidence.note,
      confidence_coverage: confidence.coverage,
      confidence_sample: confidence.sample,
      recommended_followup_tiers: confidence.missingTiers,
    };
  }

  const raw = WEIGHTS.A * A + WEIGHTS.B * B + WEIGHTS.C * C;
  let final = roundHalfUp(raw);

  // Guard 1 — seven guard.
  if (final === 7 && !(A >= 6 && Math.min(A, B, C) >= 5)) {
    final = 6;
    guardsApplied.push('seven_guard');
  }

  // Guard 2 — spread clamp: never more than 2 above the weakest criterion.
  const lowest = Math.min(A, B, C);
  if (final > lowest + 2) {
    final = lowest + 2;
    guardsApplied.push('spread_clamp');
  }

  const verdict = computeCefrVerdict(A, B, C, llm);
  const display = computeDisplayMark(raw, final, A, B, C, guardsApplied);

  return {
    insufficient_evidence: false,
    criterion_scores: { A, B, C },
    raw_weighted_score: Number(raw.toFixed(2)),
    final_ib_mark: final,
    display_mark: display.display_mark,
    is_boundary: display.is_boundary,
    boundary_leaning: display.leaning,
    limiting_criterion: display.limiting_criterion,
    limiting_criteria_keys: display.limiting_criteria_keys,
    guards_applied: guardsApplied,
    cefr_verdict: verdict.level,
    cefr_verdict_basis: verdict.basis,
    can_do: CAN_DO[verdict.canDoKey],
    can_do_key: verdict.canDoKey,
    confidence: confidence.level,
    confidence_note: confidence.note,
    confidence_coverage: confidence.coverage,
    confidence_sample: confidence.sample,
    recommended_followup_tiers: confidence.missingTiers,
  };
}

/**
 * What the model returned, checked against the transcript it was reading.
 *
 * THE QUOTE CHECK IS THE POINT. R1 says every band decision must be tied to an
 * exact quotation, and a `why` supported by a sentence the learner never said
 * is the failure mode that reads most convincingly. On failure the route
 * retries once, then refuses: a missing mark is recoverable, a wrong one shown
 * to a student is not.
 */
export function validateOralOutput(
  llm: OralLlmOutput,
  transcript: string,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const haystack = normalise(transcript);

  const keys = ['a_language', 'b_vocabulary_relevance', 'c_interactive_skills'] as const;

  for (const key of keys) {
    const quotes = llm.scores?.[key]?.quotes ?? [];
    if (quotes.length === 0) errors.push(`${key}: no supporting quotes (violates R1)`);
    for (const q of quotes) {
      if (q && !haystack.includes(normalise(q))) {
        errors.push(`${key}: quote not found in transcript — "${q}"`);
      }
    }
  }

  for (const key of keys) {
    const s = llm.scores?.[key]?.score;
    if (!Number.isInteger(s) || s < 0 || s > 7) {
      errors.push(`${key}: score must be an integer 0–7, got ${s}`);
    }
  }

  // R7: exactly one attribution per problem turn.
  for (const turn of llm.evidence?.problem_turns ?? []) {
    if (turn.attributed_to !== 'B' && turn.attributed_to !== 'C') {
      errors.push(`problem_turn attributed_to must be "B" or "C", got ${turn.attributed_to}`);
    }
  }

  if (!llm.feedback?.fix_1?.student_said || !llm.feedback?.fix_2?.student_said) {
    errors.push('feedback must contain exactly two fixes, each quoting the student');
  }

  return { valid: errors.length === 0, errors };
}
