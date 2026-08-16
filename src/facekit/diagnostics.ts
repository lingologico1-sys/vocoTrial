/**
 * A running account of what every generation is actually doing, and when.
 *
 * The page already showed *that* a slot was busy, and even which attempt it was
 * on, but a button wearing an ellipsis for four minutes cannot tell you whether
 * the provider is slow, refusing, or out of quota — nor that most of those four
 * minutes were this app's own retry schedule sleeping on purpose. That is the
 * question this answers: a per-run timeline, split into the phases that can
 * each be slow for a different reason.
 *
 * It lives outside React because generate.ts is where the facts are and
 * generate.ts is not a component. A module-level log with subscribers is the
 * smallest thing that lets both sides talk without threading a callback through
 * every signature.
 *
 * Deliberately in-memory only. It is a stethoscope, not a record: a reload is
 * the right way to clear it, and nothing here should outlive the session that
 * can still act on it.
 */

/**
 * Where a run's time is going.
 *
 * Named separately because they fail differently and the distinction is the
 * whole point of the panel. `preparing` and `stitching` are this machine's own
 * canvas work; `requesting` is the provider; `waiting` is the retry schedule
 * sleeping deliberately, which looks identical from the outside and is the one
 * most likely to be mistaken for a hang.
 */
export type Phase = 'preparing' | 'requesting' | 'waiting' | 'stitching' | 'finished';

export interface RunAttempt {
  n: number;
  startedAt: number;
  endedAt?: number;
  /** Absent when the attempt succeeded. This app's own edge status. */
  status?: number;
  /** What the provider answered, when it differs from the status above. */
  upstreamStatus?: number;
  /** The provider's own classification, when it gave one. */
  reason?: string;
  /** The wait that followed this attempt, when another one was scheduled. */
  waitMs?: number;
}

export interface Run {
  id: number;
  /** The slot this was for — "Rest", "Left eye closed", "Neutral base". */
  label: string;
  modelLabel: string;
  startedAt: number;
  endedAt?: number;
  phase: Phase;
  /** When the current phase began, so elapsed-in-phase can be shown live. */
  phaseAt: number;
  /** Set only while waiting: when the sleep is due to end. */
  waitUntil?: number;
  attempts: RunAttempt[];
  outcome?: 'ok' | 'failed';
  error?: string;
  usd?: number;
  prepareMs?: number;
  stitchMs?: number;
  /** Time inside provider calls, waits excluded. */
  requestMs: number;
  /** Time asleep between attempts. */
  waitMs: number;
}

let runs: Run[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

/**
 * How many runs are kept.
 *
 * A full kit is nine slots against two models with retries, so a session can
 * reach a few dozen legitimately. The cap is only there to stop a page left
 * open all afternoon from growing without bound.
 */
const KEEP = 200;

function changed() {
  // A fresh array each time, because useSyncExternalStore compares the
  // snapshot by identity and the runs themselves are mutated in place.
  runs = runs.slice(0, KEEP);
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function snapshot(): Run[] {
  return runs;
}

export function clearRuns() {
  runs = [];
  changed();
}

/** The handle generate.ts writes to. Newest run first, so the panel reads top-down. */
export interface RunHandle {
  phase(next: Phase): void;
  attemptStarted(n: number): void;
  attemptFailed(
    status: number | undefined,
    reason: string | undefined,
    upstreamStatus?: number,
  ): void;
  /** Announces the sleep before the next attempt, so it can be counted down. */
  waitingFor(ms: number): void;
  succeeded(usd: number): void;
  failed(message: string): void;
}

export function beginRun(label: string, modelLabel: string): RunHandle {
  const now = Date.now();
  const run: Run = {
    id: nextId++,
    label,
    modelLabel,
    startedAt: now,
    phase: 'preparing',
    phaseAt: now,
    attempts: [],
    requestMs: 0,
    waitMs: 0,
  };
  runs = [run, ...runs];
  changed();

  const current = () => run.attempts[run.attempts.length - 1];

  /** Closes off the phase that is ending and charges its time to the right total. */
  const enter = (next: Phase) => {
    const at = Date.now();
    const spent = at - run.phaseAt;
    if (run.phase === 'preparing') run.prepareMs = (run.prepareMs ?? 0) + spent;
    if (run.phase === 'stitching') run.stitchMs = (run.stitchMs ?? 0) + spent;
    run.phase = next;
    run.phaseAt = at;
    if (next !== 'waiting') run.waitUntil = undefined;
  };

  return {
    phase(next) {
      enter(next);
      changed();
    },
    attemptStarted(n) {
      enter('requesting');
      run.attempts.push({ n, startedAt: Date.now() });
      changed();
    },
    attemptFailed(status, reason, upstreamStatus) {
      const attempt = current();
      if (attempt) {
        attempt.endedAt = Date.now();
        attempt.status = status;
        attempt.upstreamStatus = upstreamStatus === status ? undefined : upstreamStatus;
        attempt.reason = reason;
        run.requestMs += attempt.endedAt - attempt.startedAt;
      }
      changed();
    },
    waitingFor(ms) {
      const attempt = current();
      if (attempt) attempt.waitMs = ms;
      run.waitMs += ms;
      enter('waiting');
      run.waitUntil = Date.now() + ms;
      changed();
    },
    succeeded(usd) {
      const attempt = current();
      if (attempt && !attempt.endedAt) {
        attempt.endedAt = Date.now();
        run.requestMs += attempt.endedAt - attempt.startedAt;
      }
      enter('finished');
      run.endedAt = Date.now();
      run.outcome = 'ok';
      run.usd = usd;
      changed();
    },
    failed(message) {
      const attempt = current();
      if (attempt && !attempt.endedAt) {
        attempt.endedAt = Date.now();
        run.requestMs += attempt.endedAt - attempt.startedAt;
      }
      enter('finished');
      run.endedAt = Date.now();
      run.outcome = 'failed';
      run.error = message;
      changed();
    },
  };
}

function seconds(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const whole = Math.round(ms / 1000);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
}

export { seconds as formatMs };

/**
 * The whole log as plain text, for pasting somewhere it can be read.
 *
 * A report rather than a dump: the point of copying this is to hand someone
 * else the shape of the problem, and JSON of the same facts would make them do
 * the arithmetic that the panel is already doing on screen.
 */
export function report(now = Date.now()): string {
  const lines: string[] = [];
  const finished = runs.filter((run) => run.endedAt);
  const failed = finished.filter((run) => run.outcome === 'failed');
  const retried = finished.filter((run) => run.attempts.length > 1);
  const totalWait = finished.reduce((sum, run) => sum + run.waitMs, 0);

  lines.push(`faceKit generation log — ${new Date(now).toISOString()}`);
  lines.push(
    `${runs.length} run(s): ${finished.length - failed.length} ok, ${failed.length} failed, ` +
      `${runs.length - finished.length} in flight · ${retried.length} needed a retry · ` +
      `${seconds(totalWait)} spent in scheduled waits`,
  );
  lines.push('');

  // Oldest first here, unlike on screen: read as a transcript, the order things
  // happened in is what makes a burst of 429s legible as one burst.
  for (const run of [...runs].reverse()) {
    const elapsed = (run.endedAt ?? now) - run.startedAt;
    const state = run.endedAt ? (run.outcome ?? 'done') : `in flight (${run.phase})`;
    lines.push(
      `[${new Date(run.startedAt).toISOString().slice(11, 19)}] ${run.label} · ${run.modelLabel} — ` +
        `${state} after ${seconds(elapsed)}`,
    );
    for (const attempt of run.attempts) {
      const took = (attempt.endedAt ?? now) - attempt.startedAt;
      const verdict = attempt.endedAt
        ? attempt.status
          ? `failed ${attempt.status}` +
            (attempt.upstreamStatus ? ` (provider ${attempt.upstreamStatus})` : '') +
            (attempt.reason ? ` ${attempt.reason}` : '')
          : 'ok'
        : 'still open';
      const then = attempt.waitMs ? `, then waited ${seconds(attempt.waitMs)}` : '';
      lines.push(`    attempt ${attempt.n}: ${seconds(took)} — ${verdict}${then}`);
    }
    const parts: string[] = [];
    if (run.prepareMs !== undefined) parts.push(`prepare ${seconds(run.prepareMs)}`);
    parts.push(`request ${seconds(run.requestMs)}`);
    if (run.waitMs) parts.push(`waiting ${seconds(run.waitMs)}`);
    if (run.stitchMs !== undefined) parts.push(`stitch ${seconds(run.stitchMs)}`);
    lines.push(`    ${parts.join(' · ')}`);
    if (run.error) lines.push(`    error: ${run.error}`);
  }

  return lines.join('\n');
}
