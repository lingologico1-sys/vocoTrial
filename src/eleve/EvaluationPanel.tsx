import type { SessionReport } from '../realtime/report';
import { FR, frenchDuration } from './strings';

/**
 * The end-of-call report, as a student should meet it.
 *
 * DELIBERATELY NOT tutor/ReportPanel.tsx, and the differences are the whole
 * point of the file. That panel is for the person who tuned the tutor: it leads
 * with what the model could not read, shows every rung including the ones with
 * no evidence, and prints what the report cost. All three are right there and
 * wrong here.
 *
 * WHAT IS DROPPED, AND WHY:
 *
 *  - `turnConfidence`, the turns the speech model garbled. A maintainer needs
 *    to know the transcript is unreliable. A learner reading "I could not
 *    understand these four things you said" is being told they are unintelligible
 *    by a machine that misheard them, which is false and discouraging in the
 *    same breath.
 *  - Bands with verdict `not-shown`. A rung with no evidence either way is not a
 *    failure, but a list of levels with most of them greyed out reads as one.
 *    What is shown is what they demonstrated.
 *  - `comprehensionMisses` and `uptake`. Both are real findings and both are
 *    about the conversation as an object of study — where it broke down, whether
 *    a correction was absorbed. That is a teacher's view of a student, and
 *    handing it to the student turns a conversation into a graded exercise.
 *  - The cost. Never, on any page a student sees.
 *
 * THE ORDER IS ALSO AN ARGUMENT, as it is in the maintainer's panel — just a
 * different one. That page puts the holes first so the diagnosis is read
 * conditionally. This one opens with the best sentences the learner produced,
 * because the first thing you read is the thing you believe, and a learner who
 * opens on their own good French reads the rest as advice rather than as a
 * verdict.
 *
 * QUOTES STAY IN FRENCH. Everything said *about* them arrives in the learner's
 * own language, which is what the report route already does — the L1 is a
 * parameter of the request, not something rendered here.
 */

interface EvaluationPanelProps {
  report: SessionReport;
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

export default function EvaluationPanel({ report }: EvaluationPanelProps) {
  const placed = report.diagnosis.confidence !== 'too-little-evidence';
  // Only the rungs there is evidence for. See the header.
  const shown = report.bands.filter((band) => band.verdict !== 'not-shown');

  return (
    <div className="space-y-6 px-4 py-4">
      <section>
        <Heading>{FR.evalBestTitle}</Heading>
        {report.bestSentences.length === 0 ? (
          <p className="text-sm leading-relaxed text-lingo-muted">{FR.evalBestEmpty}</p>
        ) : (
          <ul className="space-y-2.5">
            {report.bestSentences.map((best, index) => (
              <li
                key={index}
                className="rounded-lg border border-lingo-success/30 bg-lingo-success-bg px-3 py-2.5"
              >
                <p className="text-sm leading-snug">
                  <Quote>{best.quote}</Quote>
                </p>
                <p className="mt-1 text-xs leading-relaxed text-lingo-muted">{best.why}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/*
        The consigne, read back.

        SECOND, NOT FIRST, AND NOT LAST. The best sentences keep the opening for
        the reason in the header — the first thing read is the thing believed —
        but this is the question the student actually has: they were told to use
        the passé composé an hour ago and they want to know whether they did.
        Putting it above the level also keeps the two apart in the reading, which
        is the point of it being a separate axis: it is not a rung, and a student
        who meets it after their band will read it as one.

        Absent for a session with no sheet, which is every session published
        before sheets existed. See sheets.ts.
      */}
      {report.task?.length > 0 && (
        <section>
          <Heading>{FR.evalTaskTitle}</Heading>
          <ul className="space-y-2">
            {report.task.map((entry, index) => (
              <li
                key={index}
                className={`rounded-lg border px-3 py-2.5 ${
                  entry.verdict === 'met'
                    ? 'border-lingo-success/40 bg-lingo-success-bg'
                    : entry.verdict === 'partly'
                      ? 'border-lingo-accent-light bg-lingo-accent-glow'
                      : 'border-lingo-border-light bg-lingo-surface'
                }`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 text-sm font-semibold text-lingo-ink">
                    {entry.target}
                  </span>
                  <span
                    className={`shrink-0 text-[11px] font-bold uppercase tracking-wider ${
                      entry.verdict === 'met'
                        ? 'text-lingo-success'
                        : entry.verdict === 'partly'
                          ? 'text-lingo-accent-deep'
                          : 'text-lingo-muted'
                    }`}
                  >
                    {entry.verdict === 'met'
                      ? FR.evalTaskMet
                      : entry.verdict === 'partly'
                        ? FR.evalTaskPartly
                        : FR.evalTaskMissing}
                  </span>
                </div>
                {entry.evidence && (
                  <p className="mt-1.5 text-xs leading-snug">
                    <Quote>{entry.evidence}</Quote>
                  </p>
                )}
                {/*
                  The model's line, or ours when it is "not-shown" and has
                  nothing to say. A blank row under a grey verdict reads as a
                  mark against the learner, and the strings table says in as
                  many words that it is not one.
                */}
                <p className="mt-1 text-xs leading-relaxed text-lingo-muted">
                  {entry.note?.trim() ||
                    (entry.verdict === 'not-shown' ? FR.evalTaskMissingNote : '')}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <Heading>{FR.evalLevelTitle}</Heading>
        {placed ? (
          <div className="rounded-xl border-2 border-lingo-border-strong bg-lingo-surface px-4 py-3.5 shadow-lingo-pop-sm">
            <p className="font-lingo-display text-xl font-semibold text-lingo-ink">
              {report.diagnosis.confidence === 'borderline'
                ? FR.evalBorderline(report.diagnosis.band)
                : FR.evalYouAre(report.diagnosis.band)}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-lingo-muted">
              {report.diagnosis.because}
            </p>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-lingo-muted">{FR.evalUnplaced}</p>
        )}
      </section>

      {shown.length > 0 && (
        <section>
          <Heading>{FR.evalLadderTitle}</Heading>
          <ul className="space-y-1.5">
            {shown.map((band) => (
              <li
                key={band.code}
                className={`rounded-lg border px-3 py-2 ${
                  band.verdict === 'met'
                    ? 'border-lingo-success/40 bg-lingo-success-bg'
                    : 'border-lingo-accent-light bg-lingo-accent-glow'
                }`}
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-lingo-mono text-xs font-semibold text-lingo-ink">
                    {band.code}
                  </span>
                  <span className="min-w-0 flex-1 text-xs leading-snug text-lingo-muted">
                    {band.met.join(', ')}
                  </span>
                </div>
                {band.evidence && (
                  <p className="mt-1 text-xs leading-snug">
                    <Quote>{band.evidence}</Quote>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.errorPatterns.length > 0 && (
        <section>
          <Heading>{FR.evalPatternsTitle}</Heading>
          <ul className="space-y-2.5">
            {report.errorPatterns.map((pattern, index) => (
              <li
                key={index}
                className="rounded-lg border border-lingo-border-light bg-lingo-surface px-3 py-2.5"
              >
                <p className="text-sm font-semibold text-lingo-ink">{pattern.pattern}</p>
                <p className="mt-1 text-xs leading-relaxed text-lingo-muted">{pattern.rule}</p>

                {pattern.quotes.slice(0, 2).map((wrong, at) => (
                  <p key={at} className="mt-1.5 text-xs leading-snug">
                    <span className="text-lingo-muted">{FR.evalSaid} </span>
                    <span className="text-lingo-error line-through">{wrong}</span>
                    {pattern.corrected[at] && (
                      <>
                        <span className="text-lingo-muted"> · {FR.evalBetter} </span>
                        <span className="font-semibold text-lingo-success">
                          {pattern.corrected[at]}
                        </span>
                      </>
                    )}
                  </p>
                ))}

                <p className="mt-2 border-t border-lingo-border-light pt-2 text-xs leading-relaxed text-lingo-info-deep">
                  {pattern.tryNext}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.toNextBand.length > 0 && (
        <section>
          <Heading>{FR.evalNextTitle}</Heading>
          <ul className="space-y-1.5">
            {report.toNextBand.map((step, index) => (
              <li
                key={index}
                className="flex gap-2 text-sm leading-relaxed text-lingo-ink"
              >
                <span aria-hidden="true" className="text-lingo-accent">
                  →
                </span>
                <span className="min-w-0 flex-1">{step}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The states before there is a report: mid-call, too short, and ready.
 *
 * Kept beside the panel rather than in the page, because what they say is part
 * of the same promise — the gate is two minutes and the copy has to agree with
 * the constant that enforces it.
 *
 * `under` IS THE WHOLE OF WHAT THE CONSIGNE CHANGED. With questions above it
 * the gate is no longer the panel, it is the strip at the foot of one, and the
 * generous centred padding that made a lone message look deliberate makes a
 * footer look like a gap. The two idle lines also stop being needed: a student
 * reading the questions does not need to be told the evaluation comes later,
 * because the questions are visibly the thing to be getting on with. So under a
 * consigne those states collapse to the clock, or to nothing.
 */
export function EvaluationGate({
  live,
  elapsedMs,
  lastCallMs,
  minimumMs,
  busy,
  error,
  under,
  onEvaluate,
}: {
  live: boolean;
  elapsedMs: number | null;
  lastCallMs: number | null;
  minimumMs: number;
  busy: boolean;
  error: string | null;
  /** True when a consigne is rendered above this. See the header. */
  under?: boolean;
  onEvaluate: () => void;
}) {
  const pad = under ? 'px-4 py-3' : 'px-4 py-8';

  if (live) {
    return (
      <div className={`${under ? 'px-4 py-3' : 'px-4 py-6'} text-center`}>
        <p className="text-sm leading-relaxed text-lingo-muted">
          {under ? FR.evalLive : FR.evalDuring}
        </p>
        {elapsedMs !== null && (
          <p className="mt-1 font-lingo-mono text-xs text-lingo-muted">
            {FR.evalElapsed(frenchDuration(elapsedMs))}
          </p>
        )}
      </div>
    );
  }

  if (busy) {
    return <p className={`${pad} text-center text-sm text-lingo-muted`}>{FR.evalWorking}</p>;
  }

  // Nothing has been said yet at all. Under a consigne this says nothing: the
  // questions are the instruction, and a line telling the student their
  // evaluation will appear later is answering a question nobody asked yet.
  if (lastCallMs === null) {
    if (under) return null;
    return (
      <p className="px-4 py-8 text-center text-sm leading-relaxed text-lingo-muted">
        {FR.evalIdle}
      </p>
    );
  }

  if (lastCallMs < minimumMs) {
    return (
      <div className={`${pad} text-center`}>
        <p className="text-sm leading-relaxed text-lingo-muted">
          {FR.evalRemaining(frenchDuration(minimumMs - lastCallMs))}
        </p>
      </div>
    );
  }

  return (
    <div className={pad}>
      <button
        type="button"
        onClick={onEvaluate}
        className="w-full rounded-xl bg-lingo-accent px-6 py-3.5 text-[15px] font-semibold text-white shadow-lingo-pop-sm transition-all hover:-translate-y-px hover:bg-lingo-accent-deep hover:shadow-lingo-pop"
      >
        {FR.evalButton}
      </button>
      {error && <p className="mt-3 text-xs text-lingo-error">{error}</p>}
    </div>
  );
}
