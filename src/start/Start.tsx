import { ClipboardPen, GraduationCap, Layers, Smile, SlidersHorizontal } from 'lucide-react';
import BuildBadge from '../BuildBadge';

/**
 * The front door.
 *
 * WHY THIS EXISTS. Workshop pages reachable only by typing their paths, two of
 * which — liveTrial and tutorBench, as they were called — read as synonyms to
 * anyone who had not used them. The renaming fixed half of that; this page is
 * the other half, because a name can only carry so much and a sentence
 * underneath carries the rest.
 *
 * THREE GROUPS, IN TIERS, which is now the organising idea rather than the
 * order the work happens in. The workshop is an administrator's: draw a face,
 * tune how it moves, publish the manners and the house profile that every
 * lesson is built from. /teach is a teacher's, and it is the only page that
 * hands anything to a student. /eleve is what a student gets. Reading top to
 * bottom is being told who each page is for, which is the question somebody
 * arriving here actually has.
 *
 * THE TEACHER'S PAGE IS LISTED FIRST DESPITE BEING SECOND IN THE TIERS,
 * because it is the one somebody opens weekly and the workshop is where they go
 * once a term. The tools are set below it rather than above.
 *
 * A NOTE ON WHO CAN SEE THIS. The site is one shared password, so a teacher who
 * lands on `/` finds every workshop page named and explained, and a student
 * would too. That is a door that was already unlocked — the README lists it
 * under Known edges — but this page holds it open. The tiers below are a
 * description of who each page is *for*, not an access control; the honest fix
 * is a real user store, which is worth building when there are users.
 */

interface Place {
  href: string;
  name: string;
  blurb: string;
  Icon: typeof Layers;
}

/** The workshop, in the order the work happens. */
const WORKSHOP: Place[] = [
  {
    href: '/facekit',
    name: 'faceKit',
    blurb:
      'A portrait in, a mouth and a pair of eyelids out. Draws the face the tutor wears and saves it to the shared library.',
    Icon: Smile,
  },
  {
    href: '/studio',
    name: 'studio',
    blurb:
      'Dress the tutor in a face, tune how it moves and how it takes turns, then save that as the house default and publish the manners teachers pick between.',
    Icon: Layers,
  },
  {
    href: '/tutorbench',
    name: 'tutorBench',
    blurb:
      'Off to one side: every model, every knob, and a prompt you write yourself. For comparing how the models behave and what they cost. Level scales are authored here.',
    Icon: SlidersHorizontal,
  },
];

function Card({ href, name, blurb, Icon }: Place) {
  return (
    <a
      href={href}
      className="group flex gap-4 rounded-xl border border-slate-800 px-5 py-4 transition-colors hover:border-slate-700 hover:bg-slate-900/60"
    >
      <Icon
        size={20}
        className="mt-0.5 shrink-0 text-slate-600 transition-colors group-hover:text-slate-400"
      />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold tracking-tight text-slate-100">{name}</h2>
          <span className="font-mono text-[11px] text-slate-600">{href}</span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-slate-500">{blurb}</p>
      </div>
    </a>
  );
}

export default function Start() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* No Return beside it: this is where Return goes. See ReturnButton.tsx. */}
      <BuildBadge look="workshop" />
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">vocoTrial</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            A voice tutor a student talks to, and the workshop that builds one.
          </p>
        </header>

        {/*
          First, and on its own, because it is the page somebody opens weekly.
          The workshop below is where they go once a term.
        */}
        <div>
          <p className="mb-2.5 text-xs uppercase tracking-wide text-slate-600">
            For teachers
          </p>
          <a
            href="/teach"
            className="group flex gap-4 rounded-xl border border-slate-700 bg-slate-900/40 px-5 py-4 transition-colors hover:border-slate-600 hover:bg-slate-900/70"
          >
            <ClipboardPen
              size={20}
              className="mt-0.5 shrink-0 text-slate-500 transition-colors group-hover:text-slate-300"
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h2 className="text-base font-semibold tracking-tight text-slate-100">teach</h2>
                <span className="font-mono text-[11px] text-slate-600">/teach</span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                Write a Voco Session — the questions, the consigne, the structures to listen for —
                dress the tutor in a face and a voice, then publish it and read the code out. The
                only page that hands anything to a student.
              </p>
            </div>
          </a>
        </div>

        <div>
          <p className="mb-2.5 text-xs uppercase tracking-wide text-slate-600">
            For administrators
          </p>
          <div className="flex flex-col gap-2.5">
            {WORKSHOP.map((place) => (
              <Card key={place.href} {...place} />
            ))}
          </div>
        </div>

        {/*
          Set apart rather than listed. See the header: this is what everything
          above produces, and an identical card would call it another tool.
        */}
        <div className="mt-2 border-t border-slate-800 pt-6">
          <p className="mb-2.5 text-xs uppercase tracking-wide text-slate-600">
            What the student gets
          </p>
          <a
            href="/eleve"
            className="group flex gap-4 rounded-xl border border-slate-800 bg-slate-900/30 px-5 py-4 transition-colors hover:border-slate-700 hover:bg-slate-900/60"
          >
            <GraduationCap
              size={20}
              className="mt-0.5 shrink-0 text-slate-600 transition-colors group-hover:text-slate-400"
            />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <h2 className="text-base font-semibold tracking-tight text-slate-100">élève</h2>
                <span className="font-mono text-[11px] text-slate-600">/eleve</span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-slate-500">
                The student&rsquo;s own page, and the only one they are meant to see. It authors
                nothing and offers no settings — a code gets them in, and it runs whatever was
                published under that code. In French throughout.
              </p>
            </div>
          </a>
        </div>

        <p className="mt-auto pt-6 text-[11px] leading-relaxed text-slate-600">
          Everything here is behind one shared password, including the student page — the tiers
          above say who each page is <em>for</em>, not who can reach it. Old links to{' '}
          <span className="font-mono">/livetrial</span>,{' '}
          <span className="font-mono">/consignes</span> and{' '}
          <span className="font-mono">/lessons</span> land back here — that last one is now{' '}
          <span className="font-mono">/teach</span>, and it publishes.
        </p>
      </div>
    </div>
  );
}
