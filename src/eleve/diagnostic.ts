import type { CallEvent, Turn } from '../live/useVoiceCall';
import { findL1 } from '../realtime/l1';
import { findLanguage } from '../realtime/languages';
import { findModel } from '../realtime/models';
import type { SessionReport } from '../realtime/report';
import type { PublishedSetup } from '../realtime/session';
import { SETTING_FIELDS, fieldsFor, type SessionSettings } from '../realtime/settings';
import { PROMPT_COMPOSER_VERSION, promptIsStale } from '../realtime/vocoSessions';

/**
 * One conversation, written out so it can be handed to somebody who was not in
 * the room.
 *
 * WHAT IT IS FOR. The student page has no console, no network tab and no
 * developer standing behind it — and the things that go wrong on it are things
 * you cannot reproduce by trying: the tutor asks a question twice, the closing
 * never comes, the greeting arrives in the wrong language. Those look identical
 * from the outside (a conversation that read oddly) and have completely
 * different causes, living in three different places — the composed prompt, the
 * turn-taking settings, and the order things actually happened in. So this
 * collects all three at once and hands them over as text.
 *
 * TEXT, NOT JSON, AND THAT IS THE WHOLE DESIGN. The reader is a person, or a
 * model reading over their shoulder — not a parser. A transcript with the tool
 * reports and the injected notes interleaved into it *at their real times* is
 * something you can read down once and see the fault in. The same facts in
 * three separate arrays have to be reassembled by hand before anything is
 * visible, and the reassembly is exactly the step nobody does.
 *
 * THE TIMELINE IS THE POINT and everything else is context for it. A tutor
 * asking the same question twice is a question turn followed by one of four
 * different things: an `interrupted`, meaning its first asking was talked over
 * and never heard; a learner turn that came back empty, meaning nothing was
 * transcribed so the tutor never saw an answer; a `complete` line, meaning the
 * tutor called its tool and was restarted into a turn it had already spoken; or
 * a `tool` line naming something this build does not implement, which is the
 * same restart arriving from a prompt published before the tools changed. Four
 * bugs, four fixes, and the transcript alone cannot tell them apart.
 *
 * THE FOURTH ONE IS WHY THE `tool` LINES EXIST AT ALL. They were added after a
 * real conversation where the tutor repeated every question and drifted off the
 * list, and the diagnostic taken from it showed doubled turns with nothing
 * beside them — because the calls causing the doubling were for a tool no
 * handler here recognised, and only recognised calls were being logged. A log
 * that records what it understood rather than what arrived is a log that goes
 * quiet in exactly the cases somebody opens it for.
 *
 * NOTHING IS REDACTED, INCLUDING THE PROMPT. This is taken deliberately, by a
 * gesture nobody finds by accident, for the person who published the lesson —
 * and a prompt with the interesting half cut out is the one thing guaranteed to
 * waste the round trip. Nothing here is anything the browser did not already
 * hold: no credentials, no cookies, no account.
 */

export interface DiagnosticInput {
  /** The published setup the page is running, or null on the code screen. */
  setup: PublishedSetup | null;
  /** What is in the code box, for the case where nothing opened. */
  typedCode: string;
  /** The last complaint the code box made, if any. */
  codeError: string;
  /** Which model the page dialled. */
  modelKey: string;
  /**
   * The settings object handed to the call, not a second derivation of it.
   *
   * The page builds this once and passes the same value to both, which is the
   * only way this can claim to report what was actually sent. Working it out
   * again here would be a second reading of the same rules, and a diagnostic
   * that quietly disagrees with the call it describes is worse than none.
   */
  settings: SessionSettings;
  /** The learner's own language, as the header's picker has it. */
  l1: string;

  // --- The call, taken field by field rather than as the whole hook: this
  // --- builds a string and has no business being able to hang one up.
  status: string;
  detail: string | null;
  turns: Turn[];
  events: CallEvent[];
  connectedAt: number | null;
  lastCallMs: number | null;
  complete: boolean;

  // --- What the page made of all of it.
  /** The cap the page is running, in minutes. Null when no setup is open. */
  capMinutes: number | null;
  /** Whether the page believes the list is finished. See Eleve.tsx. */
  lessonDone: boolean;
  report: SessionReport | null;
  reportError: string | null;
  reporting: boolean;
}

const RULE = '='.repeat(72);

function head(title: string): string {
  return `\n--- ${title} ${'-'.repeat(Math.max(3, 67 - title.length))}`;
}

/** Where a field's value starts, and so where a continuation of one resumes. */
const GUTTER = 18;

/** `name  value`, padded so a run of them reads as a column. */
function field(name: string, value: string | number | null | undefined): string {
  const shown = value === null || value === undefined || value === '' ? '—' : String(value);
  return `${name.padEnd(GUTTER)}${shown}`;
}

/**
 * More lines under a field, indented to sit in its value column.
 *
 * For the handful of findings that need a sentence rather than a value. Putting
 * that sentence *in* the value would be one 200-character line in a document
 * whose every other line fits in eighty — which wraps wherever the reader's
 * window happens to end and stops looking like the same document.
 */
function under(...lines: string[]): string[] {
  return lines.map((line) => `${' '.repeat(GUTTER)}${line}`);
}

/** `+M:SS.s` from the origin, which is whenever the account starts. */
function offset(at: number, origin: number): string {
  const ms = at - origin;
  const sign = ms < 0 ? '-' : '+';
  const total = Math.abs(ms);
  const minutes = Math.floor(total / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const tenths = Math.floor((total % 1000) / 100);
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

/** `M:SS` for a duration read as a length rather than as a moment. */
function length(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/**
 * How long ago, in the largest two units that say anything.
 *
 * NOT `length`, which is what this used and is why a lesson published yesterday
 * read as "1797:06 ago". Minutes and seconds are right for a conversation and
 * useless for anything older than an hour — and the two figures this is asked
 * for, how old a publish is and how long ago a call connected, routinely span
 * both scales. A duration somebody reads as a length keeps `length`.
 */
function age(ms: number): string {
  if (ms < 0) return 'in the future';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

const stamp = (at: number) => new Date(at).toISOString();

/** A list, one entry per line, indented — or a dash when there is nothing. */
function list(entries: string[] | undefined, bullet = (index: number) => `${index + 1}.`): string {
  if (!entries?.length) return '  —';
  return entries.map((entry, index) => `  ${bullet(index)} ${entry}`).join('\n');
}

/**
 * The turn-taking as it left the browser, and — just as loudly — what did not.
 *
 * ABSENT IS THE FINDING, more often than any value here is. settings.ts is
 * built on the difference between "somebody chose Google's default" and
 * "somebody chose the number that happens to be Google's default today", and a
 * tutor cutting in on a learner mid-clause is very often a `silenceDurationMs`
 * nobody ever set. A dump listing only the fields present would show that case
 * as a short block, which reads as nothing being wrong with it.
 *
 * Only the fields this model accepts are named either way, because a field the
 * model would reject is not a decision anybody made — see `applies`.
 */
function settingsBlock(settings: SessionSettings, modelKey: string): string {
  const model = findModel(modelKey);
  const applicable = model ? fieldsFor(model) : SETTING_FIELDS;
  const sent: string[] = [];
  const unsent: string[] = [];

  for (const setting of applicable) {
    const value = settings[setting.key];
    if (value === undefined) {
      unsent.push(setting.key);
      continue;
    }
    const unit = setting.kind === 'number' && setting.unit ? setting.unit : '';
    sent.push(`  ${setting.key.padEnd(20)}${String(value)}${unit}`);
  }

  return [
    field('Model', model ? `${modelKey} — ${model.label}` : `${modelKey} (unknown to this build)`),
    '',
    'Sent with the setup:',
    sent.length ? sent.join('\n') : '  — nothing; every field was left to the provider',
    '',
    'Left unsent, so the provider decides:',
    unsent.length ? `  ${unsent.join(', ')}` : '  — nothing',
  ].join('\n');
}

/**
 * The face profile the administrator published.
 *
 * Compact rather than a field per line, because it is background: it decides
 * how the face moves and has never yet been the cause of anything wrong with a
 * conversation. It is here so that "the face never blinked" does not need a
 * second round trip.
 */
function performanceBlock(setup: PublishedSetup): string {
  const maybe = (label: string, value: number | undefined) =>
    value === undefined ? '' : ` · ${label} ${value}`;

  return [
    `mouth ${setup.driver} · lookahead ${setup.lookaheadMs}ms · roundness ${setup.roundness}`,
    `motion ${setup.motion} · cadence ${setup.cadence}` +
      ` · tilt [${setup.tilt.join(', ') || 'none'}] roll ${setup.tiltRoll}` +
      maybe('settle', setup.tiltSettle) +
      maybe('chance', setup.tiltChance),
    `press [${setup.press.join(', ') || 'none'}] · brow lift ${setup.browLift}` +
      ` · brow blink ${setup.browBlink}` +
      maybe('brow flash', setup.browFlashChance),
    `listen nod ${setup.listenNod} · depth ${setup.nodDepth}` + maybe('chance', setup.nodChance),
  ].join('\n');
}

/**
 * The transcript and the events, merged and sorted by when they happened.
 *
 * ONE SEQUENCE AND NOT TWO LISTS. See the header: everything this file is for
 * lives in the interleaving. A turn is stamped at the moment its first words
 * were *heard* rather than when they arrived on the socket, so both sides sit
 * on one clock and a note that appears between two questions really did land
 * between them.
 *
 * The origin is the first thing that happened rather than the current call's
 * connection, because the account outlives a call and a second conversation is
 * very often explained by the first. A reader wanting only the current call
 * finds its `dialled` line and reads down from there.
 */
function timeline(turns: Turn[], events: CallEvent[]): string {
  interface Entry {
    at: number;
    label: string;
    text: string;
  }

  const entries: Entry[] = [
    ...events.map((event) => ({ at: event.at, label: `· ${event.kind}`, text: event.detail })),
    ...turns.map((turn) => ({
      at: turn.at,
      label: turn.role === 'agent' ? 'TUTOR' : 'LEARNER',
      text:
        (turn.text.replace(/\s+/g, ' ').trim() || '(nothing was transcribed)') +
        (turn.done
          ? turn.endedAt
            ? `   [${length(turn.endedAt - turn.at)} of turn]`
            : ''
          : '   [still open when this was taken]'),
    })),
  ];

  if (!entries.length) return '  — nothing has happened yet.';

  entries.sort((first, second) => first.at - second.at);
  const origin = entries[0].at;

  /*
   * Wide enough for the longest label there is, which is the thirteen of
   * `· interrupted`. A column the longest entry overflows is a column that
   * collides with its own text on exactly the lines somebody opened this for.
   */
  return entries
    .map(
      (entry) => `${offset(entry.at, origin).padStart(9)}  ${entry.label.padEnd(14)}${entry.text}`,
    )
    .join('\n');
}

/** What the page is showing about the reading, in one line. */
function reportLine(input: DiagnosticInput): string {
  if (input.reporting) return 'being written now';
  if (input.reportError) return `failed — ${input.reportError}`;
  if (!input.report) return 'none asked for yet';
  const { band, confidence } = input.report.diagnosis;
  return `delivered — band ${band}, confidence ${confidence}`;
}

export function buildDiagnostic(input: DiagnosticInput): string {
  const { setup } = input;
  const now = Date.now();
  const language = setup ? findLanguage(setup.language) : undefined;
  const learner = findL1(input.l1);

  const lines: string[] = [];
  const put = (...text: string[]) => lines.push(...text);

  put(RULE, 'VOCO DIAGNOSTIC — the student page, /eleve', RULE);
  put(field('Taken', `${stamp(now)}  (${Intl.DateTimeFormat().resolvedOptions().timeZone})`));
  put(field('Address', window.location.href));
  put(field('Browser', navigator.userAgent));
  put(
    field(
      'Window',
      `${window.innerWidth}×${window.innerHeight} at ${window.devicePixelRatio}× device pixels`,
    ),
  );
  put(field("Learner's L1", learner ? `${learner.code} — ${learner.name}` : input.l1));

  put(head('THE LESSON'));
  if (!setup) {
    put('No setup is open — the page is showing the code box.');
    put(field('In the box', input.typedCode || '(empty)'));
    put(field('Last answer', input.codeError || 'nothing tried yet'));
  } else {
    put(field('Code', setup.code));
    put(field('Label', setup.label));
    put(
      field(
        'From',
        setup.vocoSessionName ? `${setup.vocoSessionName} (${setup.vocoSessionId ?? '?'})` : null,
      ),
    );
    put(field('Published', `${stamp(setup.updatedAt)}  (${age(now - setup.updatedAt)})`));
    /*
     * The line that answers "why is this tutor behaving like that" before
     * anybody reads the timeline.
     *
     * A published prompt is frozen and the build that runs it is not, so a code
     * handed out before a protocol change is a conversation that will go wrong
     * in ways nothing else here explains — the questions repeat, the tutor
     * wanders off the list, and every other section of this document looks
     * correct. Directly under the publish date because the date is the other
     * half of the same thought: it is the age of the snapshot that matters, not
     * the age of the lesson.
     */
    const stale = promptIsStale(setup.composerVersion);
    put(
      field(
        'Prompt protocol',
        stale
          ? `v${setup.composerVersion ?? '?'} — STALE. This build composes v${PROMPT_COMPOSER_VERSION}.`
          : `v${setup.composerVersion} — current`,
      ),
    );
    if (stale) {
      put(
        ...under(
          'Publish this lesson again and hand out the new code.',
          'A prompt composed against an older protocol asks the tutor',
          'for tools this build no longer declares. It calls them, every',
          'call is answered because an unanswered one leaves a tutor',
          'silent, and each answer restarts it into the turn it has just',
          'spoken — which is heard as the same question twice, and as the',
          'tutor wandering off the list. Look for `tool` lines below',
          'saying NOT A TOOL THIS PAGE KNOWS.',
        ),
      );
    }
    put(field('Language', language ? `${setup.language} — ${language.label}` : setup.language));
    put(field('Voice', setup.voice || "the provider's own default"));
    put(field('Face', setup.faceId ?? "the deployment's own"));
    put(field('Evaluator', setup.evaluatorId));
    put(
      field(
        'Cap',
        input.capMinutes === null
          ? null
          : `${input.capMinutes} min` +
              (setup.capMinutes !== undefined
                ? ''
                : setup.lengthMinutes !== undefined
                  ? `  (from the old lengthMinutes: ${setup.lengthMinutes})`
                  : '  (the default — the setup names none)'),
      ),
    );

    put(
      '',
      `Questions (${setup.questions?.length ?? 0}) — the tutor has these too, inside the prompt:`,
    );
    put(list(setup.questions));
    put('', 'Targets — steered towards, never said aloud, and what the report checks:');
    put(list(setup.targets, () => '-'));
    put('', 'Consigne — shown to the student, never sent to the tutor:');
    put(setup.brief ? `  ${setup.brief.replace(/\n/g, '\n  ')}` : '  —');
  }

  put(head('WHAT WAS SENT TO THE MODEL'));
  put(settingsBlock(input.settings, input.modelKey));

  if (setup) {
    put(head('THE FACE, AS THE HOUSE PROFILE HAS IT'));
    put(performanceBlock(setup));
  }

  put(head('THE CALL'));
  put(field('Status', input.detail ? `${input.status} — ${input.detail}` : input.status));
  put(
    field(
      'Connected',
      input.connectedAt === null
        ? 'not live'
        : `${stamp(input.connectedAt)}  (${age(now - input.connectedAt)}` +
          `, so ${length(now - input.connectedAt)} of call)`,
    ),
  );
  put(
    field('Last call ran', input.lastCallMs === null ? 'none has finished yet' : length(input.lastCallMs)),
  );
  put(
    field(
      'List finished',
      input.complete
        ? `yes — the tutor said so through its tool, once, at the end of ${setup?.questions?.length ?? 0}`
        : `not reported — the tutor has not said it reached the end of ${setup?.questions?.length ?? 0}`,
    ),
  );
  put(field('Page says done', input.lessonDone ? 'yes — a closing note is due or sent' : 'no'));
  put(field('Evaluation', reportLine(input)));

  put(head('THE TIMELINE'));
  put(
    'Everything on one clock, from the first thing that happened. TUTOR and LEARNER',
    'lines are the transcript as it was heard; the `·` lines are what the call did',
    'around it. The transcript is cleared when a new call is dialled and the events',
    'are not — so anything above the last `dialled` belongs to an earlier call.',
    '',
  );
  put(timeline(input.turns, input.events));

  put(head('THE COMPOSED PROMPT'));
  if (!setup) {
    put('  — no setup is open.');
  } else {
    put(
      `${setup.instructions.length} characters, exactly as published and exactly as sent.`,
      'The style, the persona wrap and the lesson block, already composed — a student',
      'browser never resolves any of the three.',
      '',
      setup.instructions,
    );
  }

  put('', RULE, 'END', RULE);
  return lines.join('\n');
}
