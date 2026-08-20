import type { PublishedSetup } from '../realtime/session';
import { FR } from './strings';

/**
 * The consigne and the questions, as the student reads them.
 *
 * IT STAYS UP DURING THE CALL, which is the whole reason it is on screen rather
 * than on a card before it. A learner three questions in wants to check what
 * the fourth one is, and a consigne they have to remember is one they stop
 * following by the second turn. What yields to the call instead is the gate
 * underneath — see EvaluationGate, which shrinks to a strip when this is above
 * it rather than owning the panel.
 *
 * IT GOES AWAY WHEN THE REPORT ARRIVES. Once there is an evaluation, the
 * consigne has been acted on and the reading is what the panel is for; leaving
 * it would push the thing the student came back for below the fold. It returns
 * on the next call because starting one clears the report — no extra machinery,
 * see `start` in Eleve.tsx.
 *
 * THE TARGETS ARE NOT HERE. They are in the consigne prose already, in the
 * teacher's own words — "utilise le passé composé" — and repeating them as a
 * checklist would turn the panel into a scoreboard the student watches instead
 * of talking. They come back at the end, in the report, which is where a
 * verdict belongs. See vocoSessions.ts on who reads what.
 *
 * IN FRENCH BECAUSE IT IS THE TEACHER'S FRENCH, not because strings.ts says so.
 * The brief and the questions are authored text published verbatim; only the
 * two headings come from the table.
 */

interface ConsignePanelProps {
  session: PublishedSetup;
  /**
   * How many questions the tutor says are done. See `answered` in useVoiceCall.
   *
   * A FLOOR AND NOT A SCORE, which decides how it is drawn. The tutor reports
   * this through a tool and under-reports more readily than it over-reports, so
   * the panel shows what is *left to do* rather than what has been achieved —
   * a number that lags reads as "still to come", where a lagging score reads as
   * a learner being marked down for work they have done.
   */
  answered?: number;
}

export default function ConsignePanel({ session, answered }: ConsignePanelProps) {
  const questions = session.questions ?? [];
  if (!questions.length) return null;

  // Clamped, because the tutor reports a question's number and a model that
  // miscounts its own list can name one past the end of it.
  const left = Math.max(0, questions.length - Math.min(answered ?? 0, questions.length));

  const brief = session.brief?.trim();

  return (
    <div className="border-b-2 border-lingo-border-light px-4 py-4">
      <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-lingo-accent">
        {FR.consigneTitle}
      </h3>
      <p className="rounded-lg border border-lingo-accent-light bg-lingo-accent-glow px-3 py-2.5 text-sm leading-relaxed text-lingo-ink">
        {brief || FR.consigneNoBrief}
      </p>

      <h3 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-lingo-accent">
        {FR.consigneQuestions}
      </h3>
      {/*
        Numbered, and the numbers are the tutor's order rather than decoration:
        it works down the list and comes back to where it was after a tangent,
        so a student who loses the thread can find it by number. `tabular-nums`
        keeps the text edge straight past nine.
      */}
      <ol className="space-y-2">
        {/*
          Only while there is something to count. Before a call it would be a
          countdown at full, which says nothing, and the list underneath already
          says how many there are.
        */}
        {typeof answered === 'number' && answered > 0 && (
          <p className="mb-2 text-xs font-semibold text-lingo-accent-deep">
            {left > 0
              ? left === 1
                ? FR.questionsLeftOne
                : FR.questionsLeftMany.replace('{n}', String(left))
              : `${FR.questionsAllDone} · ${FR.questionsKeepTalking}`}
          </p>
        )}
        {questions.map((question, index) => (
          <li key={index} className="flex gap-2.5 text-sm leading-relaxed text-lingo-ink">
            <span
              aria-hidden="true"
              className="shrink-0 font-lingo-mono text-xs font-semibold tabular-nums text-lingo-muted"
            >
              {index + 1}.
            </span>
            <span className="min-w-0 flex-1">{question}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
