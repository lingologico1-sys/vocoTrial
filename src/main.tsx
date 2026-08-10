import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import LiveTrial from './live/LiveTrial';
import PasswordGate from './PasswordGate';
import './index.css';

/**
 * Two pages, no router.
 *
 * public/_redirects already serves index.html for every path, so a path is all
 * a second page needs — and a router would be a dependency, a bundle and an
 * abstraction to carry one comparison. Read once at startup: neither page
 * navigates to the other except by a plain link, which reloads.
 */
const page = window.location.pathname.replace(/\/+$/, '').toLowerCase();
const Page = page === '/livetrial' ? LiveTrial : App;

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
