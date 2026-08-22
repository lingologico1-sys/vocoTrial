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
        What they dared, straight after what they did well.

        SECOND, AND DELIBERATELY ABOVE THE LEVEL. This is the one section
        that can say something the learner does not want to hear — "tu es resté
        sur des phrases sûres" — and the header's argument is that the opening
        is the part that gets believed. Buried under the level it would be read
        as a footnote to a mark; read second, next to their own best sentences,
        it is advice about the same language.

        A FAILED REACH IS SHOWN AS A REACH. `landed` decides the colour and
        nothing else: an attempt that came out wrong is bordered like a note
        rather than like an error, because the section exists to make reaching
        worth doing. What was actually wrong with it is downstream, under
        "À corriger", where a correction belongs.
      */}
      {report.ambition && (
        <section>
          <Heading>{FR.evalAmbitionTitle}</Heading>
          <p className="text-sm font-semibold leading-snug text-lingo-ink">
            {report.ambition.verdict === 'stretched'
              ? FR.evalAmbitionStretched
              : report.ambition.verdict === 'mixed'
                ? FR.evalAmbitionMixed
                : FR.evalAmbitionSafe}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-lingo-muted">{report.ambition.note}</p>
          {report.ambition.reaches.length > 0 && (
            <ul className="mt-2.5 space-y-2">
              {report.ambition.reaches.map((reach, index) => (
                <li
                  key={index}
                  className={`rounded-lg border px-3 py-2.5 ${
                    reach.landed
                      ? 'border-lingo-success/30 bg-lingo-success-bg'
                      : 'border-lingo-accent-light bg-lingo-accent-glow'
                  }`}
                >
                  <p className="text-sm leading-snug">
                    <Quote>{reach.quote}</Quote>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-lingo-muted">{reach.reach}</p>
                </li>
              ))}
            </ul>
          )}
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
 * Below this an unfinished conversation has not produced enough to read.
 *
 * Two minutes, for the reason MIN_CAP_MINUTES gives: a level judgement needs
 * learner speech, and the learner's share of a conversation is realistically
 * 35-50% of the clock. It applies to a lesson that stopped partway — someone
 * who hung up, or a call the cap cut short with questions outstanding. A
 * finished lesson is measured against the floor below instead.
 */
export const MIN_EVAL_MS = 120_000;

/**
 * Below this even a finished lesson has not produced enough to read.
 *
 * NINETY SECONDS, AND IT IS A DIFFERENT KIND OF NUMBER from the one above. That
 * floor is a judgement about how much speech a level needs. This one is a guard
 * against the tutor's bookkeeping being wrong: "finished" is a count the model
 * volunteers, and a model that reports five questions in the first twenty
 * seconds would otherwise be handed a transcript with nothing in it.
 *
 * A learner who has genuinely answered a short list in under ninety seconds is
 * possible and is the case this number is unfair to. It is the only place left
 * where the app second-guesses a completed lesson, and it stays because the
 * failure it prevents — a confident-looking report on four exchanges — costs
 * the student more than a wait does.
 */
export const MIN_COMPLETE_EVAL_MS = 90_000;

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
  complete,
  onEvaluate,
}: {
  live: boolean;
  elapsedMs: number | null;
  lastCallMs: number | null;
  /**
   * The floor this call has to clear, which is not a constant any more.
   *
   * The page picks it from whether the lesson finished — two minutes for a
   * conversation that stopped partway, ninety seconds for one that got through
   * its questions. See `evalFloorMs` in Eleve.tsx. It arrives as a number
   * rather than as the rule, so the copy below can quote whatever it is.
   */
  minimumMs: number;
  busy: boolean;
  error: string | null;
  /** True when a consigne is rendered above this. See the header. */
  under?: boolean;
  /** True when the tutor got through every question. Changes what is said, twice. */
  complete?: boolean;
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

  /*
    Short of the floor. A learner who finished the list gets a different line:
    the plain one reads as "you did not do enough" to somebody who did
    everything they were set, and the shortfall is really the teacher's list
    being brief. See evalRemainingDone in strings.ts.
  */
  if (lastCallMs < minimumMs) {
    return (
      <div className={`${pad} text-center`}>
        <p className="text-sm leading-relaxed text-lingo-muted">
          {complete
            ? FR.evalRemainingDone(frenchDuration(minimumMs - lastCallMs))
            : FR.evalRemaining(frenchDuration(minimumMs - lastCallMs))}
        </p>
      </div>
    );
  }

  return (
    <div className={pad}>
      {/*
        Said before the button and not after the report, because it is a promise
        rather than an excuse. A short finished lesson produces a reading with no
        level in it — the scale needs more speech than four questions give — and
        a learner who was expecting one reads "pas assez d'éléments" as the app
        failing. Told first, the same page reads as what it is.
      */}
      {complete && lastCallMs < MIN_EVAL_MS && (
        <p className="mb-2.5 text-center text-xs leading-relaxed text-lingo-muted">
          {FR.evalShortSample}
        </p>
      )}
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
