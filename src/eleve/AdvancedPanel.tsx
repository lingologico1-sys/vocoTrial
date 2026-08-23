import type { AdvancedReport } from '../realtime/oralRubric';
import { FR } from './strings';

/**
 * The advanced marker, as a student should meet it.
 *
 * A SIBLING OF EvaluationPanel, NOT A VARIANT OF IT. That panel renders a walk
 * up an authored ladder and leads with the learner's best sentences, on the
 * argument that the first thing you read is the thing you believe. This one
 * renders an exam mark, and it leads with the mark — because a student who
 * pressed "Évalue-moi" under a rubric their teacher chose for its grade is owed
 * the grade in the first line rather than after three sections of preamble.
 * Coyness about a number somebody asked for reads as bad news being softened.
 *
 * What survives from that argument is the position of the second section: the
 * mark is immediately followed by what the student did well, in their own
 * words, so the corrections underneath are read as advice about real French
 * rather than as the itemisation of a verdict.
 *
 * THE IB FACE SHOWS THE IB MARK AND NOTHING ELSE. An IB student has never met
 * the CEFR, so a second verdict beside their grade is not a richer answer —
 * it is a scale they have to decode before they can trust the one they asked
 * for. So on `face === 'ib'` the CEFR line, the two-scales caveat that exists
 * only to keep two answers from competing, and the can-do list (which is the
 * CEFR verdict written out) are all absent. The report still carries all of
 * them; this panel simply does not render them on that face.
 *
 * The CEFR face is unchanged and still shows both, because a student reading a
 * level does benefit from the mark beside it. Neither scale is derived from the
 * other: the IB mark is a grade out of 7 computed by weighting three criteria;
 * the CEFR verdict is a criterion-referenced reading of the same three,
 * computed from their profile — see `computeCefrVerdict`, which carries the
 * argument for why mapping one onto the other would throw away the only thing
 * showing both adds. They are free to disagree, and `advTwoScales` is the line
 * that stops a student on that face trying to make one explain the other.
 *
 * A BOUNDARY MARK IS A BAND WITH A DIRECTION, NEVER A GRADE. Students hear
 * "6/7" as "7". So it is never rendered as a fraction: it renders as
 * "Bande 6–7", with what it is currently marking as underneath, and the
 * criterion holding it there named — spec §9.1b. "You're a 6/7" is motivating;
 * "you're a 6/7 and the gap is that you never opened a topic nobody asked
 * about" is actionable.
 *
 * WHAT IS DROPPED, AND WHY. The evidence block arrives in full and almost none
 * of it is rendered. `problem_turns`, `l1_insertions`,
 * `meaning_obscuring_errors` and `tenses_attempted_with_errors` are the working
 * of the mark, not the message: the two fixes downstream already carry the two
 * corrections a student will actually act on, and the spec is deliberate that
 * students act on two and ignore ten. What is shown from evidence is the
 * positive half — the B1 structures they landed and the things they volunteered
 * — because those are the two behaviours the rubric rewards most and the ones
 * hardest to notice in yourself.
 *
 * QUOTES STAY IN FRENCH, uncorrected. Everything said about them arrives from
 * the model in the learner's own language, which is the same division the rest
 * of the student page follows.
 */

interface AdvancedPanelProps {
  report: AdvancedReport;
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-lingo-accent">
      {children}
    </h3>
  );
}

/** A learner's own words. Always French, never translated. */
function Quote({ children }: { children: React.ReactNode }) {
  return <span className="italic text-lingo-ink">&laquo;&nbsp;{children}&nbsp;&raquo;</span>;
}

const CRITERION_LABELS = {
  A: FR.advCriterionA,
  B: FR.advCriterionB,
  C: FR.advCriterionC,
} as const;

export default function AdvancedPanel({ report }: AdvancedPanelProps) {
  const { face, final, scores, evidence, feedback } = report;

  if (final.insufficient_evidence) {
    return (
      <div className="px-4 py-8">
        <p className="text-center text-sm leading-relaxed text-lingo-muted">{FR.advUnplaced}</p>
      </div>
    );
  }

  const mark = final.display_mark ?? String(final.final_ib_mark ?? '');
  const level = final.cefr_verdict ?? '';
  const boundary = final.is_boundary === true;
  const [low, high] = boundary ? mark.split('/') : ['', ''];

  const limiting = (final.limiting_criteria_keys ?? [])
    .map((key) => CRITERION_LABELS[key])
    .join(' et ');

  const rows: { key: 'A' | 'B' | 'C'; score: number; why: string; quotes: string[] }[] = [
    { key: 'A', score: scores.a_language.score, why: scores.a_language.why, quotes: scores.a_language.quotes },
    {
      key: 'B',
      score: scores.b_vocabulary_relevance.score,
      why: scores.b_vocabulary_relevance.why,
      quotes: scores.b_vocabulary_relevance.quotes,
    },
    {
      key: 'C',
      score: scores.c_interactive_skills.score,
      why: scores.c_interactive_skills.why,
      quotes: scores.c_interactive_skills.quotes,
    },
  ];

  const canDo = final.can_do_key ? FR.advCanDo[final.can_do_key] : [];

  /*
    What the conversation could not reach, if anything. Assembled from the two
    factors separately, because they have different remedies and collapsing them
    produces advice that fits neither. Nothing here is a penalty — the last line
    says so, and it is not conditional.
  */
  const limitLines: (string | false)[] = [
    final.confidence_coverage === 'MINIMAL' && FR.advCoverageMinimal,
    final.confidence_coverage === 'PARTIAL' && FR.advCoveragePartial,
    final.confidence_sample === 'SHORT' && FR.advSampleShort,
    final.confidence_sample === 'THIN' && FR.advSampleThin,
  ];
  const limits = limitLines.filter((line): line is string => typeof line === 'string');

  return (
    <div className="space-y-6 px-4 py-4">
      {/* ── The result ─────────────────────────────────────────────── */}
      <section className="rounded-2xl border-2 border-lingo-accent bg-lingo-panel-warm px-4 py-4">
        <Heading>{face === 'ib' ? FR.advTitleIb : FR.advTitleCefr}</Heading>

        {face === 'ib' ? (
          <>
            {boundary ? (
              <>
                <p className="font-lingo-brand text-3xl leading-none text-lingo-ink">
                  {FR.advBandRange(low, high)}
                </p>
                <p className="mt-1 text-sm text-lingo-muted">
                  {FR.advLeaning(final.boundary_leaning ?? String(final.final_ib_mark))}
                </p>
              </>
            ) : (
              <p className="font-lingo-brand text-4xl leading-none text-lingo-ink">{mark}/7</p>
            )}
          </>
        ) : (
          <>
            <p className="font-lingo-brand text-3xl leading-none text-lingo-ink">{level}</p>
            {canDo.length > 0 && (
              <p className="mt-1 text-sm leading-relaxed text-lingo-muted">{canDo[0]}</p>
            )}
            <p className="mt-2.5 text-sm text-lingo-ink">
              <span className="text-lingo-muted">{FR.advAlsoIb} : </span>
              <span className="font-semibold">
                {boundary ? FR.advBandRange(low, high) : `${mark}/7`}
              </span>
            </p>
          </>
        )}

        {/*
          Named right under the mark rather than in the criterion list, because
          on a boundary it is the single most actionable sentence in the panel:
          it says which of three things to work on to close the band.
        */}
        {boundary && limiting && (
          <p className="mt-2.5 text-xs leading-relaxed text-lingo-ink">{FR.advLimiting(limiting)}</p>
        )}

        {face === 'cefr' && (
          <p className="mt-3 text-[11px] leading-relaxed text-lingo-muted">{FR.advTwoScales}</p>
        )}
      </section>

      {/* ── What went well, second, in their own words ─────────────── */}
      {feedback.strength && (
        <section>
          <Heading>{FR.advStrengthTitle}</Heading>
          <p className="rounded-lg border border-lingo-success/30 bg-lingo-success-bg px-3 py-2.5 text-sm leading-relaxed text-lingo-ink">
            {feedback.strength}
          </p>
        </section>
      )}

      {/* ── The three criteria ─────────────────────────────────────── */}
      <section>
        <Heading>{FR.advCriteriaTitle}</Heading>
        <ul className="space-y-2.5">
          {rows.map((row) => (
            <li
              key={row.key}
              className="rounded-lg border border-lingo-border-strong/40 bg-lingo-surface px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-lingo-ink">
                  {CRITERION_LABELS[row.key]}
                </span>
                <span className="font-lingo-mono text-sm text-lingo-accent">
                  {FR.advOutOf(row.score)}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-lingo-muted">{row.why}</p>
              {row.quotes.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {row.quotes.map((quote, index) => (
                    <li key={index} className="text-xs leading-snug">
                      <Quote>{quote}</Quote>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/*
        The positive half of the evidence block, and only that half.

        A si clause that landed and a topic nobody asked for are the two things
        this rubric rewards hardest and the two a student is least likely to
        notice themselves. The error half of the same block stays out: the two
        fixes below are the corrections worth acting on, and a list of every
        slip underneath them would bury both.
      */}
      {(evidence.b1_structures_found.length > 0 ||
        evidence.unprompted_contributions.length > 0) && (
        <section>
          <Heading>{FR.evalLadderTitle}</Heading>
          <ul className="space-y-1.5">
            {evidence.b1_structures_found.slice(0, 3).map((found, index) => (
              <li
                key={`b1-${index}`}
                className="rounded-lg border border-lingo-success/30 bg-lingo-success-bg px-3 py-2 text-xs leading-snug"
              >
                <Quote>{found.quote}</Quote>
              </li>
            ))}
            {evidence.unprompted_contributions.slice(0, 2).map((contribution, index) => (
              <li
                key={`up-${index}`}
                className="rounded-lg border border-lingo-accent/30 bg-lingo-panel-warm px-3 py-2 text-xs leading-snug"
              >
                <Quote>{contribution}</Quote>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Exactly two fixes. Students act on two and ignore ten. ─── */}
      <section>
        <Heading>{FR.advFixesTitle}</Heading>
        <ul className="space-y-2.5">
          {[feedback.fix_1, feedback.fix_2]
            .filter((fix) => fix?.student_said)
            .map((fix, index) => (
              <li
                key={index}
                className="rounded-lg border border-lingo-border-strong/40 bg-lingo-surface px-3 py-2.5"
              >
                <p className="text-xs text-lingo-muted">{FR.evalSaid}</p>
                <p className="text-sm leading-snug">
                  <Quote>{fix.student_said}</Quote>
                </p>
                <p className="mt-1.5 text-xs text-lingo-muted">{FR.evalBetter}</p>
                <p className="text-sm font-semibold leading-snug text-lingo-success">
                  {fix.should_be}
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-lingo-muted">{fix.why}</p>
              </li>
            ))}
        </ul>
      </section>

      {/* ── One structure, one model, one question to try it on ────── */}
      {feedback.practise?.structure && (
        <section>
          <Heading>{FR.advPractiseTitle}</Heading>
          <p className="text-sm font-semibold text-lingo-ink">{feedback.practise.structure}</p>
          <p className="mt-1 text-sm leading-snug">
            <Quote>{feedback.practise.model_sentence}</Quote>
          </p>
          {feedback.practise.practice_prompt && (
            <div className="mt-2 rounded-lg border border-lingo-accent/30 bg-lingo-panel-warm px-3 py-2.5">
              <p className="text-[11px] uppercase tracking-wider text-lingo-muted">
                {FR.advPractisePrompt}
              </p>
              <p className="mt-0.5 text-sm leading-snug text-lingo-ink">
                {feedback.practise.practice_prompt}
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── Can-do, on the CEFR side of the same three criteria ────── */}
      {face === 'cefr' && canDo.length > 0 && (
        <section>
          <Heading>{FR.advCanDoTitle}</Heading>
          <ul className="space-y-1.5">
            {canDo.map((line, index) => (
              <li key={index} className="text-sm leading-relaxed text-lingo-ink">
                — {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── What this conversation could and could not measure ─────── */}
      {limits.length > 0 && (
        <section>
          <Heading>{FR.advConfidenceTitle}</Heading>
          {limits.map((line, index) => (
            <p key={index} className="text-xs leading-relaxed text-lingo-muted">
              {line}
            </p>
          ))}
          <p className="mt-1.5 text-xs leading-relaxed text-lingo-muted">{FR.advNoPenalty}</p>
        </section>
      )}

      {/*
        The two caveats, last and small but never absent. See strings.ts: one is
        what this mark is not, the other is what the transcript underneath it is
        worth. Both belong beside a number a student might otherwise take to a
        parent as a grade.
      */}
      <section className="border-t-2 border-lingo-border-strong/30 pt-3">
        <p className="text-[11px] leading-relaxed text-lingo-muted">{FR.advDisclaimer}</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-lingo-muted">
          {FR.advTranscriptCaveat}
        </p>
      </section>
    </div>
  );
}
