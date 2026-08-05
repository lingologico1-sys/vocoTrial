import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PasswordGate from './PasswordGate';
import './index.css';

// The gate wraps App rather than living inside it so that App never mounts
// unauthenticated — nothing in it can fire a request before the check lands.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PasswordGate>
      <App />
    </PasswordGate>
  </StrictMode>,
);
