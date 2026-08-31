import type { LipsyncPackage } from './published';
import { isMergedWord } from './warnings';

/**
 * Working out why the mouth did what it did, and writing it down so it can be sent.
 *
 * Split out of Diagnostics.tsx for two reasons. The classification is the interesting
 * part and JSX is a poor place to test it from — the threshold bug below was found by a
 * check that could only be written once this was a function. And the report has to be
 * plain text a person can paste into a message, which is a different job from rendering
 * a panel even though both say the same things.
 *
 * WHAT THE REPORT IS FOR. Somebody looking at a face that shut its mouth mid-sentence
 * needs to hand over enough for the problem to be diagnosed without the audio. That is
 * the metadata, the script as the aligner received it, every word it could not look up,
 * every quiet stretch with its cause, and what the mouth wore for each word. Deliberately
 * not the raw mark array: several hundred entries that say the same thing as the per-word
 * summary, at ten times the length. The per-word summary now carries each mark's
 * provenance, which is the one thing the array had that the summary did not — grouped by
 * word and stripped of timestamps, so it stays a line per word rather than a line per
 * mark. See phonesDuring for the question that needed it.
 */

/** Shorter than this is easing, not stillness. SHAPE_TAU is 35ms; this is four of them. */
export const MIN_QUIET = 140;

export type QuietCause = 'pause' | 'unknown-word' | 'punctuation' | 'unexplained';

export interface Quiet {
  startMs: number;
  endMs: number;
  /** Words the aligner placed inside this stretch. Usually none — that is what quiet is. */
  words: string[];
  unknown: string[];
  cause: QuietCause;
}

export function quietStretches(pkg: LipsyncPackage): Quiet[] {
  const out: Quiet[] = [];
  const marks = pkg.marks;
  const oov = pkg.oovWords ?? [];

  for (let i = 0; i < marks.length; i++) {
    if (marks[i].viseme !== 'rest') continue;
    const startMs = marks[i].timeMs;
    const endMs = i + 1 < marks.length ? marks[i + 1].timeMs : pkg.durationMs;

    const words = pkg.words
      .filter((w) => w.startMs < endMs && w.endMs > startMs)
      .map((w) => w.word);
    const unknown = oov
      .filter((w) => w.startMs < endMs && w.endMs > startMs)
      .map((w) => w.word);

    // The length floor applies to pauses only. An unknown word is reported however brief
    // its stretch is, because brevity is not evidence it is harmless — an `spn` whose
    // audio was never really spoken can be 40ms wide, under the threshold, and skipping
    // it would hide precisely the case this exists for.
    if (unknown.length === 0 && endMs - startMs < MIN_QUIET) continue;

    // A quiet stretch sitting inside a word MFA merged is almost always the pause at
    // the punctuation it merged across — "lycée, c'était" arrives as one token, so the
    // comma's own pause looks like the mouth shutting mid-word. Reporting that as an
    // anomaly sends someone hunting for a bug in the most ordinary thing in the
    // sentence, which is what happened the first time this panel was used in anger.
    const merged = words.length > 0 && words.every((w) => isMergedWord(pkg, w));

    out.push({
      startMs,
      endMs,
      words,
      unknown,
      cause:
        unknown.length > 0
          ? 'unknown-word'
          : words.length === 0
            ? 'pause'
            : merged
              ? 'punctuation'
              : 'unexplained',
    });
  }
  return out;
}

/** Stands in for a mark with no phone behind it: a laugh or its lead-in smile. */
const TAG_MARK = '·';

/**
 * Every mark's provenance across one word, in order and WITHOUT collapsing repeats.
 *
 * The uncollapsing is the entire point, and it is why this cannot just be posesDuring
 * with a different field. That function answers "what did the mouth look like", so
 * folding a run of identical poses into one is a kindness — nothing happened, and
 * printing it six times says nothing six times. This answers "how much did the aligner
 * actually give us", and there a run of six is the answer.
 *
 * The distinction has already earned itself once. "distance" reported a single `ee`
 * across 550ms, which has two possible causes that the pose column cannot tell apart:
 * every phone in the word is alveolar and maps to `ee` — the word really is articulated
 * behind the teeth and the lips really do hold still — or marks went missing. One line
 * of provenance separates them: six identifiers is the first, one is the second.
 *
 * No carry-in, unlike posesDuring. The mark in force when a word began is what the mouth
 * was wearing, so that function is right to keep it; but it was produced by the word
 * before, and counting it here would credit this word with a phone it never had.
 *
 * IT NOW RETURNS ACTUAL PHONES, and for most of its life the name was a promise it could
 * not keep: marks carried only the Polly identifier, so this printed `t` for /t/, /d/
 * and /n/ alike and the column was already one collapse away from what the aligner saw.
 * The bake keeps `phone` now, and packages older than that fall back to the identifier —
 * still ordered, still uncollapsed, just coarser. Worth knowing when reading a column of
 * them: a row of bare identifiers means an old package, not a strange alignment.
 */
export function phonesDuring(pkg: LipsyncPackage, startMs: number, endMs: number): string[] {
  return pkg.marks
    .filter((m) => m.timeMs >= startMs && m.timeMs < endMs)
    .map((m) => m.phone ?? m.polly ?? TAG_MARK);
}

/** What the mouth wore across one word, in order, without repeats. */
export function posesDuring(pkg: LipsyncPackage, startMs: number, endMs: number): string[] {
  const seen: string[] = [];
  for (const m of pkg.marks) {
    if (m.timeMs >= endMs) break;
    if (m.timeMs + 1 < startMs) {
      // The mark in force when the word began still counts, so keep the latest one
      // before it rather than skipping to the first one inside.
      seen.length = 0;
      seen.push(m.viseme);
      continue;
    }
    const pose = m.viseme;
    if (seen[seen.length - 1] !== pose) seen.push(pose);
  }
  return seen;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

/**
 * The whole diagnosis as plain text, ready to paste.
 *
 * Fenced so it survives a chat client's markdown, and ordered worst-first: the unknown
 * words are what someone is asking about, so they go above the metadata rather than
 * beneath it.
 */
export function report(pkg: LipsyncPackage): string {
  const quiet = quietStretches(pkg);
  const oov = pkg.oovWords ?? [];
  const unexplained = quiet.filter((q) => q.cause === 'unexplained');
  const punctuation = quiet.filter((q) => q.cause === 'punctuation');
  const pauses = quiet.filter((q) => q.cause === 'pause');
  const L: string[] = [];

  L.push('lipsync diagnostics');
  L.push('===================');
  L.push('');

  if (oov.length > 0) {
    L.push(`UNKNOWN WORDS (${oov.length}) — the mouth stays shut through each`);
    for (const w of oov) {
      L.push(`  "${w.word}"  ${secs(w.startMs)}–${secs(w.endMs)}  (${w.reason})`);
    }
    L.push('');
  }

  if (unexplained.length > 0) {
    L.push(`SHUT WHILE SPEAKING, cause unknown (${unexplained.length})`);
    for (const q of unexplained) {
      L.push(`  ${secs(q.startMs)}–${secs(q.endMs)}  over "${q.words.join(' ')}"`);
    }
    L.push('');
  }

  L.push('WHAT IT WAS MADE FROM');
  L.push(`  model      ${pkg.model}`);
  L.push(`  language   ${pkg.language}`);
  L.push(`  voice      ${pkg.voiceName ?? '?'} (${pkg.voiceId})`);
  L.push(
    `  params     stability ${pkg.params.stability}, similarity ${pkg.params.similarityBoost}, ` +
      `style ${pkg.params.style}, speakerBoost ${pkg.params.speakerBoost}`,
  );
  L.push(`  duration   ${secs(pkg.durationMs)}`);
  L.push(`  marks      ${pkg.marks.length}`);
  L.push(`  words      ${pkg.words.length}`);
  L.push(`  oov        ${pkg.oovCount}`);
  const spliced = pkg.laughs ?? [];
  L.push(
    `  reactions  ${pkg.reactionCount} span(s), ${spliced.length} of them spliced laughs`,
  );
  L.push('');

  L.push('TEXT AS TYPED');
  L.push(`  ${pkg.text.replace(/\n/g, '\n  ')}`);
  L.push('');
  // Three texts now rather than two, and the difference between them is diagnostic. If a
  // laugh is missing from the audio, the first question is whether the model was even
  // asked for one — and `spoken` is the only record of that. Printed only when it
  // differs, so an ordinary line still shows two blocks and not three.
  if (pkg.spoken && pkg.spoken !== pkg.text) {
    L.push('WHAT ELEVENLABS WAS ASKED TO SAY (laughs lifted out and spliced instead)');
    L.push(`  ${pkg.spoken.replace(/\n/g, '\n  ')}`);
    L.push('');
  }
  if (pkg.script !== pkg.text) {
    L.push('SCRIPT THE ALIGNER SAW (tags stripped)');
    L.push(`  ${pkg.script.replace(/\n/g, '\n  ')}`);
    L.push('');
  }

  // The audio's own account of itself, first among the sections that can show a fault,
  // because it is the only one that can show the audio being shorter than the marks —
  // which is what a splice that threw bytes away looks like from the outside.
  const audio = pkg.audio;
  if (audio) {
    L.push('AUDIO AS BUILT');
    L.push(`  format     ${audio.format}`);
    L.push(
      `  speech     ${audio.speech.frames} frames  ${secs(audio.speech.durationMs)}  ` +
        `${audio.speech.bytes} bytes`,
    );
    L.push(
      `  final      ${audio.final.frames} frames  ${secs(audio.final.durationMs)}  ` +
        `${audio.final.bytes} bytes`,
    );
    L.push(
      `  drift      ${audio.driftMs}ms  (package duration minus real audio)` +
        (Math.abs(audio.driftMs) > 250 ? '   <-- SOMETHING LOST AUDIO' : ''),
    );
    for (const clip of audio.clips) {
      L.push(
        `  clip       ${clip.used ? 'used   ' : 'SKIPPED'} ${secs(clip.durationMs).padStart(7)}  ` +
          `${String(clip.frames).padStart(4)} frames  ${clip.format}  "${clip.label}"` +
          (clip.skipped ? `  — ${clip.skipped}` : ''),
      );
    }
    L.push('');
  }

  if (spliced.length > 0) {
    L.push(`LAUGHS SPLICED FROM THE LIBRARY (${spliced.length})`);
    for (const laugh of spliced) {
      L.push(
        `  ${secs(laugh.atMs)}  ${laugh.kind.padEnd(8)} ${secs(laugh.durationMs).padStart(7)}  ` +
          `${(laugh.treatment ?? 'legacy').padEnd(15)} "${laugh.label}"  ` +
          `[${laugh.clipId.slice(0, 8)}]`,
      );
    }
    // Worth stating, because it is the one span length on the page that is not a
    // measurement and someone comparing these times to the aligner's will wonder.
    L.push("  These lengths are the clips' own, known before synthesis rather than");
    L.push('  measured after it. The audio was cut open and everything after each');
    L.push('  insertion moved along by exactly this much.');
    L.push('');
  }

  if (punctuation.length > 0) {
    L.push(`PAUSES INSIDE A MERGED WORD (${punctuation.length}) — almost certainly fine`);
    for (const q of punctuation) {
      L.push(`  ${secs(q.startMs)}–${secs(q.endMs)}  in "${q.words.join(' ')}"`);
    }
    L.push('  MFA merges tokens across some punctuation, so the pause at a comma lands');
    L.push('  inside what it calls one word.');
    L.push('');
  }

  L.push(`PAUSES (${pauses.length}) — correct, nothing to fix`);
  L.push(
    pauses.length
      ? '  ' + pauses.map((q) => `${secs(q.startMs)}–${secs(q.endMs)}`).join('  ')
      : `  none over ${MIN_QUIET}ms`,
  );
  L.push('');

  L.push('WORD BY WORD — what the mouth wore, and what it was made from');
  L.push(`  poses are collapsed; phones are not, so a run of one pose over many phones`);
  L.push(`  is a word the lips hold still through and a lone phone is a thin alignment.`);
  L.push(`  “${TAG_MARK}” is a mark from a tag rather than a sound.`);
  for (const w of pkg.words) {
    const poses = posesDuring(pkg, w.startMs, w.endMs).join(' ');
    const phones = phonesDuring(pkg, w.startMs, w.endMs).join(' ');
    const flag = oov.some((o) => o.startMs === w.startMs) ? '  <-- UNKNOWN' : '';
    L.push(
      `  ${w.word.padEnd(16)} ${secs(w.startMs).padStart(7)}–${secs(w.endMs).padEnd(7)} ` +
        `${poses.padEnd(30)} ${phones}${flag}`,
    );
  }

  return L.join('\n');
}
