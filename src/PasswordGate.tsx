import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { checkSession, login, setExpiredHandler } from './realtime/auth';

/**
 * The site password, in front of everything.
 *
 * This is presentation only. It hides the UI from a stranger, but it is not
 * what protects the account — functions/api/_middleware.ts refuses every
 * /api/* route without a valid cookie, so bypassing this component in devtools
 * gets you a dead app rather than someone else's API spend. Keep it that way:
 * anything this component gates must be gated server-side too.
 */
export default function PasswordGate({ children }: { children: React.ReactNode }) {
  // null while the first status check is in flight, so the form does not flash
  // in front of someone who is already signed in.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    checkSession()
      .then((state) => {
        if (cancelled) return;
        setAuthed(state.authed);
        setConfigured(state.configured);
      })
      .catch(() => {
        if (!cancelled) setAuthed(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Anything that meets a 401 mid-call drops the user back here.
  useEffect(() => {
    setExpiredHandler(() => {
      setAuthed(false);
      setError('That session expired. Enter the password again.');
    });
    return () => setExpiredHandler(null);
  }, []);

  useEffect(() => {
    if (authed === false) field.current?.focus();
  }, [authed]);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (busy || !password) return;

      setBusy(true);
      setError(null);
      const failure = await login(password);
      setBusy(false);

      if (failure) {
        setError(failure);
        // Clear on failure so a mistyped password is not silently resubmitted.
        setPassword('');
        field.current?.focus();
        return;
      }

      setPassword('');
      setAuthed(true);
    },
    [busy, password],
  );

  if (authed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-600">
        <Loader2 className="h-5 w-5 animate-spin" aria-label="Checking session" />
      </div>
    );
  }

  if (authed) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-slate-100">
      <form onSubmit={submit} className="w-full max-w-xs">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="rounded-full border border-slate-800 bg-slate-900 p-3">
            <Lock className="h-5 w-5 text-slate-400" />
          </span>
          <h1 className="text-lg font-semibold tracking-tight">vocoTrial</h1>
          <p className="text-sm text-slate-500">This site is private.</p>
        </div>

        {configured ? (
          <>
            <input
              ref={field}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              autoComplete="current-password"
              placeholder="Password"
              aria-label="Password"
              className="w-full rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm outline-none transition placeholder:text-slate-600 focus:border-sky-500 disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={busy || !password}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 transition hover:bg-sky-400 disabled:opacity-40"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? 'Checking…' : 'Enter'}
            </button>

            {error && (
              <p role="alert" className="mt-3 text-center text-sm text-rose-400">
                {error}
              </p>
            )}
          </>
        ) : (
          // Fail-closed needs an explanation, or a misconfigured deploy just
          // looks like a wrong password to whoever set it up.
          <p role="alert" className="text-center text-sm text-amber-400">
            No SITE_PASSWORD is set on this deployment, so nobody can sign in.
            Add it as a Secret in the Cloudflare Pages dashboard and redeploy.
          </p>
        )}
      </form>
    </div>
  );
}
