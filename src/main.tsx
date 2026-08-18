import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import TutorBench from './tutor/TutorBench';
import LiveTrial from './live/LiveTrial';
import FaceKit from './facekit/FaceKit';
import PasswordGate from './PasswordGate';
import './index.css';

/**
 * Three pages, no router.
 *
 * public/_redirects already serves index.html for every path, so a path is all
 * another page needs — and a router would be a dependency, a bundle and an
 * abstraction to carry what a lookup does. Read once at startup: no page
 * navigates to another except by a plain link, which reloads.
 */
const PAGES: Record<string, () => JSX.Element> = {
  '/livetrial': LiveTrial,
  '/facekit': FaceKit,
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
