import type { LanguageChoice } from '../../../src/realtime/languages';
import type { AdvancedFace } from '../../../src/realtime/evaluators';
import { computeFinal, computeStats, validateOralOutput } from '../../../src/realtime/oralMarker';
import {
  ORAL_MODEL,
  ORAL_RESPONSE_SCHEMA,
  oralInstruction,
  renderExamTranscript,
  type AdvancedReport,
  type OralLlmOutput,
} from '../../../src/realtime/oralRubric';
import { ANCHOR_FOR_PROMPT } from '../../../src/realtime/oralAnchors';
import { MAX_TRANSCRIPT, type ReportTurn } from '../../../src/realtime/report';
import type { MarkingCost } from '../../../src/realtime/cost';
import { vertexGenerateContentUrl } from '../_vertex';

/**
 * The advanced marker's server half: three stages, one call, one mark.
 *
 * WHY IT SITS BESIDE analyse.ts RATHER THAN INSIDE IT. The standard path reads
 * a transcript against a scale somebody authored and hands back prose. This one
 * runs deterministic statistics, asks a fixed rubric for three integers, and
 * then does arithmetic on them. They share a key, a provider and a transcript
 * and share nothing else — no schema, no prompt, no output shape, and not even
 * the same idea of what a mark is. Folding them into one function would produce
 * a route that is two routes wearing a trench coat, so analyse.ts resolves the
 * request and hands the advanced case straight over here.
 *
 * THE COST HELPERS ARE DUPLICATED FROM analyse.ts ON PURPOSE, the way
 * ORAL_MODEL is duplicated from REPORT_MODEL: the two paths may not stay on one
 * model, and the first thing to move when they diverge is exactly this
 * arithmetic. A shared helper would make the cheap change look expensive.
 *
 * THE VALIDATOR IS LOAD-BEARING HERE IN A WAY IT IS NOT ON THE OTHER PATH. R1
 * says every band decision must be tied to an exact quotation, and the failure
 * that reads most convincingly is a confident justification citing a sentence
 * the learner never said. So the reply is checked against the transcript it was
 * reading, retried once on failure, and refused on the second — spec §14. A
 * missing mark is recoverable; a wrong one shown to a student is not.
 */

interface Usage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  /** Reasoning tokens: billed at the output rate, NOT inside candidates. */
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

function costUsd(usage: Usage | undefined): number {
  const input = usage?.promptTokenCount ?? 0;
  const output = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  return (
    (input * ORAL_MODEL.usdPerMillionInput) / 1_000_000 +
    (output * ORAL_MODEL.usdPerMillionOutput) / 1_000_000
  );
}

/**
 * The running tally, in the shape the two markers are compared in.
 *
 * ACCUMULATED RATHER THAN READ OFF THE LAST ATTEMPT, because the retry is the
 * whole reason the advanced path can cost double what a glance at the prompt
 * suggests: a run that failed validation once has paid for two full calls
 * against a prompt carrying a 1.5k-token worked example. `calls` is what makes
 * that visible instead of leaving it as an unexplained doubling.
 */
function emptyMarkingCost(): MarkingCost {
  return {
    kind: 'advanced',
    modelId: ORAL_MODEL.id,
    modelLabel: ORAL_MODEL.label,
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    usd: 0,
    unverifiedRates: ORAL_MODEL.unverified === true,
  };
}

function addUsage(cost: MarkingCost, usage: Usage | undefined): void {
  cost.calls += 1;
  cost.inputTokens += usage?.promptTokenCount ?? 0;
  cost.outputTokens +=
    (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  cost.cachedInputTokens += usage?.cachedContentTokenCount ?? 0;
  cost.usd += costUsd(usage);
}

const REASON_LIMIT = 300;

/** The provider's own classification, never its message. */
function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  return text.length > REASON_LIMIT ? `${text.slice(0, REASON_LIMIT)}…` : text;
}

class MarkerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    readonly reason?: string,
  ) {
    super(message);
  }
}

/** One marking call. Throws MarkerError; the caller decides about retrying. */
async function callOnce(
  key: string,
  instruction: string,
  transcript: string,
): Promise<{ llm: OralLlmOutput; usage: Usage | undefined }> {
  let upstream: Response;
  try {
    upstream = await fetch(vertexGenerateContentUrl(ORAL_MODEL.id), {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ role: 'user', parts: [{ text: transcript }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: ORAL_RESPONSE_SCHEMA,
          /*
           * Low, for report.ts's reason and more so. This is a measurement: two
           * runs over one transcript disagreeing about a student's grade is the
           * failure mode rather than variety. It cannot be pinned to zero —
           * temperature is deprecated on the 3.x API — which is why banding
           * consistency is bought with the anchor instead. See §10b.
           */
          temperature: 0.2,
        },
      }),
    });
  } catch (error) {
    console.error('advanced marker threw', ORAL_MODEL.id, error);
    throw new MarkerError('The marking request failed', 'upstream', 502);
  }

  if (!upstream.ok) {
    // Body to the log only: an error can quote the request back, and the
    // request carries the whole conversation.
    const detail = await upstream.text();
    console.error('advanced marker failed', ORAL_MODEL.id, upstream.status, detail);

    let reason: string | undefined;
    try {
      const parsed = JSON.parse(detail) as
        | { error?: { status?: string } }
        | { error?: { status?: string } }[];
      reason = trimmed((Array.isArray(parsed) ? parsed[0] : parsed)?.error?.status);
    } catch {
      reason = undefined;
    }

    throw new MarkerError(
      reason === 'RESOURCE_EXHAUSTED'
        ? `${ORAL_MODEL.label} has no quota left for now — wait a minute and try again.`
        : reason
          ? `${ORAL_MODEL.label} declined: ${reason}`
          : `${ORAL_MODEL.label} could not mark that conversation`,
      'upstream',
      502,
      reason,
    );
  }

  const answer = (await upstream.json()) as {
    promptFeedback?: { blockReason?: string };
    usageMetadata?: Usage;
    candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
  };

  const candidate = answer.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('').trim();

  if (!text) {
    // A refusal on this API is a 200 with no parts and a finishReason, which is
    // indistinguishable from a bug unless the classification is carried out.
    const reason =
      trimmed(answer.promptFeedback?.blockReason) ??
      trimmed(candidate?.finishReason) ??
      'no text and no stated reason';
    console.error('advanced marker empty', ORAL_MODEL.id, JSON.stringify(answer).slice(0, 2000));
    throw new MarkerError(`${ORAL_MODEL.label} declined: ${reason}`, 'upstream', 502, reason);
  }

  let llm: OralLlmOutput;
  try {
    llm = JSON.parse(text) as OralLlmOutput;
  } catch {
    console.error('advanced marker unparseable', ORAL_MODEL.id, text.slice(0, 2000));
    throw new MarkerError(`${ORAL_MODEL.label} returned a malformed mark`, 'bad_report', 502);
  }

  return { llm, usage: answer.usageMetadata };
}

export interface AdvancedRequest {
  key: string;
  language: LanguageChoice;
  l1: LanguageChoice;
  face: AdvancedFace;
  turns: ReportTurn[];
}

export type AdvancedResult =
  | { ok: true; report: AdvancedReport; usd: number; cached: number; cost: MarkingCost }
  | { ok: false; error: string; code: string; status: number; reason?: string };

/**
 * Stage 1, stage 2, stage 3.
 *
 * A TRANSCRIPT TOO THIN TO MARK NEVER REACHES THE MODEL. `computeStats` decides
 * that from counts alone — spec §3's forty-student-word floor — so the refusal
 * costs nothing and says the same thing it would have said after a call. The
 * student page has its own, longer gate in front of the button; this is the
 * backstop for the cases that get past it.
 */
export async function markAdvanced({
  key,
  language,
  l1,
  face,
  turns,
}: AdvancedRequest): Promise<AdvancedResult> {
  const transcript = renderExamTranscript(turns);
  if (transcript.length > MAX_TRANSCRIPT) {
    return {
      ok: false,
      error: 'That conversation is too long to mark',
      code: 'transcript_too_long',
      status: 413,
    };
  }

  const stats = computeStats(transcript);

  if (stats.insufficient_evidence) {
    // A result, not a failure: the panel says there was too little to place a
    // level on, which is exactly what `computeFinal` reports here.
    return {
      ok: true,
      report: {
        face,
        final: computeFinal({ insufficient_evidence: true } as OralLlmOutput, stats),
        scores: {
          a_language: { score: 0, why: '', quotes: [] },
          b_vocabulary_relevance: { score: 0, why: '', quotes: [] },
          c_interactive_skills: { score: 0, why: '', quotes: [] },
        },
        evidence: {
          tiers_probed: [],
          tenses_accurate: [],
          tenses_attempted_with_errors: [],
          b1_structures_found: [],
          connectors_used: [],
          longest_accurate_utterance: '',
          meaning_obscuring_errors: [],
          self_corrections: [],
          precise_vocabulary: [],
          l1_insertions: [],
          successful_paraphrases: [],
          problem_turns: [],
          unprompted_contributions: [],
        },
        feedback: {
          strength: '',
          fix_1: { student_said: '', should_be: '', why: '' },
          fix_2: { student_said: '', should_be: '', why: '' },
          practise: { structure: '', model_sentence: '', practice_prompt: '' },
        },
        flags: { examiner_interference: false, examiner_interference_evidence: [] },
      },
      usd: 0,
      cached: 0,
      cost: emptyMarkingCost(),
    };
  }

  const instruction = oralInstruction({ l1, stats, anchor: ANCHOR_FOR_PROMPT });

  const cost = emptyMarkingCost();
  let lastErrors: string[] = [];

  // Two attempts, per §14. The second is a fresh sample of the same prompt: at
  // temperature 0.2 an ungrounded quotation is usually a one-off rather than a
  // property of the transcript.
  for (let attempt = 0; attempt < 2; attempt++) {
    let llm: OralLlmOutput;
    let usage: Usage | undefined;
    try {
      ({ llm, usage } = await callOnce(key, instruction, transcript));
    } catch (error) {
      if (error instanceof MarkerError) {
        return {
          ok: false,
          error: error.message,
          code: error.code,
          status: error.status,
          reason: error.reason,
        };
      }
      throw error;
    }

    addUsage(cost, usage);

    if (llm.insufficient_evidence) {
      return {
        ok: true,
        report: {
          face,
          final: computeFinal(llm, stats),
          scores: llm.scores,
          evidence: llm.evidence,
          feedback: llm.feedback,
          flags: llm.flags,
        },
        usd: cost.usd,
        cached: cost.cachedInputTokens,
        cost,
      };
    }

    const validation = validateOralOutput(llm, transcript);
    if (validation.valid) {
      return {
        ok: true,
        report: {
          face,
          final: computeFinal(llm, stats),
          scores: llm.scores,
          evidence: llm.evidence,
          feedback: llm.feedback,
          flags: llm.flags,
        },
        usd: cost.usd,
        cached: cost.cachedInputTokens,
        cost,
      };
    }

    lastErrors = validation.errors;
    console.warn(
      `advanced marker validation failed (attempt ${attempt + 1}/2)`,
      language.code,
      validation.errors.slice(0, 6).join(' | '),
    );
  }

  console.error('advanced marker refused after two attempts', lastErrors.slice(0, 6).join(' | '));
  return {
    ok: false,
    error: 'The mark could not be grounded in what you actually said, so it was not shown.',
    code: 'ungrounded',
    status: 502,
  };
}
