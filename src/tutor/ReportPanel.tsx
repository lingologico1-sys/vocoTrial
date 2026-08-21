import type { SessionReport } from '../realtime/report';
import { formatUsd } from '../realtime/cost';

/**
 * The report, rendered in the order it was generated in.
 *
 * THE ORDER IS THE ARGUMENT, so the page keeps it. What the model could not
 * read comes before what it concluded, because a reader who sees the diagnosis
 * first will believe it and then skim the caveat. Putting the holes at the top
 * makes the rest of the page conditional on them by simple reading order, which
 * is the same reason the schema is ordered that way.
 *
 * NOTHING IS HIDDEN WHEN EMPTY, above the fold. A section with no findings says
 * so, because "no turns were misheard" and "we did not check" look identical
 * when the difference is a missing heading — and one of them is a claim worth
 * making. Below the fold the quieter sections drop out.
 */

interface Props {
  report: SessionReport;
  usd: number;
}

const CONFIDENCE: Record<SessionReport['diagnosis']['confidence'], string> = {
  clear: 'clearly',
  borderline: 'borderline',
  'too-little-evidence': 'not enough was said to place them',
};

const BAND_TONE: Record<SessionReport['bands'][number]['verdict'], string> = {
  met: 'border-emerald-800/60 text-emerald-300',
  partly: 'border-amber-800/60 text-amber-300',
  'not-shown': 'border-slate-800 text-slate-600',
};

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs uppercase tracking-wide text-slate-500">{children}</h3>;
}

/** A learner quote. Always in the language of the call, never translated. */
function Quote({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-200">&ldquo;{children}&rdquo;</span>;
}

export default function ReportPanel({ report, usd }: Props) {
  const placed = report.diagnosis.confidence !== 'too-little-evidence';

  return (
    <div className="space-y-5 rounded-lg border border-slate-800 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs uppercase tracking-wide text-slate-500">Report</span>
        <span className="font-mono text-[11px] text-slate-600">{formatUsd(usd)}</span>
      </div>

      {/* What could not be read, first and always. */}
      <section className="space-y-1.5">
        <Heading>Turns I could not read</Heading>
        {report.turnConfidence.length === 0 ? (
          <p className="text-xs text-slate-600">
            None — every turn came through as plausible text.
          </p>
        ) : (
          <>
            {report.turnConfidence.map((turn) => (
              <p key={turn.turn} className="text-sm text-slate-400">
                <span className="font-mono text-xs text-slate-600">[{turn.turn}]</span>{' '}
                <span className="font-mono text-rose-300/80">{turn.text}</span>
                <span className="text-xs text-slate-600"> — {turn.verdict}</span>
              </p>
            ))}
            <p className="text-[11px] leading-relaxed text-slate-600">
              Left out of everything below. These are the speech model mishearing, not
              mistakes — do not read them as things that were said.
            </p>
          </>
        )}
      </section>

      <section className="space-y-1.5">
        <Heading>Turns that did not land</Heading>
        {report.comprehensionMisses.length === 0 ? (
          <p className="text-xs text-slate-600">None — both sides answered each other.</p>
        ) : (
          report.comprehensionMisses.map((miss) => (
            <div key={miss.turn} className="space-y-0.5 text-sm">
              <p className="text-slate-400">
                <span className="font-mono text-xs text-slate-600">[{miss.turn}]</span>{' '}
                <Quote>{miss.tutorSaid}</Quote>
              </p>
              <p className="text-slate-400 pl-6">
                → <Quote>{miss.learnerSaid}</Quote>
              </p>
              <p className="pl-6 text-xs text-amber-300/80">{miss.note}</p>
            </div>
          ))
        )}
      </section>

      {/* The scale walk, then the verdict drawn from it. */}
      <section className="space-y-2">
        <Heading>The scale</Heading>
        <div className="flex flex-wrap gap-1.5">
          {report.bands.map((band) => (
            <span
              key={band.code}
              title={
                band.met.length ? `Showed: ${band.met.join('; ')}` : 'Nothing from this band showed'
              }
              className={`rounded border px-2 py-0.5 font-mono text-xs ${BAND_TONE[band.verdict]}`}
            >
              {band.code}
            </span>
          ))}
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/40 p-3">
          <p className="text-sm text-slate-200">
            {placed ? (
              <>
                <span className="font-mono text-base text-sky-300">{report.diagnosis.band}</span>
                <span className="text-slate-500"> — {CONFIDENCE[report.diagnosis.confidence]}</span>
              </>
            ) : (
              <span className="text-amber-300">{CONFIDENCE[report.diagnosis.confidence]}</span>
            )}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">{report.diagnosis.because}</p>
        </div>
      </section>

      {report.bestSentences.length > 0 && (
        <section className="space-y-1.5">
          <Heading>Best sentences</Heading>
          {report.bestSentences.map((best) => (
            <div key={best.turn} className="text-sm">
              <p>
                <Quote>{best.quote}</Quote>
              </p>
              <p className="text-xs text-slate-500">{best.why}</p>
            </div>
          ))}
        </section>
      )}

      {/*
        Here for the tuner rather than for the learner, and it is the one
        section of this panel that reads the *tutor*. "Ask for the longer
        answer" is an instruction in lessonBlock, and whether a style actually
        produces reaching is otherwise invisible: a run of `played-safe` across
        several learners is the prompt failing, not the class. `landed` is shown
        because a style that produces ambitious wrong sentences is working and
        one that produces none is not.
      */}
      {report.ambition && (
        <section className="space-y-1.5">
          <Heading>Reach</Heading>
          <p className="text-sm text-slate-300">
            <span className="font-mono text-xs uppercase tracking-wide text-sky-300">
              {report.ambition.verdict}
            </span>
            <span className="text-slate-500"> — {report.ambition.note}</span>
          </p>
          {report.ambition.reaches.map((reach, index) => (
            <div key={index} className="text-sm">
              <p>
                <Quote>{reach.quote}</Quote>
                <span className={reach.landed ? 'text-emerald-400' : 'text-amber-400'}>
                  {reach.landed ? ' ✓' : ' ✗'}
                </span>
              </p>
              <p className="text-xs text-slate-500">{reach.reach}</p>
            </div>
          ))}
        </section>
      )}

      {report.errorPatterns.length > 0 && (
        <section className="space-y-2.5">
          <Heading>What to fix</Heading>
          {report.errorPatterns.map((pattern, index) => (
            <div key={index} className="space-y-1 text-sm">
              <p className="text-slate-200">{pattern.pattern}</p>
              {pattern.quotes.map((quote, at) => (
                <p key={at} className="pl-3 text-xs">
                  <span className="text-rose-300/80 line-through decoration-rose-500/40">
                    {quote}
                  </span>
                  {pattern.corrected[at] && (
                    <span className="text-emerald-300/90"> → {pattern.corrected[at]}</span>
                  )}
                </p>
              ))}
              <p className="text-xs text-slate-500">{pattern.rule}</p>
              <p className="text-xs text-sky-300/80">{pattern.tryNext}</p>
            </div>
          ))}
        </section>
      )}

      {(report.uptake.taken.length > 0 || report.uptake.missed.length > 0) && (
        <section className="space-y-1.5">
          <Heading>Corrections you were given</Heading>
          {report.uptake.taken.map((entry, index) => (
            <p key={`t${index}`} className="text-xs text-emerald-300/90">
              ✓ <Quote>{entry.recast}</Quote> — later used: {entry.laterUse}
            </p>
          ))}
          {report.uptake.missed.map((entry, index) => (
            <p key={`m${index}`} className="text-xs text-slate-500">
              ✗ <Quote>{entry.recast}</Quote> — what followed: {entry.whatFollowed}
            </p>
          ))}
        </section>
      )}

      {report.toNextBand.length > 0 && (
        <section className="space-y-1">
          <Heading>To move up a band</Heading>
          <ul className="list-disc space-y-0.5 pl-4 text-sm text-slate-300">
            {report.toNextBand.map((target, index) => (
              <li key={index}>{target}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-[11px] leading-relaxed text-slate-600">
        Read from the transcript alone. Pronunciation is not assessed — no audio reaches the
        model that wrote this, only the words the speech model heard.
      </p>
    </div>
  );
}
