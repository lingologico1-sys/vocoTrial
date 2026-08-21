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
   * Which questions the page has counted as answered. See `answered` in
   * useVoiceCall for why that is the page's count and not the tutor's claim.
   *
   * IT TICKS AGAIN, AND IT COULD NOT FOR A WHILE. This was a live count until
   * per-question reporting had to be given up: on Vertex, answering any tool
   * call restarts the model into a turn spoken on top of the last one, so the
   * countdown was costing the learner a repeated question apiece. It came back
   * with the move to a surface that implements non-blocking calls, and it is
   * the half of this panel a learner who has lost their place actually reads.
   *
   * WHICH SURFACE THAT IS, IS THE TEACHER'S ANSWER NOW. The default model
   * honours non-blocking calls and this counts cleanly; the other does not, and
   * a lesson published on it can repeat a question exactly as before. That is a
   * cost /teach states in the sentences models.ts writes, chosen with open
   * eyes, and not something to detect and hide here — see the header of
   * Eleve.tsx on why the page does not withdraw features by model.
   */
  answered?: number[];
}

export default function ConsignePanel({ session, answered }: ConsignePanelProps) {
  const questions = session.questions ?? [];
  if (!questions.length) return null;

  const done = new Set(answered ?? []);
  const complete = done.size >= questions.length;

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
          Only when every question has been counted. Part-way through, the ticks
          on the list below say where the conversation has got to, which is the
          thing a student wants to know and this line never was.
        */}
        {complete && (
          <p className="mb-2 text-xs font-semibold text-lingo-accent-deep">
            {`${FR.questionsAllDone} · ${FR.questionsKeepTalking}`}
          </p>
        )}
        {questions.map((question, index) => {
          /*
            Answered questions dim rather than disappear or strike through. A
            student rereads the one they are on and glances at the ones they
            have done; a line through the text makes the second harder without
            making the first easier, and removing them would leave a learner
            who lost the thread with nothing to count against.
          */
          const answeredHere = done.has(index + 1);
          return (
            <li
              key={index}
              className={`flex gap-2.5 text-sm leading-relaxed transition-colors ${
                answeredHere ? 'text-lingo-muted' : 'text-lingo-ink'
              }`}
            >
              <span
                aria-hidden="true"
                className={`shrink-0 font-lingo-mono text-xs font-semibold tabular-nums ${
                  answeredHere ? 'text-lingo-accent' : 'text-lingo-muted'
                }`}
              >
                {answeredHere ? '✓' : `${index + 1}.`}
              </span>
              <span className="min-w-0 flex-1">{question}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
