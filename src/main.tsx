import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Start from './start/Start';
import TutorBench from './tutor/TutorBench';
import Studio from './live/Studio';
import FaceKit from './facekit/FaceKit';
import SituationMaker from './facekit/SituationMaker';
import Teach from './teach/Teach';
import LipSync from './lipsync/LipSync';
import Takes from './lipsync/Takes';
import Eleve from './eleve/Eleve';
import Watch from './watch/Watch';
import PasswordGate from './PasswordGate';
import './index.css';

/**
 * Seven pages, no router.
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
  // The same authoring flow as /facekit, for a speaker shown in a setting
  // rather than a head on its own — a gentleman at a desk, for a listening
  // exercise where where he is doing it is part of what is being understood.
  // One component under both; see SituationMaker.tsx for why it is still a
  // separate page.
  '/situationmaker': SituationMaker,
  // The teacher's page. One Voco Session — questions, consigne, and the
  // tutor that asks them — written here and handed out from here under a
  // code. It is not a workshop page and does not look like one; see Teach.tsx.
  '/teach': Teach,
  // Tuning, and the two things an administrator publishes for every teacher:
  // a tutor style and the house performance profile. It no longer publishes to
  // students — that moved to /teach, where the person handing out a lesson is.
  '/studio': Studio,
  // A recording plus the marks a forced aligner made for it. The only page here
  // that does not play live audio, which is the whole of why it exists — see
  // src/lipsync/LipSync.tsx.
  '/lipsync': LipSync,
  // The packages deliberately kept from /lipsync. This is a separate page because
  // authoring one take and browsing every previous take are different jobs.
  '/lipsync/takes': Takes,
  // The one page here that is not the workshop. See src/eleve/Eleve.tsx.
  '/eleve': Eleve,
};

/**
 * The pages that are not behind the site password.
 *
 * One entry, and it should stay hard to add a second: a page here can be opened by
 * anyone with its address, so the only thing that belongs is a page carrying its own
 * credential. /watch carries a share token — see src/lipsync/shared.ts — which opens
 * exactly one take and one face and reaches no route that spends money. Everything the
 * page needs comes from /api/share/*, the matching exemption in
 * functions/api/_middleware.ts.
 */
const OPEN_PAGES: Record<string, () => JSX.Element> = {
  '/watch': Watch,
};

const page = window.location.pathname.replace(/\/+$/, '').toLowerCase();
const Open = OPEN_PAGES[page];
const Page = PAGES[page || '/'] ?? Start;

// The gate wraps the page rather than living inside it so that nothing mounts
// unauthenticated — nothing in either page can fire a request before the check
// lands. An open page skips the gate entirely rather than being rendered inside
// a gate that waves it through: a gate with an exception in it is a gate whose
// next reader has to work out whether the exception still holds.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {Open ? (
      <Open />
    ) : (
      <PasswordGate>
        <Page />
      </PasswordGate>
    )}
  </StrictMode>,
);
