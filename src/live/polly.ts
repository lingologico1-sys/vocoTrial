import {
  ATTACK,
  RELEASE,
  SHAPE_TAU,
  SILENCE,
  VISEMES,
  ease,
  type LipShape,
  type MouthFrame,
  type Viseme,
} from './visemes';
// The table and the two types it needs moved to visemeTable.ts so that a Worker can
// import them without this file's browser dependencies. Re-exported unchanged: this
// is still where a reader looks for them, and every existing import still resolves.
export { POLLY_VISEMES } from './visemeTable';
export type { PollyViseme, VisemeMark } from './visemeTable';
import { POLLY_VISEMES } from './visemeTable';
import type { PollyViseme, VisemeMark } from './visemeTable';

/**
 * Driving the mouth from text instead of from sound.
 *
 * Amazon Polly will say what it is about to articulate, ahead of saying it, in
 * a stream of speech marks. That is a different kind of information from the
 * one live/visemes.ts works with, and better in the two ways that matter: it
 * names the articulation rather than inferring it from a spectrum, and it
 * arrives before the audio does rather than after. Nothing here measures
 * anything.
 *
 * What it does not change is the artwork. Polly's twenty visemes collapse onto
 * the seven poses a kit actually contains, and that collapse is the subject of
 * most of this file. It is lossy on paper and much less so in practice, because
 * Polly's set is specified for rigs with a tongue and a jaw, while a kit is a
 * flat patch composited onto a fixed portrait. Over half of Polly's
 * distinctions are ones such a patch has no way to show — see POLLY_VISEMES for
 * which, and why sculpting them was measured and rejected rather than merely
 * skipped.
 *
 * The table is language-independent by construction, which is the property that
 * matters most here and the one that is easiest to get wrong. Polly publishes a
 * separate phoneme table per language, and they do not use the same subset:
 * en-US has `l` and `T`, French has neither and routes /l/ through `t`, Mandarin
 * and Korean lean on `J`, Japanese alone uses `B`. Mapping every identifier any
 * table can emit — rather than the ones the language in front of us happens to
 * need — is what lets a face generated for a French tutor be handed a Mandarin
 * voice without anybody regenerating anything.
 *
 * The real win is not shape count. It is `S`: Polly separates the postalveolars
 * from the plain sibilants, and the audio analyser provably cannot, because
 * what it reads is brightness and "sh" and "s" are both bright. That is one
 * genuinely wrong pose per "chose", "shop" or "juge", fixed by knowing rather
 * than by looking. Timing is the other — see MarkMouth.
 */


/**
 * What the analyser would have reported as loudness for each pose.
 *
 * Marks carry no amplitude — they say what the mouth is doing and nothing about
 * how hard. But `level` is not decoration downstream: the head motion reads it
 * for emphasis, and the lip press in headMotion.ts is gated on the exact
 * identity `viseme === 'rest'` being the same test as `level < SILENCE`. A
 * driver that left the field at zero would hand every one of those a mouth that
 * looks permanently silent.
 *
 * So it is derived from the pose instead, on the one honest correlation
 * available: a mouth open that far was, in the audio driver, open because it was
 * loud. Written out as seven numbers rather than computed from LipShape because
 * the arithmetic that would produce them needs a fudge at both ends anyway — the
 * floor to keep every speaking pose clear of SILENCE, the ceiling to stop `oh`
 * outranking `aa` merely for being taller — and two fudges and a formula are
 * less legible than the seven numbers they exist to produce.
 */
const POSE_LEVEL: Record<Viseme, number> = {
  rest: 0,
  mbp: 0.2,
  fv: 0.22,
  /**
   * Between `fv` and `ee`, which is where the mouth is and also where the sound is.
   *
   * These are consonants, so the honest reading is quiet; but they are the loudest thing
   * a nearly-shut mouth does — a sibilant carries, and a released /t/ is a burst — so
   * they outrank the labiodental. Clear of SILENCE (0.12) by the same margin everything
   * else here is, and for the reason given above: the lip press is gated on `level <
   * SILENCE` being the same test as `viseme === 'rest'`, and a speaking pose that dipped
   * under the line would be handed a mouth that looks silent while it is talking.
   */
  st: 0.3,
  ee: 0.45,
  uh: 0.5,
  aa: 0.95,
  oh: 0.8,
  /** Loud, like the open vowel it is built from. */
  laugh: 0.95,
  /**
   * Low, but deliberately above SILENCE (0.12).
   *
   * Zero would be the honest reading of a silent expression, and it would break the
   * invariant the lip press is gated on — that `level < SILENCE` and `viseme === 'rest'`
   * are the same test. A smiling face would then be treated as a silent one and pressed
   * its lips, which is the opposite of what it is doing.
   */
  smile: 0.16,
};


const IS_POLLY_VISEME = (value: unknown): value is PollyViseme =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(POLLY_VISEMES, value);

/**
 * Reads Polly's speech-mark body into marks.
 *
 * The format is newline-delimited JSON, one object per line, not a JSON array —
 * so it cannot be handed to JSON.parse whole, and the loop below is not
 * laziness about that.
 *
 * Tolerant on purpose, in the three ways the response actually varies. A
 * request may ask for several mark types at once and get `word` and `sentence`
 * objects interleaved with these, which are not errors and are not ours. Blank
 * lines appear at the end. And an unrecognised viseme value is dropped rather
 * than thrown on: a mark this build has never heard of means a table that wants
 * updating, and the failure that suits that is one wrong-looking mouth shape,
 * not a call that ends mid-sentence.
 *
 * Sorted on the way out because the timeline below binary-searches it. Polly
 * emits in order, but that is a property of the response rather than of the
 * format, and the cost of not depending on it is one sort per utterance.
 */
export function parseSpeechMarks(body: string): VisemeMark[] {
  const marks: VisemeMark[] = [];

  for (const line of body.split('\n')) {
    const text = line.trim();
    if (!text) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }

    if (typeof parsed !== 'object' || parsed === null) continue;
    const mark = parsed as { type?: unknown; time?: unknown; value?: unknown };
    if (mark.type !== 'viseme') continue;
    if (typeof mark.time !== 'number' || !IS_POLLY_VISEME(mark.value)) continue;

    marks.push({ timeMs: mark.time, polly: mark.value, viseme: POLLY_VISEMES[mark.value] });
  }

  return marks.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Which mark is in force at a given moment, or null before the first one.
 *
 * Binary search rather than a cursor advanced each frame. A cursor would be
 * fewer comparisons and would also be state that has to be right when the clock
 * moves backwards — which it does, on a replay or a seek. A few hundred marks
 * per utterance makes this eight or nine comparisons, and it is correct for any
 * time in any order.
 */
export function markAt(marks: readonly VisemeMark[], timeMs: number): VisemeMark | null {
  let low = 0;
  let high = marks.length - 1;
  let found: VisemeMark | null = null;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (marks[mid].timeMs <= timeMs) {
      found = marks[mid];
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return found;
}

/**
 * How far ahead of the sound a mark-driven mouth is read, in seconds.
 *
 * Smaller than DEFAULT_LOOKAHEAD_MS, and the difference is the whole reason
 * marks are worth having. That constant is 80ms because about 50ms of it is
 * spent buying back the mouth's own lag — the shape eases with a 35ms time
 * constant, the level attacks over 15ms — leaving 30ms of actual anticipation.
 *
 * Here the mark is already stamped with the instant the phoneme *begins*, and
 * articulation leads phonation by a good deal more than that on its own. So
 * only the mouth's own lag needs paying for, and the anticipation comes free
 * with the data. Spending the full 80 on top of a mark would put the mouth a
 * syllable early.
 */
export const MARK_LOOKAHEAD_MS = 50;

/**
 * A mouth driven by marks, one frame at a time.
 *
 * The counterpart to MouthAnalyser, and deliberately the same shape: `read(dt)`
 * returns a MouthFrame, `silence()` snaps it shut. What is missing from it is
 * as informative as what is in it — there is no hysteresis, no minimum hold and
 * no running peak, because all three exist to stop a *measurement* from
 * flickering. A mark does not flicker. It is already a discrete decision made
 * by something that knows the answer, so passing it through a hold would only
 * delay it.
 *
 * The easing stays, because that is not about flicker. Lips have mass, and a
 * shape that snaps reads as a slideshow however correct each frame of it is.
 */
export class MarkMouth {
  private shape: LipShape = { ...VISEMES.rest };
  private viseme: Viseme = 'rest';
  private level = 0;

  /**
   * @param marks The utterance's viseme marks, as parseSpeechMarks returns them.
   * @param audioTime Seconds into that utterance's audio that are being *heard*
   *   right now. The caller owns this because only it knows how the audio is
   *   being played; whatever produces it has to subtract output latency the way
   *   scheduledFeatures does, or the mouth leads by however far the speakers
   *   are behind — a few milliseconds wired, a great deal over Bluetooth.
   * @param lookahead Seconds to run ahead by, read fresh so it can be tuned
   *   live. Defaults to MARK_LOOKAHEAD_MS.
   */
  constructor(
    private marks: readonly VisemeMark[],
    private audioTime: () => number,
    private lookahead: () => number = () => MARK_LOOKAHEAD_MS / 1000,
  ) {}

  /**
   * Swaps in the next utterance's marks without resetting the mouth.
   *
   * MouthAnalyser.setSource exists for the same reason and states it: replacing
   * the driver outright would drop the eased shape back to rest, so every
   * utterance would open with the mouth catching up from closed.
   */
  setMarks(marks: readonly VisemeMark[], audioTime: () => number): void {
    this.marks = marks;
    this.audioTime = audioTime;
  }

  /** @param dt Seconds since the previous frame. */
  read(dt: number): MouthFrame {
    const at = (this.audioTime() + this.lookahead()) * 1000;
    // Before the first mark is silence, not the first mark held early. Polly
    // stamps a `sil` at time zero on most utterances, so this mostly matters
    // for the gap between a call starting and audio arriving.
    this.viseme = markAt(this.marks, at)?.viseme ?? 'rest';

    const goalLevel = POSE_LEVEL[this.viseme];
    this.level +=
      (goalLevel - this.level) * ease(dt, goalLevel > this.level ? ATTACK : RELEASE);

    const goal = VISEMES[this.viseme];
    const k = ease(dt, SHAPE_TAU);
    this.shape = {
      w: this.shape.w + (goal.w - this.shape.w) * k,
      up: this.shape.up + (goal.up - this.shape.up) * k,
      down: this.shape.down + (goal.down - this.shape.down) * k,
    };

    // The invariant the lip press is gated on: at rest and only at rest does the
    // level read as silence. Easing can leave it above the line for a frame or
    // two after the pose closes, so it is asserted here rather than hoped for.
    // See SILENCE in visemes.ts, and `pressed` in Face.tsx.
    const level = this.viseme === 'rest' ? Math.min(this.level, SILENCE * 0.99) : this.level;

    return { viseme: this.viseme, shape: this.shape, level };
  }

  /** Snaps shut. For the end of a turn, and for barge-in. */
  silence(): MouthFrame {
    this.level = 0;
    this.viseme = 'rest';
    this.shape = { ...VISEMES.rest };
    return { viseme: 'rest', shape: this.shape, level: 0 };
  }
}
