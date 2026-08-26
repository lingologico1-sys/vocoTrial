import type { CallEvent, Turn } from '../live/useVoiceCall';
import {
  AUDIO_RATES_VERIFIED_ON,
  estimateCost,
  formatDuration,
  formatTokens,
  projectHour,
  RATES_VERIFIED_ON,
  speakingTime,
  totalTokens,
  type MarkingCost,
  type UsageTotals,
} from '../realtime/cost';
import type { AdvancedReport } from '../realtime/oralRubric';
import { findL1 } from '../realtime/l1';
import { findLanguage } from '../realtime/languages';
import { findModel } from '../realtime/models';
import type { SessionReport } from '../realtime/report';
import type { PublishedSetup } from '../realtime/session';
import { SETTING_FIELDS, fieldsFor, type SessionSettings } from '../realtime/settings';
import { composeTutorPrompt } from '../realtime/tutorPrompt';
import { defaultInstructions } from '../realtime/instructions';

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
 * transcribed so the tutor never saw an answer; a `tool` line, meaning the
 * tutor reported its progress and was restarted into a turn it had already
 * spoken, which is what happens on a surface that ignores `NON_BLOCKING`; or a
 * `progress` line saying a report was refused, meaning the tutor believes it is
 * somewhere the page does not. Four bugs, four fixes, and the transcript alone
 * cannot tell them apart.
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
  /**
   * Which questions the page counted as answered, in the order it counted them.
   *
   * NOT WHAT THE TUTOR REPORTED — that is in the timeline, as `progress` lines,
   * including the reports that were refused and why. Reading the two together
   * is what separates a tutor that has lost its place from a learner who has
   * gone quiet, and they used to be the same single fact. See useVoiceCall.
   */
  answered: number[];
  /** Provider-reported token counts for the last call. See VoiceCall.usage. */
  usage: UsageTotals;

  // --- What the page made of all of it.
  /** The cap the page is running, in minutes. Null when no setup is open. */
  capMinutes: number | null;
  /** Whether the page believes the list is finished. See Eleve.tsx. */
  lessonDone: boolean;
  report: SessionReport | null;
  /** The advanced marker's result, when the teacher published one. */
  advanced: AdvancedReport | null;
  /** What the marking call cost, or null if none has been made. */
  markingCost: MarkingCost | null;
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
    // Both halves or neither, because either one alone is unreadable: a hold
    // with no gap beside it looks like a smile that never comes back, and a gap
    // with no hold looks like one that never leaves.
    `smile` + maybe('hold', setup.smileHold) + maybe('gap', setup.smileGap),
  ].join('\n');
}

/**
 * What of the worn face's persona actually reached the tutor.
 *
 * IT SAYS HOW MUCH, NOT JUST WHO. This line read "the name and one sentence
 * reach the tutor" for as long as the composer cut the biography down, and it
 * was the only place that fact was written down anywhere a teacher could see
 * it — faceKit invites a hundred and fifty words and said nothing about what
 * became of them. The composer sends the whole paragraph now, so the character
 * count is what tells you the paragraph you wrote is the paragraph that went:
 * a face whose background reads thin in a call is either a short bio or a
 * tutor ignoring it, and the number separates those two before anyone starts
 * rewriting a prompt over it. The full text is in the composed prompt below.
 *
 * A name with no paragraph and a paragraph with no name are both real states —
 * see `hasPersona` — so neither is reported as "none stored".
 */
function personaLine(persona: PublishedSetup['persona']): string {
  const name = persona?.fullName?.trim() ?? '';
  const bio = persona?.bio?.trim() ?? '';
  if (!name && !bio) return 'none stored';

  const background = bio
    ? `all ${bio.length} characters of the background reach the tutor`
    : 'no background stored — the name is all the tutor gets';

  return `${name || 'unnamed'} — ${background}`;
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
  /*
   * Both markers, because this line used to know about one. A lesson published
   * against the exam rubric fills `advanced` and leaves `report` null, and this
   * read "none asked for yet" underneath a panel that was showing the student a
   * mark — exactly the kind of quiet disagreement between a page and its own
   * diagnostic that this file exists to prevent.
   */
  if (input.advanced) {
    const { final } = input.advanced;
    if (final.insufficient_evidence) return 'delivered — not placed, too little to mark';
    return (
      `delivered — advanced:${input.advanced.face}, ` +
      `${final.half_mark ?? final.final_ib_mark}/7 (IB grade ${final.final_ib_mark}), ` +
      `${final.cefr_verdict}, confidence ${final.confidence}`
    );
  }
  if (!input.report) return 'none asked for yet';
  const { band, confidence } = input.report.diagnosis;
  return `delivered — band ${band}, confidence ${confidence}`;
}

/**
 * One row of the cost table: a label, a middle, and money in the last column.
 *
 * THREE FIXED WIDTHS RATHER THAN THREE CALLERS EACH PICKING THEIR OWN. Every
 * line in the block has to put its dollars in the same column — a per-bucket
 * row, a subtotal with no rate, an hourly projection with no tokens, and the
 * lesson total — and those have nothing else in common. Padding them
 * individually is how a table drifts a character per row until the sum no
 * longer looks like a sum.
 */
const LABEL_WIDTH = 22;
const MIDDLE_WIDTH = 27;

function row(label: string, middle: string, usd: number | null): string {
  return (
    `  ${label.padEnd(LABEL_WIDTH)}${middle.padEnd(MIDDLE_WIDTH)}` +
    (usd === null ? '' : usdCell(usd))
  );
}

/**
 * Money in the last column — and NOT `formatUsd`, deliberately.
 *
 * `formatUsd` gives two decimals at a cent and above, which is right for the
 * bench, where the reader wants to know roughly what a call cost. It is fatal
 * here. The two markers this block exists to compare differ by fractions of a
 * cent — $0.0161 against $0.0119 — and two decimals renders those as "$0.02"
 * and "$0.01", which is a 2× difference where the truth is 1.35×. A comparison
 * table whose rounding invents the answer is worse than no table.
 *
 * So: four decimals below a dollar, where the difference lives, and two above,
 * where four would be noise on an hourly projection nobody will bill against.
 */
function usdCell(usd: number): string {
  return `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`.padStart(10);
}

/** The middle column of a priced bucket: tokens and the rate they cost. */
function priced(tokens: number, rate: number): string {
  return `${formatTokens(tokens).padStart(9)} tok  @ $${String(rate).padStart(5)}/M  `;
}

/**
 * What the conversation and the marking of it cost.
 *
 * WHY IT IS IN HERE AT ALL, on a page whose standing rule is that a student
 * never sees a price. The diagnostic is not the student's — it is taken by the
 * person who published the lesson, by a gesture nobody finds by accident, and
 * this is the only place the two halves of a lesson's bill ever meet. The live
 * call is priced in the browser from `usageMetadata` frames; the marking call
 * is priced in the Worker from Vertex's. Neither number is visible from where
 * the other one lives.
 *
 * THE QUESTION IT IS BUILT TO ANSWER is which marker to publish. Choosing
 * between the standard report and the exam rubric is choosing between two
 * models, two prompt sizes and two retry behaviours, and the only answer
 * available before this was "a cent or so, probably". One diagnostic from a
 * lesson marked each way settles it — which is why the marking block names the
 * model, the call count and the token split rather than just the money.
 *
 * ONLY THE MARKER THAT RAN IS PRICED. The other is not run, cannot be costed
 * from this transcript without running it, and a modelled figure sitting beside
 * a measured one would be read as the same kind of thing. The closing note says
 * so rather than leaving the absence to be interpreted.
 *
 * EVERY FIGURE IS A FLOOR, and the caveats are printed here rather than left in
 * cost.ts where nobody reading a diagnostic would find them.
 */
function costBlock(input: DiagnosticInput): string {
  const model = findModel(input.modelKey);
  const usage = input.usage;
  const spent = totalTokens(usage);
  const lines: string[] = [];

  lines.push(
    'Estimates from provider-reported token counts, priced off published rate',
    'cards rather than a bill. Both halves are floors: the relay Worker leg is',
    'not billed here, and a socket that dies takes any usage it had not yet',
    'reported with it.',
    '',
  );

  // --- The call ----------------------------------------------------------
  lines.push(field('The call', model ? `${model.id} — ${model.label}` : input.modelKey));

  const estimate = model ? estimateCost(model.id, usage) : null;

  if (!spent) {
    lines.push(
      '  nothing reported yet — Google sends usage during a call, so this stays',
      '  empty until one has run.',
    );
  } else if (!estimate?.priced) {
    lines.push(`  ${formatTokens(spent)} tokens, on a model this build has no rates for.`);
  } else {
    for (const line of estimate.lines) {
      lines.push(row(line.label, priced(line.tokens, line.rate), line.usd));
    }
    lines.push(`  ${' '.repeat(LABEL_WIDTH)}${'-'.repeat(9)}`);
    lines.push(row('This call', `${formatTokens(spent).padStart(9)} tok`, estimate.usd));

    /*
     * The wall clock and the token clock side by side. They answer different
     * questions — how long the connection was open, and how much speech was
     * actually billed — and a call where they disagree spent money on silence.
     * See speakingTime for why the learner's own figure is usually withheld.
     */
    const seconds = input.lastCallMs !== null ? input.lastCallMs / 1000 : null;
    if (seconds !== null) {
      const time = speakingTime(model!.id, usage, seconds);
      lines.push(
        row(
          'Speech',
          `${formatDuration(time.callSeconds)} of call, tutor ` +
            `${time.agentSeconds === null ? '—' : formatDuration(time.agentSeconds)}`,
          null,
        ),
      );
      lines.push(
        row(
          '',
          time.userSeconds === null
            ? 'learner withheld — every turn re-reads'
            : `learner ${formatDuration(time.userSeconds)}`,
          null,
        ).trimEnd(),
      );
      if (time.userSeconds === null) {
        lines.push(`  ${' '.repeat(LABEL_WIDTH)}the call, so the tokens over-count.`);
      }

      const hourly = projectHour(model!.id, usage, seconds);
      if (hourly) {
        lines.push(row('An hour of this', '', hourly.usd));
        lines.push(
          `  ${' '.repeat(LABEL_WIDTH)}up to ${usdCell(hourly.ceilingUsd).trim()}` +
            ' if the context is never trimmed.',
        );
      }
    }
    lines.push(
      `  Rates read ${RATES_VERIFIED_ON}; audio seconds-per-token ${AUDIO_RATES_VERIFIED_ON}.`,
    );
  }

  // --- The marking -------------------------------------------------------
  lines.push('');
  const cost = input.markingCost;
  if (!cost) {
    lines.push(field('The marking', 'not run — no evaluation has been asked for'));
  } else {
    lines.push(field('The marking', `${cost.kind} — ${cost.modelId} — ${cost.modelLabel}`));
    if (cost.unverifiedRates) {
      lines.push(`  ${' '.repeat(LABEL_WIDTH)}rates read off a pricing page, not a bill.`);
    }
    lines.push(
      row(
        `${cost.calls} call${cost.calls === 1 ? '' : 's'}`,
        `${formatTokens(cost.inputTokens)} in / ${formatTokens(cost.outputTokens)} out` +
          (cost.cachedInputTokens ? ` / ${formatTokens(cost.cachedInputTokens)} cached` : ''),
        cost.usd,
      ),
    );
    /*
     * A retry is a doubling, and it is the one thing about this number a
     * teacher comparing two markers would otherwise read as the prompt being
     * twice the size. Only the advanced path has one — see _advanced.ts, §14.
     */
    if (cost.calls > 1) {
      lines.push(
        '  The marker retried: a reply failed grounding against the transcript,',
        `  so this ran ${cost.calls === 2 ? 'twice' : `${cost.calls} times`}. A run that` +
          ` validates first time costs about ${usdCell(cost.usd / cost.calls).trim()}.`,
      );
    }
  }

  // --- The two together --------------------------------------------------
  lines.push('');
  lines.push(row('THIS LESSON', '', (estimate?.usd ?? 0) + (cost?.usd ?? 0)));
  lines.push(
    '',
    'Only the marker that ran is priced. The other is never run, so comparing',
    'the two means one diagnostic from a lesson published each way. What differs',
    'between them is the model, the prompt size and whether a retry is possible',
    '— never the transcript, and never the call above.',
  );

  return lines.join('\n');
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
     * WHAT USED TO BE HERE was a protocol version, and a warning to republish.
     * A published prompt was frozen and the build that ran it was not, so a code
     * handed out before a protocol change taught a conversation that went wrong
     * in ways nothing else in this document explained. The prompt is composed
     * when the student dials now — see composeTutorPrompt — so a setup cannot be
     * out of step with the build reading it, and the row went with the fault.
     *
     * What replaces it is which halves of the prompt this particular setup
     * carries, because that is what still varies: a code published before the
     * composer moved has a lesson and no style, and gets the built-in one.
     */
    put(
      field(
        'Prompt parts',
        setup.style
          ? 'style and lesson, both stored; composed by this build at dial time'
          : `lesson only, so the built-in style was used${
              setup.instructions ? ' (published before the composer moved)' : ''
            }`,
      ),
    );
    /*
     * Which lesson rules the tutor is running, because it is now a thing that
     * varies and it is the block a rewrite is judged on. The length is here so
     * that a rewrite is identifiable at a glance without reading the whole
     * prompt below — two runs of the same lesson under two different blocks
     * differ in this number, which is the first thing to check when a lesson
     * behaves unlike the last one. See DEFAULT_LESSON_RULES.
     */
    put(
      field(
        'Lesson rules',
        setup.lessonRules?.trim()
          ? `house-written, ${setup.lessonRules.trim().length} characters — in full below`
          : "this build's own — no house block was published with this code",
      ),
    );
    /*
     * The pace, which is the one thing a teacher chose that no payload can be
     * read back to confirm — it is a block of prose in the prompt rather than a
     * field on the setup frame. So it is named here and the block itself is
     * visible in the composed prompt below, which is the only verification
     * there is. See `PACE` in tutorPrompt.ts on why it cannot be a setting.
     */
    put(
      field(
        'Pace',
        setup.pace && setup.pace !== 'natural'
          ? `${setup.pace} — asked for in the prompt below, under HOW YOU SPEAK`
          : "the tutor's own — no pace block was composed",
      ),
    );
    put(
      field(
        'Persona',
        personaLine(setup.persona),
      ),
    );
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
  /*
   * The count the page kept, which is worth reading beside the `progress` lines
   * in the timeline rather than instead of them. This says where the lesson got
   * to; those say what the tutor claimed and which of its claims were refused,
   * and the gap between them is the whole diagnosis when a lesson ends early.
   */
  put(
    field(
      'Questions counted',
      `${input.answered.length} of ${setup?.questions?.length ?? 0}` +
        (input.answered.length ? ` — ${input.answered.join(', ')}` : ''),
    ),
  );
  put(
    field(
      'Page says done',
      input.lessonDone ? 'yes — the tutor closes it and the page waits for quiet' : 'no',
    ),
  );
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
  } else if (!setup.questions?.length || !language) {
    put('  — this setup carries no lesson, so there is no prompt to compose.');
  } else {
    /*
     * Composed here rather than read out of the setup, because composing is
     * what the page does — see Eleve.tsx. Same pure function, same frozen
     * fields, so this is the text that was sent rather than a description of
     * it. Were the two able to differ, this section would be quietly describing
     * a call that never happened, which is the failure the whole document
     * exists to make impossible.
     */
    const composed = composeTutorPrompt({
      style: setup.style?.trim() || defaultInstructions(language),
      rules: setup.lessonRules,
      persona: setup.persona,
      pace: setup.pace,
      questions: setup.questions,
    });
    put(
      `${composed.length} characters, composed by this build at the moment of dialling.`,
      "The style and the persona were frozen at publish; the protocol around them —",
      'the tools, the notes, the order — is this build\'s, and moves with it.',
      '',
      composed,
    );
  }

  put(head('WHAT IT COST'));
  put(costBlock(input));

  put('', RULE, 'END', RULE);
  return lines.join('\n');
}
