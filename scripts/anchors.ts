/**
 * The anchor regression suite: does the marker still mark the way it did?
 *
 * WHAT IT CHECKS, AND WHY IT IS WORTH A SCRIPT. Stages 1 and 3 are the two
 * halves of the advanced marker that no model touches — counts in, mark out —
 * so they are exactly testable, and a silent drift in either is the kind of
 * fault that only shows up as a student's grade being wrong. Every anchor goes
 * through the real `computeStats` and `computeFinal` imported from the app, not
 * a copy: a suite with its own arithmetic tests arithmetic nobody ships.
 *
 * Three assertions per anchor:
 *
 *   1. Every quote the anchor cites literally appears in its own transcript.
 *      This is `validateOralOutput`, the same function that gates a live
 *      marking call — so the anchors also prove the validator is not rejecting
 *      well-formed output.
 *   2. Stage 3 reproduces `expected_final` field for field.
 *   3. The weights still sum to 1.00, which is the assumption every guard
 *      threshold in `computeFinal` is written against.
 *
 * WHAT IT CANNOT TELL YOU: whether the model picks the right bands. That is
 * calibration against hand-marked real transcripts, per spec §14, and no amount
 * of deterministic testing substitutes for it. This suite proves the machinery
 * around the judgment is sound; the judgment itself is measured by re-running
 * the anchors through the live call and watching for banding drift.
 *
 * It runs through esbuild for the reason `probe` does: these modules import each
 * other without file extensions, which Node's own TypeScript stripping will not
 * resolve. See the `anchors` script in package.json.
 *
 *   npm run anchors
 *
 * Exit 0 means every anchor passed. Anything else is a regression.
 */

import { ORAL_ANCHORS } from '../src/realtime/oralAnchors';
import { computeFinal, computeStats, validateOralOutput, WEIGHTS } from '../src/realtime/oralMarker';

function checkField(name: string, actual: unknown, expected: unknown, failures: string[]): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}: expected ${e}, got ${a}`);
}

function main(): void {
  const weightTotal = WEIGHTS.A + WEIGHTS.B + WEIGHTS.C;
  console.log(
    `${ORAL_ANCHORS.length} anchors; weights ${WEIGHTS.A}/${WEIGHTS.B}/${WEIGHTS.C} ` +
    `= ${weightTotal.toFixed(2)}\n`,
  );

  let passed = 0;
  const failedIds: string[] = [];

  // The guard thresholds in computeFinal are written against a unit sum. If
  // this ever drifts, every anchor below is testing something else.
  if (Math.abs(weightTotal - 1) > 1e-9) {
    console.log(`[FAIL] WEIGHTS must sum to 1.00, got ${weightTotal}\n`);
    process.exit(1);
  }

  for (const anchor of ORAL_ANCHORS) {
    const failures: string[] = [];
    const stats = computeStats(anchor.transcript);
    const llm = anchor.expected_llm_output;

    const validation = validateOralOutput(llm, anchor.transcript);
    for (const err of validation.errors) failures.push(`validator: ${err}`);

    const final = computeFinal(llm, stats);
    for (const [key, expected] of Object.entries(anchor.expected_final)) {
      checkField(key, (final as Record<string, unknown>)[key], expected, failures);
    }

    const status = failures.length === 0 ? 'PASS' : 'FAIL';
    console.log(`[${status}] ${anchor.id} — ${anchor.label}`);
    console.log(
      `        A${final.criterion_scores?.A} B${final.criterion_scores?.B} ` +
      `C${final.criterion_scores?.C} | raw ${final.raw_weighted_score} | ` +
      `display "${final.display_mark}" | ${final.cefr_verdict} | ` +
      `confidence ${final.confidence} (${final.confidence_coverage}/${final.confidence_sample})`,
    );
    console.log(
      `        ${stats.student_word_count} student words, ratio ` +
      `${stats.student_examiner_word_ratio}, ${stats.hesitation_per_100_words} hesitations/100w`,
    );
    if (final.limiting_criterion) console.log(`        limiting: ${final.limiting_criterion}`);
    for (const f of failures) console.log(`        ! ${f}`);
    console.log();

    if (failures.length === 0) passed += 1;
    else failedIds.push(anchor.id);
  }

  console.log(`${passed}/${ORAL_ANCHORS.length} anchors passed.`);
  if (failedIds.length > 0) {
    console.log(`Failed: ${failedIds.join(', ')}`);
    process.exit(1);
  }
}

main();
