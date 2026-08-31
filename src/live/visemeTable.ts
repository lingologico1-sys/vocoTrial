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
 *
 * `st` is the newest, and the only one added because a *count* was wrong rather than
 * because a shape was missing. Measured over the three alignments in lipsync/assets, `ee`
 * was on screen for 41% of an English lesson and worn by half its marks, holding still
 * across three or more phonemes twenty-three times a minute — which is what a mouth that
 * does not look alive is, stated as a number. A quarter of those marks are `s` and `t`,
 * and moving them here roughly halves `ee`'s share for the cost of one image. It fires in
 * every language rather than only in English, because `t` is where French, Polish,
 * Mandarin, Cantonese, Korean, Russian and Arabic all send /l/.
 */
export type Viseme =
  | 'rest'
  | 'mbp'
  | 'fv'
  | 'st'
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
 * Two of Polly's distinctions are dropped because a flat patch cannot carry
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
 *   @     "barely open, relaxed" sits between `rest` and `uh`, nearer to each
 *         than they are to one another
 *
 * `t` and `T` were both on that list until `st` existed, and both were dropped on a
 * true premise that turned out not to be the whole one: the tongue is hidden behind
 * the upper teeth for /t/, and drawing it between them for /θ/ would lisp every /s/
 * that shares the pose. Neither claim is wrong. What both missed is that the *jaw* is
 * not hidden. /s z t d n/ and /θ ð/ alike are made with the teeth close to meeting,
 * and two rows of teeth nearly touching in a mouth drawn narrower is a shape a flat
 * patch carries perfectly well — see the `st` slot in facekit/slots.ts, written
 * against `ee` and `fv` on exactly that pair of cues. Together with `s` and `l` they
 * are a quarter of all marks.
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
   * The alveolars: teeth close to meeting, mouth narrowed rather than spread.
   *
   * `l` MOVED HERE WITH `t`, AND HAD TO. It used to sit with the spread poses
   * below, under a note that is worth restating because it is the whole argument:
   * /l/ reaches us as viseme `l` from English and as viseme `t` from French,
   * Polish, Mandarin, Cantonese, Korean, Russian and Arabic. Split between two
   * poses, the same sound would change shape according to which language table
   * Polly happened to use — a difference with no counterpart in anything the
   * speaker did — and they are better wrong together than inconsistent.
   *
   * That note was written when `t` and `l` both meant `ee`, so it held for free.
   * Moving `t` here and leaving `l` behind would have broken it in the one
   * direction it exists to forbid: an English "l" spread, a French "l" narrowed,
   * the same phoneme wearing two mouths for no reason a listener could point at.
   * So `l` comes along, and the phonetics agrees rather than merely tolerating it
   * — /l/ is alveolar, made in the same place as /t d n/, with the tongue tip on
   * the same ridge and the jaw about as close.
   *
   * THAT ARGUMENT IS ABOUT POLLY, AND ONLY POLLY, which is worth saying because it
   * reads like a claim about /l/ and is not one. It is a claim about *tables*: Polly's
   * per-language ones disagree with each other, so a pose split between `l` and `t`
   * would follow the voice rather than the speaker. Nothing of the sort is true on the
   * MFA path, where PHONE_TO_POLLY in lipsync/visemes.py sends every language's /l/ to
   * `l` outright and the split cannot arise. The destination stands on the sentence
   * above it, which is phonetics; the consistency argument is why it was never free to
   * be decided separately, not why it came out here.
   *
   * `T` JOINED LATER, CORRECTING A MISTAKE WORTH NAMING because it is an easy one to
   * make again. It was left with the spread poses on this argument: what `st` draws is
   * two rows of teeth nearly meeting, ð/θ is a tongue tip *between* them, and a visible
   * tongue on every "s" would be a lisp. Every clause of that is true, and it answers a
   * different question from the one being asked. It says what the `st` *artwork* may
   * contain. It says nothing about which existing pose ð/θ should be routed to, and no
   * tongue gets drawn anywhere either way.
   *
   * Asked properly — of the poses that exist, which is nearest? — it is not close. ð/θ
   * is dental: teeth together, jaw nearly shut, lips neutral, which is this drawing.
   * `ee` is spread wide with a dark strip under one band of teeth, which is its opposite.
   * A face saying "the", "this" or "with" was opening into a wide spread mouth.
   *
   * The cost is that θ and /s/ now share a pose, so "thin" and "sin" look alike. That is
   * a real loss and the smaller one: a learner watching this face to see how a sound is
   * made is better served by a mouth that is right and ambiguous than by one that is
   * distinct and wrong.
   */
  t: 'st',
  l: 'st',
  s: 'st',
  T: 'st',

  /*
   * Near-closed and spread. A shallow slot with a band of teeth in it, which is
   * what all of these look like from the front once the tongue is discounted.
   *
   * `J` is the alveolo-palatal series, and it belongs here rather than with `S`
   * despite both being "sh-like" to an English ear. ʃ is protruded and rounded;
   * ɕ and t͡ɕ are made with the lips spread or neutral. Mandarin *xi* and *shi*
   * genuinely look different, and this is the pair that carries it.
   *
   * `J` IS ALSO THE ONE THAT LOOKS LIKE IT SHOULD HAVE FOLLOWED `T` TO `st`, and must
   * not. The alveolo-palatals are teeth-close sibilants, so the narrow pose is tempting
   * on articulation alone. But `s` is already there, and Mandarin distinguishes *xi*
   * from *si*: moving `J` would hand both the same mouth. Left here, the two differ,
   * which is the whole reason this row exists.
   *
   * WHAT THAT DEFENDS IS HALF THE ROW, and the other half is a known wrong answer. The
   * argument above is about ɕ ʑ t͡ɕ d͡ʑ, which are sibilants and are spread. PHONE_TO_POLLY
   * also files ç ɲ ʝ and ɟʝ here — a palatal fricative, a palatal nasal, and Spanish's
   * two ways of writing the "y" of *yo* — none of which is a sibilant and none of which
   * spreads the lips at all. They are neutral, which is `uh`, and drawn here they are
   * given a wide toothy mouth on every Spanish *señor* and French *baigner*. Measured
   * over the three alignments in lipsync/assets that is 25 to 27 marks, a little over
   * 2%, nearly all of it Spanish.
   *
   * It stays wrong for now because the fix is not here. `J` is one identifier and the
   * split is between phones, so it has to happen in PHONE_TO_POLLY — which means a Modal
   * image rebuild and a re-alignment, and until recently could not reach a saved package
   * at all. Marks carry their `phone` now, so this is a mapping change with a replay
   * path rather than a one-way door; see the note on VisemeMark.phone below.
   */
  J: 'ee',
  i: 'ee',
  e: 'ee',

  /*
   * Half open, lips neither spread nor pursed. The neutral opening, and where
   * everything whose distinguishing feature is a tongue ends up — including the
   * French uvular ʁ, which Polly files under `k`.
   */
  k: 'uh',
  r: 'uh',
  '@': 'uh',

  /*
   * Wide and unrounded.
   *
   * `E` MOVED HERE FROM THE SPREAD POSES, and the argument is the jaw. Polly files
   * ash under its own identifier and nothing else with it, so `E` is /æ/ alone --
   * the one front vowel that is near-open. `ee` is written as a shallow slot whose
   * whole height is no more than the thickness of the upper lip, which is the wrong
   * aperture by a wide margin: a face saying "cat" or "back" barely parted its lips.
   *
   * What the move costs is the spread, because `aa` is drawn rounded rather than wide.
   * That is the smaller loss. Height is the more visible of the two cues at speaking
   * speed, and it is the one /æ/ actually has.
   */
  a: 'aa',
  E: 'aa',

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
  /**
   * The phone the aligner actually read, when one did.
   *
   * Provenance too, and the finer-grained half of it. `polly` is already one collapse
   * away from the recording -- /s/ and /z/ arrive as the same identifier, /ɛ/ and /e/
   * as the same one -- so a mark alone could never say which sound produced it, and
   * PHONE_TO_POLLY was a one-way door: reposed() below can replay a change to this
   * file against every stored package, but a change to the Python table could only be
   * applied by aligning the audio again, which a saved package has no path back to.
   *
   * Absent wherever `polly` is, and for the same reason: a laugh has no phone either.
   * Also absent on silence, which is a gap in the tier rather than a sound. Optional
   * besides because every package baked before the field existed simply has none.
   */
  phone?: string;
  /** What the face wears for it. */
  viseme: Viseme;
}

/**
 * Re-resolves stored marks against the table as it stands now.
 *
 * For packages, and only for packages. Both live parse paths — parseSpeechMarks in
 * polly.ts and parseMfaMarks in mfa.ts — derive `viseme` from `polly` on the way in, so
 * they are current by construction and never need this. A saved lipsync package is the
 * one place a pose is written down and kept, which means every package baked before a
 * mapping changed is carrying the old answer. Running them through here on load is what
 * lets `s` and `t` reach `st` without anybody rebaking a library.
 *
 * THE GUARD IS THE POINT. A mark with no `polly` was never selected by a phone — it is a
 * laugh or a smile, spliced in from an audio tag by lipsync/tags.ts, and there is nothing
 * to recompute it from. Recomputing those would not merely be wrong, it would be
 * destructive: `POLLY_VISEMES` has no entry to consult, so a laugh would resolve to
 * undefined and the mouth would go blank in the middle of laughter. They keep what they
 * were stored with, which is the only record of them there is.
 */
export const reposed = (marks: readonly VisemeMark[]): VisemeMark[] =>
  marks.map((mark) => (mark.polly ? { ...mark, viseme: POLLY_VISEMES[mark.polly] } : mark));
