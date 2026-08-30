// The leaf, not polly.ts. This module is imported by functions/api/lipsync, which
// runs in a Worker; polly.ts reaches AudioContext through visemes.ts and would
// take the whole browser audio stack in with it. See visemeTable.ts.
// No POLLY_VISEMES here any more, and its absence is the point: a reaction has no
// phone, so there is nothing to collapse. This module names poses directly.
import type { Viseme, VisemeMark } from '../live/visemeTable';
import type { ExpressionSpan, ReactionOptions } from './published';

/**
 * ElevenLabs v3 audio tags, sorted by what they do to a forced alignment.
 *
 * The palette is one list to a person writing a line and three quite different things to
 * an aligner, and the difference decides whether a tag is free, helpful, or a hazard.
 *
 *   directive  [happy] [whispering] [slowly] — change how the words are said and add no
 *              audio of their own. Strip them from the transcript and alignment is
 *              untouched. Free.
 *
 *   pause      [pause] [long pause] — insert silence. MFA does not label silence; it
 *              leaves a hole in the phone tier, and to_marks already turns a hole into
 *              `sil`. So these close the mouth correctly without anything extra. They are
 *              the case that exposed the freeze-open bug in the first place.
 *
 *   reaction   [laughs] [sighs] [gasps] — audio with no words in it. This is the hazard.
 *              MFA is handed a transcript saying nothing happened there, so it stretches
 *              the surrounding words across the laugh to account for the time, and the
 *              mouth is then wrong on both sides of it as well as during.
 *
 * WHAT FIXES THE HAZARD is something we already had and were only using for verification.
 * ElevenLabs' character timestamps cover the tag's own characters, so the span a reaction
 * occupies is known exactly. `overlayReactions` replaces the marks inside that span with
 * a pose chosen for the reaction and leaves the marks either side alone.
 *
 * It is a heuristic and worth saying so: a laugh is not one pose held for a second. It is
 * better than words smeared across it, which is the bar, and it is at least honest about
 * which span it covers, because the span is measured rather than guessed.
 */

export type TagKind = 'directive' | 'pause' | 'reaction';

export interface Tag {
  /** Exactly as it must appear in the text, brackets included. */
  tag: string;
  kind: TagKind;
  /** Which group the picker files it under. */
  group: 'Emotions' | 'Delivery' | 'Reactions' | 'Pacing';
  /**
   * For reactions only: the pose its span wears.
   *
   * A drawn pose rather than a Polly identifier, and that is a change from how this
   * table started. Emitting identifiers was right while every mark came from a phone,
   * because it kept POLLY_VISEMES the only place the collapse onto artwork happened.
   * A reaction has no phone — nothing in any transcript says a laugh — so there is
   * nothing to collapse, and naming the pose directly is the honest form.
   */
  viseme?: Viseme;
  /**
   * How the span is played, for reactions.
   *
   *   hold   one shape for the whole span. Right when the body really does hold still:
   *          a gasp snaps open and stays open, a gulp keeps the lips shut throughout.
   *   pulse  alternates with `rebound`. For anything rhythmic — a laugh, panting —
   *          where one held shape reads as a scream rather than as breathing.
   *   arc    `edge`, then the main pose, then `edge` again. For anything with a shape
   *          over time: a yawn opens slowly and closes slowly, a sigh parts and trails
   *          shut. Holding the middle of one of those loses the whole gesture.
   */
  perform?: 'hold' | 'pulse' | 'arc';
  /** Where a pulse falls back to between beats. */
  rebound?: Viseme;
  /** Where an arc begins and ends. */
  edge?: Viseme;
  /** Half a pulse, in ms. Panting is quicker than laughing. */
  pulseMs?: number;
  /**
   * What the eyes do, decided by the body rather than by preference.
   *
   * `none` is a real answer and not an omission — a gasp WIDENS the eyes, and there is
   * no wide-eye artwork in any kit, so shutting them would be worse than leaving them
   * alone. Written out for every reaction so that the absence is visibly deliberate.
   */
  eyes?: 'closed' | 'blink' | 'none';
  /** True of a laugh, which is the only thing a smile precedes. */
  laughing?: boolean;
}

const directive = (group: Tag['group']) => (tag: string): Tag => ({
  tag,
  kind: 'directive',
  group,
});

export const TAGS: Tag[] = [
  // Emotions and delivery are pure direction: no audio of their own, so no risk.
  ...['[happy]', '[sad]', '[angry]', '[excited]', '[nervous]', '[curious]',
    '[frustrated]', '[calm]', '[terrified]', '[bored]'].map(directive('Emotions')),
  ...['[whispering]', '[shouting]', '[quietly]', '[loudly]', '[rushed]', '[slowly]',
    '[flatly]', '[monotone]', '[dramatic]', '[warmly]'].map(directive('Delivery')),

  // Reactions. Each carries how it is played and what the eyes do, both chosen from
  // what the body actually does rather than from what is convenient.
  //
  // A laugh: rhythmic, eyes screwed up, and the only one a smile precedes.
  { tag: '[laughs]', kind: 'reaction', group: 'Reactions', viseme: 'laugh',
    perform: 'pulse', rebound: 'uh', eyes: 'closed', laughing: true },
  { tag: '[giggles]', kind: 'reaction', group: 'Reactions', viseme: 'laugh',
    perform: 'pulse', rebound: 'uh', eyes: 'closed', laughing: true },

  // Panting is the other rhythmic one, and quicker: breaths, not syllables. Held open
  // it is the same frozen scream a held laugh was.
  { tag: '[panting]', kind: 'reaction', group: 'Reactions', viseme: 'aa',
    perform: 'pulse', rebound: 'uh', pulseMs: 85, eyes: 'none' },

  // A yawn is slow open, long hold, slow close — and the eyes are half of what makes
  // one recognisable. Held `aa` with the eyes open gets the shape and misses the yawn.
  { tag: '[yawn]', kind: 'reaction', group: 'Reactions', viseme: 'aa',
    perform: 'arc', edge: 'uh', eyes: 'closed' },

  // A sigh has a shape over time: the lips part, hold, and trail shut. The blink is
  // what a sigh looks like as much as the mouth is.
  { tag: '[sighs]', kind: 'reaction', group: 'Reactions', viseme: 'uh',
    perform: 'arc', edge: 'rest', eyes: 'blink' },

  // A gasp snaps open and STAYS open — the one place a held pose is literally correct.
  // Eyes deliberately left alone: a gasp widens them, and no kit has wide-eye artwork,
  // so shutting them would be actively wrong rather than merely incomplete.
  { tag: '[gasps]', kind: 'reaction', group: 'Reactions', viseme: 'aa',
    perform: 'hold', eyes: 'none' },

  // Lips slightly parted, the sound made in the throat, and over quickly.
  { tag: '[clears throat]', kind: 'reaction', group: 'Reactions', viseme: 'uh',
    perform: 'hold', eyes: 'none' },

  // Swallowing keeps the lips shut. The throat does the work and a portrait has no
  // throat, so a closed mouth is not an approximation — it is all there is.
  { tag: '[gulps]', kind: 'reaction', group: 'Reactions', viseme: 'mbp',
    perform: 'hold', eyes: 'none' },

  // A sniff is nasal, and `rest` was the worst answer in the table: indistinguishable
  // from saying nothing. Compressed lips and a blink is what one looks like from the
  // front, the nose being the part a drawing cannot move.
  { tag: '[sniffs]', kind: 'reaction', group: 'Reactions', viseme: 'mbp',
    perform: 'hold', eyes: 'blink' },

  // Pacing. The first three are silence, which the aligner handles correctly unaided.
  { tag: '[pause]', kind: 'pause', group: 'Pacing' },
  { tag: '[long pause]', kind: 'pause', group: 'Pacing' },
  { tag: '[continues after a beat]', kind: 'pause', group: 'Pacing' },
  // These two are filed as reactions despite sounding like pacing, because they add
  // sound rather than silence: a stammer repeats a syllable the transcript has once,
  // and a hesitation fills the gap with something wordlike. Both leave audio MFA has no
  // text for, which is the definition of the hazard above.
  { tag: '[hesitates]', kind: 'reaction', group: 'Pacing', viseme: 'uh',
    perform: 'hold', eyes: 'none' },
  { tag: '[stammers]', kind: 'reaction', group: 'Pacing', viseme: 'uh',
    perform: 'hold', eyes: 'none' },
];

const BY_TAG = new Map(TAGS.map((t) => [t.tag.toLowerCase(), t]));

/** Any bracketed run, whether or not it is a tag this build knows. */
const BRACKETED = /\[[^\]\n]*\]/g;

/**
 * The text with every tag removed, which is what the aligner is given.
 *
 * Unknown bracketed runs are stripped too. A tag this build has not heard of is still
 * not a word anybody said, and leaving it in would put a literal "[sobbing]" into the
 * transcript for MFA to look up, fail to find, and align as silence — shutting the mouth
 * across a word that really was spoken beside it.
 */
export function stripTags(text: string): string {
  return text
    .replace(BRACKETED, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .trim();
}

/** The reaction tags a line uses, which are the ones that cost alignment accuracy. */
export function reactionsIn(text: string): Tag[] {
  const found = text.match(BRACKETED) ?? [];
  return found
    .map((raw) => BY_TAG.get(raw.toLowerCase()))
    .filter((t): t is Tag => t?.kind === 'reaction');
}

export interface Span {
  startMs: number;
  endMs: number;
  viseme: Viseme;
  perform: NonNullable<Tag['perform']>;
  rebound: Viseme;
  edge: Viseme;
  pulseMs: number;
  eyes: NonNullable<Tag['eyes']>;
  laughing: boolean;
}

/**
 * How a laugh is performed, rather than held.
 *
 * A laugh is not one shape for a second. It is a jaw pulsing at roughly the rate of
 * speech syllables, and holding a single open pose across the whole span looks less like
 * laughter than a scream that will not end. These are the two numbers that make the
 * difference, and neither is tuned to a particular clip.
 */
/** Half a pulse. ~4.5Hz, which is where a laugh sits and a little under speech. */
const LAUGH_PULSE_MS = 110;
/**
 * How long an arc spends arriving and leaving.
 *
 * The point of an arc is the *closing*: a yawn that stays wide open until the instant a
 * word begins hands the next syllable a mouth already at full stretch. Ramping out also
 * gives the easing something to work with, so the shape moves rather than snapping.
 */
const ARC_EDGE_MS = 160;
/** Below this an arc has no room for edges and is simply held. */
const ARC_MIN_MS = 2 * ARC_EDGE_MS + 120;
/** How long a blink lasts. Matches what a real one takes, and Face's own BLINK_MS. */
const BLINK_MS = 160;
/**
 * A span shorter than this gets no lead-in smile.
 *
 * A face smiles a beat before it laughs, and an expression arriving with the sound
 * reads as a flinch. A very short giggle still gets none: the beat is a piece of
 * anticipation, and anticipating something already over reads as a twitch rather than
 * as a laugh being wound up.
 *
 * The original reason was different and no longer applies — the beat used to be spent
 * inside the span, so a short giggle "would spend most of itself arriving". It is spent
 * before the span now, for the reason under SMILE_LEAD_MS, and costs the laugh nothing.
 * The gate is kept on the new grounds rather than removed with the old ones.
 */
export const SMILE_LEAD_MIN_MS = 420;
/**
 * How long that beat lasts, and — the part that was wrong — where it is spent.
 *
 * BEFORE THE SPAN, NOT INSIDE IT. The first draft placed the smile at `span.startMs`
 * and pushed the laugh to `startMs + SMILE_LEAD_MS`, which is not what "a beat before"
 * describes: the audible laugh began on time and the mouth began laughing 130ms late.
 * That is video lagging audio by more than lip-sync survives, and self-inflicted — the
 * span timings were measured, correct, and then moved.
 *
 * Anticipation has to come out of the silence in front of the laugh, because that is
 * where a real one takes it from. So the smile is stamped at `startMs - SMILE_LEAD_MS`
 * and the laugh still lands exactly on its sound. What this costs is the window of
 * speech before the tag, which overlayReactions now clears — see LEAD_CLEARED there.
 */
const SMILE_LEAD_MS = 130;

/**
 * Where each reaction tag sits in the audio, read off the character timings.
 *
 * Walks the characters ElevenLabs stamped rather than the source string, because they
 * are the same sequence and only one of them carries times. A bracket that never closes
 * is dropped rather than guessed at.
 */
export function reactionSpans(
  characters: readonly string[],
  starts: readonly number[],
  ends: readonly number[],
): Span[] {
  const spans: Span[] = [];
  let open = -1;

  for (let i = 0; i < characters.length; i++) {
    if (characters[i] === '[') {
      open = i;
    } else if (characters[i] === ']' && open >= 0) {
      const tag = BY_TAG.get(characters.slice(open, i + 1).join('').toLowerCase());
      if (tag?.kind === 'reaction' && tag.viseme) {
        spans.push({
          startMs: Math.round(starts[open] * 1000),
          endMs: Math.round(ends[i] * 1000),
          viseme: tag.viseme,
          perform: tag.perform ?? 'hold',
          rebound: tag.rebound ?? 'uh',
          edge: tag.edge ?? 'rest',
          pulseMs: tag.pulseMs ?? LAUGH_PULSE_MS,
          eyes: tag.eyes ?? 'none',
          laughing: tag.laughing === true,
        });
      }
      open = -1;
    }
  }
  return spans;
}

/**
 * Marks with each reaction span overwritten by the pose that reaction wears.
 *
 * Everything MFA said inside a span is dropped, because inside a span MFA was aligning
 * words to audio that has none. Everything outside is kept exactly as it was: the words
 * either side really were spoken, and really were measured.
 *
 * A closing mark is put at the end of each span so that whatever follows resumes from
 * the right pose rather than inheriting the reaction's.
 */
/**
 * The lead-in each span gets, in order, most of them zero.
 *
 * Derived once for the whole utterance and handed to everything that needs it, rather
 * than recomputed per span. performSpan stamps the smile and overlayReactions clears the
 * window it occupies; two places deriving the same number independently is how they
 * drift, and a drift here is a speech mark surviving inside the lead-in and simply
 * overwriting it.
 *
 * IT NEEDS ROOM THAT IS NOT ALREADY A REACTION, which is the whole reason this takes
 * the list rather than one span. A beat spent before the laugh has to come out of
 * something, and the only thing it can come out of is quiet: "[giggles] [giggles]"
 * puts two spans back to back, and a second giggle that anticipates itself reaches
 * backwards into the first one and drops a closed mouth into the middle of a laugh
 * already in progress. Nothing about that is anticipation. The face is laughing; there
 * is nothing left to anticipate.
 *
 * ALL OF IT OR NONE OF IT. A beat with only part of its room available is not a
 * shortened gesture, it is a flicker — the patch fades in over SMILE_MARK_IN_MS and a
 * lead-in shorter than that never finishes arriving before it is told to leave. So the
 * room is a threshold and not a clamp, which also covers the utterance that opens on a
 * laugh: no quiet in front of it, no lead-in, rather than a smile crushed into whatever
 * milliseconds happen to precede it.
 */
function leadIns(spans: readonly Span[], options: ReactionOptions): number[] {
  return spans.map((span, i) => {
    if (!span.laughing || !options.smileLeadIn) return 0;
    if (span.endMs - span.startMs < SMILE_LEAD_MIN_MS) return 0;
    // Start of the recording counts as quiet, so span 0 measures against zero.
    const quiet = span.startMs - (i > 0 ? spans[i - 1].endMs : 0);
    return quiet >= SMILE_LEAD_MS ? SMILE_LEAD_MS : 0;
  });
}

/**
 * The marks one span is performed with.
 *
 * A laugh pulses; everything else is a single held shape, because a sigh or a swallow
 * genuinely is one. The pulse alternates the laugh pose with a half-open rebound rather
 * than a closed one — a laugh does not shut the mouth between syllables, and MarkMouth's
 * easing means neither extreme is fully reached anyway, so the visible result is a jaw
 * moving rather than a shape flickering.
 */
function performSpan(span: Span, leadMs: number): VisemeMark[] {
  const marks: VisemeMark[] = [];
  // Not const: the pulse loop below walks it to the end of the span.
  let at = span.startMs;

  // A smile before a laugh, on a span leadIns judged has room for one. Nothing else is
  // preceded by an expression, because nothing else is anticipated the way a laugh is.
  // It is stamped ahead of the span and `at` does not move: the beat comes out of the
  // quiet in front of the laugh, never out of the laugh. See SMILE_LEAD_MS.
  if (leadMs > 0) marks.push({ timeMs: at - leadMs, viseme: 'smile' });

  const length = span.endMs - at;

  if (span.perform === 'pulse') {
    for (let i = 0; at < span.endMs; i++) {
      marks.push({ timeMs: at, viseme: i % 2 === 0 ? span.viseme : span.rebound });
      at += span.pulseMs;
    }
    return marks;
  }

  if (span.perform === 'arc' && length >= ARC_MIN_MS) {
    marks.push({ timeMs: at, viseme: span.edge });
    marks.push({ timeMs: at + ARC_EDGE_MS, viseme: span.viseme });
    marks.push({ timeMs: span.endMs - ARC_EDGE_MS, viseme: span.edge });
    return marks;
  }

  // Held, and also what a too-short arc becomes: an arc with no room for its edges is
  // just its middle, and faking one would put three marks inside 200ms that the easing
  // could never resolve into a gesture.
  marks.push({ timeMs: at, viseme: span.viseme });
  return marks;
}

/** Where the eyes and head do something, given what the author asked for. */
export function expressionSpans(
  spans: readonly Span[],
  options: ReactionOptions,
): ExpressionSpan[] {
  if (!options.eyes) return [];

  return spans
    .filter((s) => s.eyes !== 'none')
    .map((s) => ({
      startMs: s.startMs,
      // A blink is the same flag over a short span. Clamped to the span so a blink on a
      // reaction shorter than a blink does not outlast the thing that caused it.
      endMs:
        s.eyes === 'blink'
          ? Math.min(s.endMs, s.startMs + BLINK_MS)
          : s.endMs,
      eyesClosed: true,
      // Recorded rather than derived later, because by playback time the tag that
      // caused the span is gone and only its timings remain.
      laughing: s.laughing ? true : undefined,
      nod: options.nod && s.laughing ? true : undefined,
    }));
}

/**
 * Which of a package's expression spans are a laugh screwing its eyes up.
 *
 * A playback-time question, and deliberately not the same one `ReactionOptions.eyes`
 * answers. That flag decides whether the eyes move at all and is settled before the
 * voice is ever synthesised, so changing it costs a fresh take from ElevenLabs — and on
 * `eleven_v3` a fresh take is a different performance, not the same line with its eyes
 * open. This answers the narrower question the note on that flag singles out, about a
 * package that already exists.
 *
 * Two sources, in order:
 *
 *   the flag   Spans built since `ExpressionSpan.laughing` existed simply say.
 *   the text   Older ones do not, and are matched positionally instead. That is exact
 *              rather than a guess: `expressionSpans` keeps the reaction spans that
 *              have eyes in source order, and `reactionsIn` reads the same tags out of
 *              the same string in the same order, so the nth span is the nth such tag.
 *              The zip is trusted only when the two lengths agree; if they disagree the
 *              package is not what this function believes it is, and it says no rather
 *              than opening the eyes of whichever reaction happens to line up.
 */
export function laughEyeSpans(
  expressions: readonly ExpressionSpan[],
  text: string,
): boolean[] {
  if (expressions.some((e) => e.laughing !== undefined)) {
    return expressions.map((e) => e.laughing === true);
  }
  const tags = reactionsIn(text).filter((t) => (t.eyes ?? 'none') !== 'none');
  if (tags.length !== expressions.length) return expressions.map(() => false);
  return tags.map((t) => t.laughing === true);
}

/**
 * The same spans with the laughs' eyes left open.
 *
 * Non-destructive by construction: it takes the stored expressions and returns new ones,
 * so the package keeps what it was generated with and the choice stays a checkbox.
 */
export function withLaughEyesOpen(
  expressions: readonly ExpressionSpan[],
  text: string,
): ExpressionSpan[] {
  const laughs = laughEyeSpans(expressions, text);
  return (
    expressions
      // Only the lids are being argued about, so only the lids are cleared — a laugh
      // span can carry `nod` as well, and dropping the whole span would silently drop
      // that too. A span left with nothing at all to say is then dropped, rather than
      // handed on as an empty window for the face to evaluate every frame.
      .map((e, i) => (laughs[i] ? { ...e, eyesClosed: undefined } : e))
      .filter((e) => e.eyesClosed || e.nod)
  );
}

export function overlayReactions(
  marks: readonly VisemeMark[],
  spans: readonly Span[],
  options: ReactionOptions,
): VisemeMark[] {
  if (spans.length === 0) return [...marks];

  // LEAD_CLEARED. A span covers its own audio, and for a laugh with a lead-in it also
  // covers the beat of silence in front of it. Both windows have to be cleared of real
  // marks, and for the same reason at two removes: inside the span MFA was fitting words
  // to audio that has none, and inside the lead-in it was fitting them to the last of
  // the speech before the tag — real, but about to be overruled by an expression. A word
  // mark left standing there sorts after the smile and simply overwrites it, which is
  // the lead-in silently not happening rather than the lead-in looking wrong.
  const leads = leadIns(spans, options);
  const gesture = spans.map((s, i) => ({ from: s.startMs - leads[i], to: s.endMs }));
  const inside = (ms: number) => gesture.some((g) => ms >= g.from && ms < g.to);
  const out: VisemeMark[] = marks.filter((m) => !inside(m.timeMs));

  for (const [i, span] of spans.entries()) {
    out.push(...performSpan(span, leads[i]));

    // What was in force when the reaction began is what the mouth returns to, unless a
    // real mark already lands at that instant. The last mark before the GESTURE started
    // — the lead-in smile included — for the reason searching to the end would be wrong:
    // anything later is one of the marks just dropped, and resuming into a pose that was
    // suppressed for being about to be overruled puts it back after the fact.
    if (!marks.some((m) => m.timeMs === span.endMs)) {
      const before = [...marks].reverse().find((m) => m.timeMs <= gesture[i].from);
      out.push({
        timeMs: span.endMs,
        polly: before?.polly,
        viseme: before?.viseme ?? 'rest',
      });
    }
  }

  out.sort((a, b) => a.timeMs - b.timeMs);
  // Collapsed on the drawn pose rather than the identifier, because an overlay can butt
  // a pose against an identical one and because a laugh mark has no identifier at all.
  return out.filter((m, i) => i === 0 || m.viseme !== out[i - 1].viseme);
}
