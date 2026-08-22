import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Start from './start/Start';
import TutorBench from './tutor/TutorBench';
import Studio from './live/Studio';
import FaceKit from './facekit/FaceKit';
import Teach from './teach/Teach';
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
 * NAMES CHANGE HERE AND ARE NOT ALIASED. `/livetrial` became `/studio`,
 * `/consignes` became `/lessons`, and `/lessons` has now become `/teach` —
 * which is a bigger change than a rename, since the page absorbed publishing
 * on the way. Keeping an old path working would keep two names alive for one
 * page, which is the confusion each rename existed to remove; an old bookmark
 * lands on the start page instead, where the new name is listed with a
 * sentence saying what it does. That is self-correcting in a way a silent
 * redirect is not.
 */
const PAGES: Record<string, () => JSX.Element> = {
  '/': Start,
  // Models and prompts. Off the path to a published session — see Start.tsx.
  '/tutorbench': TutorBench,
  '/facekit': FaceKit,
  // The teacher's page. One Voco Session — questions, consigne, and the
  // tutor that asks them — written here and handed out from here under a
  // code. It is not a workshop page and does not look like one; see Teach.tsx.
  '/teach': Teach,
  // Tuning, and the two things an administrator publishes for every teacher:
  // a tutor style and the house performance profile. It no longer publishes to
  // students — that moved to /teach, where the person handing out a lesson is.
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
