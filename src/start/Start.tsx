import { GraduationCap, Layers, ListChecks, Smile, SlidersHorizontal } from 'lucide-react';

/**
 * The front door.
 *
 * WHY THIS EXISTS. Four workshop pages reachable only by typing their paths,
 * two of which — liveTrial and tutorBench, as they were called — read as
 * synonyms to anyone who had not used them. The renaming fixed half of that;
 * this page is the other half, because a name can only carry so much and a
 * sentence underneath carries the rest.
 *
 * ORDERED AS THE WORK IS DONE, not alphabetically and not by importance. A
 * face, then a lesson, then the studio that puts them together and publishes —
 * so reading the page top to bottom is being told how the thing is used. The
 * bench sits after them because it answers a different question (which model,
 * which prompt) and is not on the path to a published session at all.
 *
 * THE STUDENT PAGE IS SET APART, below a rule, described rather than sold. It
 * is not a fifth tool: it is what the other four produce, and listing it as a
 * peer would say the opposite. It is here at all because checking your own work
 * means opening it, and hiding it would only mean typing the path.
 *
 * A NOTE ON WHO CAN SEE THIS. The site is one shared password, so a student who
 * lands on `/` now finds every workshop page named and explained where before
 * they had to guess a URL. That is a door that was already unlocked — the
 * README lists it under Known edges — but this page holds it open. The honest
 * fix is a real user store, which is worth building when there are users.
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
    href: '/lessons',
    name: 'lessons',
    blurb:
      'One lesson: the questions to work through, the consigne the student reads, and the structures you want to hear them use.',
    Icon: ListChecks,
  },
  {
    href: '/studio',
    name: 'studio',
    blurb:
      'Where it all comes together. Dress the tutor in a face and a voice, tune how it moves, pick a lesson and a scale — then publish it to the students.',
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
      <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-12">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">vocoTrial</h1>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            A voice tutor a student talks to, and the workshop that builds one.
          </p>
        </header>

        <div className="flex flex-col gap-2.5">
          {WORKSHOP.map((place) => (
            <Card key={place.href} {...place} />
          ))}
        </div>

        {/*
          Set apart rather than listed. See the header: this is what the four
          above produce, and a fifth identical card would call it a fifth tool.
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
                nothing and offers no settings — it runs whatever was last published from the
                studio, and it is in French throughout.
              </p>
            </div>
          </a>
        </div>

        <p className="mt-auto pt-6 text-[11px] leading-relaxed text-slate-600">
          Everything here is behind one shared password, including the student page. Old links to{' '}
          <span className="font-mono">/livetrial</span> and{' '}
          <span className="font-mono">/consignes</span> land back here — those pages are now{' '}
          <span className="font-mono">/studio</span> and{' '}
          <span className="font-mono">/lessons</span>.
        </p>
      </div>
    </div>
  );
}
