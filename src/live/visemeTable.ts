/**
 * The vocabulary: what a mouth can be, and which of Polly's names maps onto which.
 *
 * A LEAF ON PURPOSE. Nothing here imports anything, and that is the property the file
 * exists for rather than an accident of it being small. Three very different things need
 * this table and none of them can reach the others:
 *
 *   the page          draws the poses, and lives in a browser
 *   functions/api/lipsync  assembles packages, and lives in a Worker with no DOM at all
 *   lipsync/polly.py  parses this file, and is Python
 *
 * It used to live in polly.ts beside MarkMouth, which was the natural place for it right
 * up until a Worker needed it: polly.ts imports visemes.ts, which imports realtime/audio,
 * which is AudioContext and AnalyserNode. A Worker asking what /S/ draws as was therefore
 * asking for a browser audio stack, and the functions build failed saying so. Moving the
 * words down here rather than giving a Worker DOM types is the honest fix -- the table
 * never needed any of that, it was only sitting next to something that did.
 *
 * polly.ts re-exports all of it, so nothing that used to import from there had to change.
 */

/**
 * The poses a facekit contains. facekit/slots.ts keys its slots on this.
 *
 * `laugh` is the one no phone ever selects, and the only member POLLY_VISEMES never
 * produces. It exists because a laugh is not a speech sound: nothing in a transcript
 * says it, no dictionary lists it, and the aligner has no phone for it. It is chosen
 * from an audio tag instead, which is why a mark can carry a pose without carrying a
 * Polly identifier — see VisemeMark below.
 *
 * It is `aa` with the corners lifted. `aa` alone is a dropped jaw with corners level,
 * which reads as alarm rather than delight; `smile` has the corners but is closed-lipped
 * by design, and a closed-mouth laugh is a stifled one. Neither existing pose is this.
 *
 * `smile` joins for a different reason and at no cost. It was always a slot in
 * facekit/slots.ts — every published kit already has the artwork — but it was reachable
 * only through a boolean on Face, scheduled for idle moments. Naming it here lets a mark
 * select it, which is what a laugh needs: a face smiles a beat before it laughs, and an
 * expression that arrives at the same instant as the sound reads as a flinch.
 */
export type Viseme =
  | 'rest'
  | 'mbp'
  | 'fv'
  | 'ee'
  | 'uh'
  | 'aa'
  | 'oh'
  | 'laugh'
  | 'smile';

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

/** One viseme mark, as this file wants it rather than as Polly writes it. */
export interface VisemeMark {
  /** Milliseconds from the start of the utterance's audio, as Polly stamps it. */
  timeMs: number;
  /**
   * What Polly said, when anything did.
   *
   * Optional because not every mark comes from a sound. A laugh is chosen from an audio
   * tag: no phone produced it, no dictionary lists it, and inventing an identifier to
   * satisfy the field would be a lie a log would later repeat. `viseme` is what the
   * mouth actually reads; this is provenance.
   */
  polly?: PollyViseme;
  /** What the face wears for it. */
  viseme: Viseme;
}
