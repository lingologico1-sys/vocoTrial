import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  clearRuns,
  formatMs,
  report,
  snapshot,
  subscribe,
  type Run,
} from './diagnostics';

/**
 * The generation log, as a drawer at the foot of the page.
 *
 * Closed by default and deliberately plain: it is not part of the work, it is
 * what you open when the work is taking longer than it should. What it has to
 * settle is a single question the busy ellipsis could not — whether a slot that
 * has been spinning for two minutes is being held up by the provider, by a
 * refusal, or by this app's own retry schedule sleeping between attempts, which
 * is by far the largest of the three when a quota is spent and the only one
 * that looks like nothing is happening.
 */

/**
 * How often the open panel redraws while anything is in flight.
 *
 * Half a second: fast enough that a countdown reads as a countdown, slow enough
 * that it costs nothing next to the canvas work going on beside it. Runs
 * announce their own changes, so this exists only for the elapsed figures,
 * which change with the clock rather than with the run.
 */
const TICK_MS = 500;

function phaseWord(run: Run, now: number): string {
  if (run.endedAt) return run.outcome === 'ok' ? 'ok' : 'failed';
  if (run.phase === 'waiting' && run.waitUntil) {
    const left = Math.max(0, run.waitUntil - now);
    return `waiting ${formatMs(left)} before attempt ${run.attempts.length + 1}`;
  }
  if (run.phase === 'requesting') return `attempt ${run.attempts.length} in flight`;
  return run.phase;
}

function tone(run: Run): string {
  if (!run.endedAt) return run.phase === 'waiting' ? 'text-amber-400' : 'text-sky-400';
  return run.outcome === 'ok' ? 'text-emerald-400' : 'text-rose-400';
}

export default function Diagnostics() {
  const runs = useSyncExternalStore(subscribe, snapshot);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  const live = runs.filter((run) => !run.endedAt).length;

  // Only while there is something whose elapsed time is still moving. A panel
  // of finished runs is a static table and does not need a timer behind it.
  useEffect(() => {
    if (!open || live === 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [open, live]);

  const copy = async () => {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access is refused outright in some contexts, and a silent
      // no-op there would be the worst outcome — the whole point of the button
      // is handing this text to someone else. A textarea and execCommand still
      // work where the async API does not.
      const holder = document.createElement('textarea');
      holder.value = text;
      holder.style.position = 'fixed';
      holder.style.opacity = '0';
      document.body.appendChild(holder);
      holder.select();
      document.execCommand('copy');
      holder.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const finished = runs.filter((run) => run.endedAt);
  const failed = finished.filter((run) => run.outcome === 'failed').length;
  const retried = finished.filter((run) => run.attempts.length > 1).length;
  const waited = finished.reduce((sum, run) => sum + run.waitMs, 0);

  return (
    <section className="border-t border-slate-800 pt-4">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 text-left text-sm text-slate-400 hover:text-slate-200"
      >
        <span className="text-xs text-slate-600">{open ? '▾' : '▸'}</span>
        <span>Diagnostics</span>
        <span className="text-xs text-slate-600">
          {runs.length === 0
            ? 'nothing generated yet'
            : `${runs.length} run${runs.length === 1 ? '' : 's'}` +
              (live ? ` · ${live} in flight` : '') +
              (failed ? ` · ${failed} failed` : '')}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copy()}
              className="rounded-md border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500"
            >
              {copied ? 'Copied' : 'Copy log'}
            </button>
            <button
              type="button"
              onClick={clearRuns}
              className="rounded-md border border-slate-800 px-2 py-1 text-[11px] text-slate-500 hover:border-slate-600"
            >
              Clear
            </button>
            {finished.length > 0 && (
              <p className="text-[11px] text-slate-500">
                {retried} of {finished.length} finished runs needed a retry · {formatMs(waited)}{' '}
                spent in scheduled waits
              </p>
            )}
          </div>

          {runs.length === 0 ? (
            <p className="text-xs text-slate-600">
              Every generation records its phases here — the local canvas work, the provider call,
              and the waits between retries.
            </p>
          ) : (
            <ul className="space-y-2">
              {runs.map((run) => {
                const elapsed = (run.endedAt ?? now) - run.startedAt;
                return (
                  <li
                    key={run.id}
                    className="rounded-lg border border-slate-800 px-3 py-2 text-[11px] text-slate-400"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-slate-200">{run.label}</span>
                      <span className="text-slate-600">{run.modelLabel}</span>
                      <span className={tone(run)}>{phaseWord(run, now)}</span>
                      <span className="ml-auto tabular-nums text-slate-500">
                        {formatMs(elapsed)}
                      </span>
                    </div>

                    <div className="mt-1 space-y-0.5 text-slate-500">
                      {run.attempts.map((attempt) => {
                        const took = (attempt.endedAt ?? now) - attempt.startedAt;
                        return (
                          <p key={attempt.n} className="tabular-nums">
                            attempt {attempt.n} · {formatMs(took)} ·{' '}
                            {attempt.endedAt ? (
                              attempt.status ? (
                                <span className="text-rose-400">
                                  {attempt.status}
                                  {attempt.upstreamStatus
                                    ? ` (provider ${attempt.upstreamStatus})`
                                    : ''}
                                  {attempt.reason ? ` ${attempt.reason}` : ''}
                                </span>
                              ) : (
                                <span className="text-emerald-500">image returned</span>
                              )
                            ) : (
                              <span className="text-sky-400">open</span>
                            )}
                            {attempt.waitMs ? ` · then waited ${formatMs(attempt.waitMs)}` : ''}
                          </p>
                        );
                      })}
                    </div>

                    <p className="mt-1 tabular-nums text-slate-600">
                      {run.prepareMs !== undefined && `prepare ${formatMs(run.prepareMs)} · `}
                      request {formatMs(run.requestMs)}
                      {run.waitMs > 0 && ` · waiting ${formatMs(run.waitMs)}`}
                      {run.stitchMs !== undefined && ` · stitch ${formatMs(run.stitchMs)}`}
                    </p>

                    {run.error && <p className="mt-1 text-rose-300">{run.error}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
