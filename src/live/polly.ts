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
 * The twenty viseme identifiers Polly emits, exactly as they appear in the
 * `value` field of a viseme speech mark.
 *
 * Read off the published per-language phoneme tables rather than from any
 * summary of them, because the summaries are wrong in both directions and the
 * union is not what a single table shows.
 *
 * TWENTY, NOT EIGHTEEN, and the two extras are the reason this list was built
 * from more than one language. Reading en-US alone gives eighteen and looks
 * complete:
 *
 *   J   alveolo-palatal — Mandarin x/j/q, Polish ś/ć/ź, Korean ㅈ/ㅊ, Japanese
 *       sh/ch/j, Russian щ/ч, and French ɲ in *baigner*. Absent from en-US
 *       entirely, and among the commonest consonants in Mandarin.
 *   B   the voiced bilabial fricative β, Japanese only — its rendering of a
 *       borrowed "v", as in ヴィンテージ.
 *
 * There are no diphthong visemes in any table. Polly maps diphthongs onto the
 * plain vowel shapes — aɪ and aʊ to `a`, eɪ to `e`, oʊ to `o`, ɔɪ to `O` — so an
 * `aI` or `OI` pose would be an image nothing could ever select.
 *
 * And `l` is a viseme rather than part of `t`, but only in English: French,
 * Polish, Mandarin, Cantonese, Korean, Russian and Arabic all route /l/ through
 * `t` instead. That asymmetry is Polly's, not ours, and POLLY_VISEMES sends both
 * to the same pose so the same sound does not change shape with the voice.
 * Likewise `j` (yes) is `i` and `w` (west) is `u`, never `k`; `k` is k, g, h, ŋ
 * and — a surprise worth recording — the French uvular ʁ.
 */
export type PollyViseme =
  | 'p'
  | 't'
  | 'S'
  | 'T'
  | 'J'
  | 'B'
  | 'f'
  | 'k'
  | 'l'
  | 'r'
  | 's'
  | 'i'
  | 'e'
  | 'E'
  | 'a'
  | 'o'
  | 'O'
  | 'u'
  | '@'
  | 'sil';

/**
 * Which drawn pose each of Polly's eighteen wears.
 *
 * Written as an exhaustive Record so that the table is a complete statement:
 * adding a viseme to the union above stops this file compiling until it has
 * somewhere to go, which is the same guarantee facekit/slots.ts gets from the
 * `Viseme` union it keys on.
 *
 * Four of Polly's distinctions are dropped because a flat patch cannot carry
 * them, and that was measured rather than assumed. Running patchDivergence over
 * the shipped kit puts the closest existing pair — `rest` against `mbp`, which
 * is a whole category of lip tension — at 7.9% of centre pixels, against a 4%
 * floor below which two mouths are the same drawing, and that only after the
 * two prompts were rewritten against each other. See PRESS_DEPTH in
 * headMotion.ts for the full table. Every dropped distinction is finer than
 * that pair:
 *
 *   k     the tongue is pulled back *out of sight*, so there is no pixel that
 *         could differ from a plain open mouth
 *   t     the tongue sits behind the upper teeth, which is to say hidden
 *   T     a tongue tip on the teeth is the one genuinely new shape available,
 *         and it is ð/θ — English and Castilian only, in a face that otherwise
 *         carries no per-language artwork at all
 *   @     "barely open, relaxed" sits between `rest` and `uh`, nearer to each
 *         than they are to one another
 *
 * `S` goes the other way and is the reason this file earns its keep. The
 * analyser sends every sibilant to `ee` because it sorts them by brightness;
 * `S` is a rounded, protruded mouth and belongs with `oh`. Knowing the phoneme
 * is the only way to tell those apart, and here we know it.
 *
 * EVERY IDENTIFIER, NOT EVERY LANGUAGE'S SUBSET. Nothing below is conditioned on
 * which voice is speaking, and that is deliberate: a pose set complete for the
 * union is complete for each language inside it, so choosing a different voice
 * later can never turn out to need artwork that does not exist. What it can need
 * is a row in this table, which is a compile error and a one-line fix rather
 * than a regeneration of every kit ever made.
 *
 * The front rounded vowels are worth singling out, because they are the case the
 * audio driver spends most of its complexity on. Polly resolves them outright:
 * French /y/ and Mandarin ü both arrive as `u`, /ø/ as `o`, /œ/ as `O` — all
 * rounded, all correct, with no measurement involved. Under this driver the
 * whole RoundnessMode apparatus in visemes.ts, and the FRONT_ROUNDED_LANGUAGES
 * list it consults, simply does not apply.
 */
export const POLLY_VISEMES: Record<PollyViseme, Viseme> = {
  /** Silence. The only mark that closes the mouth. */
  sil: 'rest',
  /** p, b, m — the bilabials, and the one consonant a drawn mouth shows plainly. */
  p: 'mbp',
  /** f, v. The labiodental, and the slot fv was carried for. */
  f: 'fv',

  /** β, Japanese's borrowed "v". Bilabial, so the lips meet — teeth are `fv`. */
  B: 'mbp',

  /*
   * Near-closed and spread. A shallow slot with a band of teeth in it, which is
   * what all of these look like from the front once the tongue is discounted.
   *
   * `l` sits here rather than with the neutral openings, and against what the
   * note on `uh` in visemes.ts says, for a reason that only shows up across
   * languages: /l/ reaches us as viseme `l` from English and as viseme `t` from
   * French, Polish, Mandarin, Cantonese, Korean, Russian and Arabic. Split
   * between two poses, the same sound would change shape according to which
   * language table Polly happened to use — a difference with no counterpart in
   * anything the speaker did. They are better wrong together than inconsistent.
   *
   * `J` is the alveolo-palatal series, and it belongs here rather than with `S`
   * despite both being "sh-like" to an English ear. ʃ is protruded and rounded;
   * ɕ and t͡ɕ are made with the lips spread or neutral. Mandarin *xi* and *shi*
   * genuinely look different, and this is the pair that carries it.
   */
  t: 'ee',
  T: 'ee',
  J: 'ee',
  l: 'ee',
  s: 'ee',
  i: 'ee',
  e: 'ee',
  E: 'ee',

  /*
   * Half open, lips neither spread nor pursed. The neutral opening, and where
   * everything whose distinguishing feature is a tongue ends up — including the
   * French uvular ʁ, which Polly files under `k`.
   */
  k: 'uh',
  r: 'uh',
  '@': 'uh',

  /** Wide and unrounded. */
  a: 'aa',

  /*
   * Rounded. `S` is here rather than with the sibilants above, which is the one
   * place this table disagrees with what the analyser would have chosen.
   */
  S: 'oh',
  o: 'oh',
  O: 'oh',
  u: 'oh',
};

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
  ee: 0.45,
  uh: 0.5,
  aa: 0.95,
  oh: 0.8,
};

/** One viseme mark, as this file wants it rather than as Polly writes it. */
export interface VisemeMark {
  /** Milliseconds from the start of the utterance's audio, as Polly stamps it. */
  timeMs: number;
  /** What Polly said. Kept so a log can name the phoneme, not just the pose. */
  polly: PollyViseme;
  /** What the face wears for it. */
  viseme: Viseme;
}

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
