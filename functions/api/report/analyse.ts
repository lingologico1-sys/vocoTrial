import { findLanguage } from '../../../src/realtime/languages';
import { BUILTIN_EVALUATOR, BUILTIN_EVALUATOR_ID, type Evaluator } from '../../../src/realtime/evaluators';
import {
  MAX_TRANSCRIPT,
  REPORT_MODEL,
  REPORT_SCHEMA,
  renderTranscript,
  reportInstruction,
  type ReportTurn,
} from '../../../src/realtime/report';
import { type GateEnv, json } from '../_middleware';
import { VERTEX_KEY_NAMES, vertexGenerateContentUrl, vertexKey } from '../_vertex';
import { type LibraryEnv, readLibrary } from '../evaluators/_library';
import { type SessionEnv, readSetup } from '../sessions/_library';

/**
 * The key that pays for the call, the bucket of scales, and the bucket of
 * published setups — the last one only so the lesson's targets can be read from
 * where they were published rather than taken from the caller. See below.
 */
type ReportEnv = GateEnv & LibraryEnv & SessionEnv;

/**
 * The end-of-call report: a finished transcript in, a structured reading out.
 *
 * A proxy of the same shape as persona/draft.ts and for the same reason — the
 * key stays server-side. What differs is where the prompt comes from. That
 * route takes the wording from the browser because comparing wordings is what
 * the face page is for; this one owns its prompt, because the page that will
 * call it is the student page, and a student authors neither prompts nor
 * models. See the direction note in the README.
 *
 * THE CODES ARE RESOLVED HERE, NOT TRUSTED. Language, first language and the
 * evaluator arrive as ids and are looked up before anything is built from them
 * — the same rule models.ts and languages.ts follow on the live path. It
 * matters less here than there, since none of the three picks what gets spent,
 * but the scale lands in a *system* prompt, and a caller who could post one
 * inline could write the instruction rather than choose it.
 *
 * That is why the evaluator is fetched from the bucket by id rather than
 * accepted whole, even though the browser already holds it and posting it would
 * save a read. The saving is a fraction of a millisecond; the property is that
 * every scale in a system prompt is one somebody authored through save.ts.
 *
 * The transcript itself is the caller's text and cannot be resolved against
 * anything. It travels as user content rather than inside the instruction, and
 * the instruction says what it is. See reportInstruction.
 */

/** What the caller sends. Everything is checked; nothing is assumed. */
interface AnalyseBody {
  languageCode?: unknown;
  l1Code?: unknown;
  evaluatorId?: unknown;
  /**
   * Which published setup this conversation was held under, if any.
   *
   * A CODE, NOT THE TARGETS THEMSELVES, for the reason the header gives about
   * the evaluator: a lesson's targets land in a *system* prompt, and a caller
   * who could post them inline could write the instruction rather than name it.
   * Resolving from the bucket means every target the model is asked to check is
   * one somebody published through sessions/publish.ts.
   *
   * Absent from tutorBench, which runs no lesson and gets no task section. That
   * is the correct outcome rather than a gap: the workshop is measuring the
   * model, not a student against a consigne.
   */
  sessionCode?: unknown;
  turns?: unknown;
}

const REASON_LIMIT = 300;

/** The provider's own classification, never its message — see persona/draft.ts. */
function trimmed(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  return text.length > REASON_LIMIT ? `${text.slice(0, REASON_LIMIT)}…` : text;
}

interface Usage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  /**
   * Reasoning tokens, billed at the output rate and NOT counted in
   * candidatesTokenCount.
   *
   * Measured, not assumed: a probe of this route reported prompt 2528,
   * candidates 977, thoughts 1526, total 5031 — and 2528 + 977 is 3505, so the
   * total only balances with thoughts added. Leaving the field out understates
   * a report by about 60% of its output, which on a reasoning model is most of
   * the bill.
   *
   * persona/draft.ts spends the same model and omits this field. Its number is
   * low by the same proportion.
   */
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
}

/**
 * What the call cost, from what Vertex says it used.
 *
 * Same caveat as persona/draft.ts on the input side: cached tokens are priced
 * at the full rate, because the discount is real but this code has no confirmed
 * figure for it, and a made-up multiplier in a running total is worse than a
 * number that reads slightly high.
 */
function costUsd(usage: Usage | undefined) {
  const input = usage?.promptTokenCount ?? 0;
  const output = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
  return (
    (input * REPORT_MODEL.usdPerMillionInput) / 1_000_000 +
    (output * REPORT_MODEL.usdPerMillionOutput) / 1_000_000
  );
}

/** Narrows the wire format to what renderTranscript can read. */
function readTurns(value: unknown): ReportTurn[] | null {
  if (!Array.isArray(value)) return null;

  const turns: ReportTurn[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const turn = entry as { role?: unknown; text?: unknown };
    if (turn.role !== 'user' && turn.role !== 'agent') return null;
    if (typeof turn.text !== 'string') return null;
    turns.push({ role: turn.role, text: turn.text });
  }
  return turns;
}

export async function onRequestPost(
  context: EventContext<ReportEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  let body: AnalyseBody | null = null;
  try {
    body = (await request.json()) as AnalyseBody;
  } catch {
    return json({ error: 'Malformed request', code: 'bad_body' }, 400);
  }

  const language = typeof body?.languageCode === 'string' ? findLanguage(body.languageCode) : undefined;
  if (!language) {
    return json({ error: 'Unknown language', code: 'bad_language' }, 400);
  }

  /*
   * The first language is looked up in the same table as the target language,
   * which is a real limitation rather than a tidy reuse. The set of languages
   * worth *teaching* here is small and chosen for how well the models speak
   * them; the set a student might arrive with is every language there is. A
   * student whose L1 is missing has no way to say so, and picking the nearest
   * one is not a workaround anybody should have to invent.
   *
   * Left as it is because the fix is a second, much longer table of languages
   * that are only ever written *in*, never spoken by the tutor — and that table
   * is worth writing when there is a student page to expose it on, not before.
   */
  const l1 = typeof body?.l1Code === 'string' ? findLanguage(body.l1Code) : undefined;
  if (!l1) {
    return json({ error: 'Unknown first language', code: 'bad_l1' }, 400);
  }

  /*
   * The built-in short-circuits the bucket, which is what lets a deployment
   * with no binding — or one where nobody has authored a scale yet — still
   * produce a report. Only a saved id pays for a read.
   */
  const evaluatorId = typeof body?.evaluatorId === 'string' ? body.evaluatorId : '';
  let evaluator: Evaluator | undefined;
  if (!evaluatorId || evaluatorId === BUILTIN_EVALUATOR_ID) {
    evaluator = BUILTIN_EVALUATOR;
  } else if (!env.EVALUATORS) {
    return json({ error: 'No evaluator library is configured', code: 'no_bucket' }, 500);
  } else {
    evaluator = (await readLibrary(env.EVALUATORS)).find((entry) => entry.id === evaluatorId);
  }
  if (!evaluator) {
    return json({ error: 'Unknown evaluator', code: 'bad_evaluator' }, 400);
  }

  /*
   * The lesson's targets, read from the setup the student was actually handed.
   *
   * Every failure here is silent and yields no targets, which is the right
   * shape: the section is optional by design — a lesson with no targets has
   * none — so an unreachable bucket or a code naming a setup since deleted
   * costs the task section rather than the whole report. A learner
   * who waited two minutes for a reading should not be told to try again
   * because the half of it that is a bonus could not be assembled.
   *
   * A CODE IS REQUIRED, where a missing one used to fall through to whichever
   * setup was published last. That pointer is gone — see sessions/_library.ts —
   * and following it here would have been worse than useless once there is more
   * than one live lesson: it would report a student against another class's
   * targets and give no sign it had done so. No code now means no targets,
   * which is the same outcome tutorBench already gets.
   */
  let targets: string[] | undefined;
  if (env.SESSIONS) {
    try {
      const published = await readSetup(env.SESSIONS, String(body?.sessionCode ?? ''));
      if (published?.targets?.length) targets = published.targets;
    } catch {
      // See above: no targets is a survivable answer, a failed report is not.
    }
  }

  const turns = readTurns(body?.turns);
  if (!turns) {
    return json({ error: 'A transcript is required', code: 'bad_turns' }, 400);
  }

  // A call the learner never spoke in has nothing to report on, and asking
  // anyway produces a page of empty sections that reads as a broken feature.
  if (!turns.some((turn) => turn.role === 'user' && turn.text.trim())) {
    return json({ error: 'The learner did not say anything', code: 'no_learner_turns' }, 400);
  }

  const transcript = renderTranscript(turns);
  if (transcript.length > MAX_TRANSCRIPT) {
    return json({ error: 'That conversation is too long to report on', code: 'transcript_too_long' }, 413);
  }

  const key = vertexKey(env);
  if (!key) {
    return json({ error: `${VERTEX_KEY_NAMES} is not configured`, code: 'no_key' }, 500);
  }

  let upstream: Response;
  try {
    upstream = await fetch(vertexGenerateContentUrl(REPORT_MODEL.id), {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: reportInstruction({ language, l1, evaluator, targets }) }],
        },
        contents: [{ role: 'user', parts: [{ text: transcript }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: REPORT_SCHEMA,
          // Low, unlike the persona drafter's 1. That route wants a different
          // biography each time it is asked; this one is a measurement, and two
          // runs over one transcript disagreeing about what the learner did is
          // the failure mode rather than variety.
          temperature: 0.2,
        },
      }),
    });
  } catch (error) {
    console.error('report analyse threw', REPORT_MODEL.id, error);
    return json({ error: 'The report request failed', code: 'upstream' }, 502);
  }

  if (!upstream.ok) {
    // Body to the log only: an error can quote the request back, and the
    // request carries the whole conversation.
    const detail = await upstream.text();
    console.error('report analyse failed', REPORT_MODEL.id, upstream.status, detail);

    let reason: string | undefined;
    try {
      const parsed = JSON.parse(detail) as
        | { error?: { status?: string } }
        | { error?: { status?: string } }[];
      reason = trimmed((Array.isArray(parsed) ? parsed[0] : parsed)?.error?.status);
    } catch {
      reason = undefined;
    }

    return json(
      {
        error:
          reason === 'RESOURCE_EXHAUSTED'
            ? `${REPORT_MODEL.label} has no quota left for now — wait a minute and try again.`
            : reason
              ? `${REPORT_MODEL.label} declined: ${reason}`
              : `${REPORT_MODEL.label} could not read that conversation`,
        code: 'upstream',
        status: upstream.status,
        reason: reason ?? null,
      },
      502,
    );
  }

  const answer = (await upstream.json()) as {
    promptFeedback?: { blockReason?: string };
    usageMetadata?: Usage;
    candidates?: {
      finishReason?: string;
      content?: { parts?: { text?: string }[] };
    }[];
  };

  const candidate = answer.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .map((part) => part.text ?? '')
    .join('')
    .trim();

  if (!text) {
    // A refusal on this API is a 200 with no parts and a finishReason, which is
    // indistinguishable from a bug unless the classification is carried out.
    const reason =
      trimmed(answer.promptFeedback?.blockReason) ??
      trimmed(candidate?.finishReason) ??
      'no text and no stated reason';
    console.error('report analyse empty', REPORT_MODEL.id, JSON.stringify(answer).slice(0, 2000));
    return json({ error: `${REPORT_MODEL.label} declined: ${reason}`, code: 'upstream', reason }, 502);
  }

  /*
   * Parsed here rather than on the page, unlike persona/draft.ts.
   *
   * That route hands back text because a drafted biography is text and the page
   * reads it tolerantly. This one asked for a schema, so a body that will not
   * parse means the schema was not honoured — a fault in the call, not
   * something for the renderer to cope with. Failing here says so once, with
   * the body in the log, instead of leaving every section on the student page
   * to discover it separately.
   */
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    console.error('report analyse unparseable', REPORT_MODEL.id, text.slice(0, 2000));
    return json({ error: `${REPORT_MODEL.label} returned a malformed report`, code: 'bad_report' }, 502);
  }

  return json({
    report,
    usd: costUsd(answer.usageMetadata),
    cached: answer.usageMetadata?.cachedContentTokenCount ?? 0,
  });
}
