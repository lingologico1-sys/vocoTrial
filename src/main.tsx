import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Start from './start/Start';
import TutorBench from './tutor/TutorBench';
import Studio from './live/Studio';
import FaceKit from './facekit/FaceKit';
import Lessons from './lessons/Lessons';
import Eleve from './eleve/Eleve';
import PasswordGate from './PasswordGate';
import './index.css';

/**
 * Six pages, no router.
 *
 * public/_redirects already serves index.html for every path, so a path is all
 * another page needs — and a router would be a dependency, a bundle and an
 * abstraction to carry what a lookup does. Read once at startup: no page
 * navigates to another except by a plain link, which reloads.
 *
 * EVERY PAGE IS NAMED HERE, INCLUDING `/`. It used to be the fallback — an
 * unknown path silently rendered tutorBench, which meant a typo looked like a
 * working page rather than a wrong address. The root is now the start page and
 * tutorBench has a path of its own, so the fallback below means "we do not know
 * that address, here is everything" instead of "here is the busiest page in the
 * app, good luck".
 *
 * TWO NAMES CHANGED AND ARE NOT ALIASED. `/livetrial` became `/studio` and
 * `/consignes` became `/lessons`. Keeping the old paths working would keep two
 * names alive for one page, which is the confusion the rename existed to
 * remove; an old bookmark lands on the start page instead, where the new name
 * is listed with a sentence saying what it does. That is self-correcting in a
 * way a silent redirect is not.
 */
const PAGES: Record<string, () => JSX.Element> = {
  '/': Start,
  // Models and prompts. Off the path to a published session — see Start.tsx.
  '/tutorbench': TutorBench,
  '/facekit': FaceKit,
  // One lesson: questions, consigne, targets. Its own page rather than a panel
  // on tutorBench because a lesson is written every week rather than chosen
  // once a term, and because it has no business sharing a page with a live
  // socket. The stored object is still a `QuestionSheet` — see sheets.ts.
  '/lessons': Lessons,
  // Where a face, a lesson and a voice become one published session.
  '/studio': Studio,
  // The one page here that is not the workshop. See src/eleve/Eleve.tsx.
  '/eleve': Eleve,
};

const page = window.location.pathname.replace(/\/+$/, '').toLowerCase();
const Page = PAGES[page || '/'] ?? Start;

// The gate wraps the page rather than living inside it so that nothing mounts
// unauthenticated — nothing in either page can fire a request before the check
// lands.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PasswordGate>
      <Page />
    </PasswordGate>
  </StrictMode>,
);
