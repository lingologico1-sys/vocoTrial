import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import TutorBench from './tutor/TutorBench';
import LiveTrial from './live/LiveTrial';
import FaceKit from './facekit/FaceKit';
import Sheets from './sheets/Sheets';
import Eleve from './eleve/Eleve';
import PasswordGate from './PasswordGate';
import './index.css';

/**
 * Four pages, no router.
 *
 * public/_redirects already serves index.html for every path, so a path is all
 * another page needs — and a router would be a dependency, a bundle and an
 * abstraction to carry what a lookup does. Read once at startup: no page
 * navigates to another except by a plain link, which reloads.
 */
const PAGES: Record<string, () => JSX.Element> = {
  '/livetrial': LiveTrial,
  '/facekit': FaceKit,
  // Question sheets. Its own page rather than a panel on tutorBench because a
  // sheet is written every lesson rather than chosen once a term, and because
  // it has no business sharing a page with a live socket. See src/sheets/.
  '/consignes': Sheets,
  // The one page here that is not the workshop. See src/eleve/Eleve.tsx.
  '/eleve': Eleve,
};

const page = window.location.pathname.replace(/\/+$/, '').toLowerCase();
const Page = PAGES[page] ?? TutorBench;

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
