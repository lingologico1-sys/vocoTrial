// The leaf, not polly.ts. This module is imported by functions/api/lipsync, which
// runs in a Worker; polly.ts reaches AudioContext through visemes.ts and would
// take the whole browser audio stack in with it. See visemeTable.ts.
// No POLLY_VISEMES here any more, and its absence is the point: a reaction has no
// phone, so there is nothing to collapse. This module names poses directly.
import type { Viseme, VisemeMark } from '../live/visemeTable';
import type { ExpressionSpan, LaughOptions } from './published';

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
  /** True of a laugh, which is performed rather than held. See laughMarks. */
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

  // Reactions, with the pose each span wears. Chosen for what the lips are doing and
  // nothing else — a drawn mouth cannot show a throat or a nose.
  { tag: '[laughs]', kind: 'reaction', group: 'Reactions', viseme: 'laugh', laughing: true },
  { tag: '[giggles]', kind: 'reaction', group: 'Reactions', viseme: 'laugh', laughing: true },
  { tag: '[gasps]', kind: 'reaction', group: 'Reactions', viseme: 'aa' },
  { tag: '[yawn]', kind: 'reaction', group: 'Reactions', viseme: 'aa' },
  { tag: '[panting]', kind: 'reaction', group: 'Reactions', viseme: 'aa' },
  // An exhale through a slack, half-open mouth. Neither rounded nor wide.
  { tag: '[sighs]', kind: 'reaction', group: 'Reactions', viseme: 'uh' },
  { tag: '[clears throat]', kind: 'reaction', group: 'Reactions', viseme: 'uh' },
  // Swallowing closes the lips; sniffing happens at the nose and leaves them alone.
  { tag: '[gulps]', kind: 'reaction', group: 'Reactions', viseme: 'mbp' },
  { tag: '[sniffs]', kind: 'reaction', group: 'Reactions', viseme: 'rest' },

  // Pacing. The first three are silence, which the aligner handles correctly unaided.
  { tag: '[pause]', kind: 'pause', group: 'Pacing' },
  { tag: '[long pause]', kind: 'pause', group: 'Pacing' },
  { tag: '[continues after a beat]', kind: 'pause', group: 'Pacing' },
  // These two are filed as reactions despite sounding like pacing, because they add
  // sound rather than silence: a stammer repeats a syllable the transcript has once,
  // and a hesitation fills the gap with something wordlike. Both leave audio MFA has no
  // text for, which is the definition of the hazard above.
  { tag: '[hesitates]', kind: 'reaction', group: 'Pacing', viseme: 'uh' },
  { tag: '[stammers]', kind: 'reaction', group: 'Pacing', viseme: 'uh' },
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
/** What the jaw comes back to between pulses — half open, not shut. */
const LAUGH_REBOUND: Viseme = 'uh';
/**
 * A span shorter than this gets no lead-in smile.
 *
 * A face smiles a beat before it laughs, and an expression arriving with the sound
 * reads as a flinch. But a short giggle that smiled first would spend most of itself
 * arriving, so the beat is only worth it when there is a laugh left after it.
 */
export const SMILE_LEAD_MIN_MS = 420;
/** How long that beat lasts. Long enough to register, short enough not to delay. */
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
 * The marks one span is performed with.
 *
 * A laugh pulses; everything else is a single held shape, because a sigh or a swallow
 * genuinely is one. The pulse alternates the laugh pose with a half-open rebound rather
 * than a closed one — a laugh does not shut the mouth between syllables, and MarkMouth's
 * easing means neither extreme is fully reached anyway, so the visible result is a jaw
 * moving rather than a shape flickering.
 */
function performSpan(span: Span, options: LaughOptions): VisemeMark[] {
  const marks: VisemeMark[] = [];
  let at = span.startMs;

  if (span.laughing && options.smileLeadIn && span.endMs - span.startMs >= SMILE_LEAD_MIN_MS) {
    marks.push({ timeMs: at, viseme: 'smile' });
    at += SMILE_LEAD_MS;
  }

  if (!span.laughing) {
    marks.push({ timeMs: at, viseme: span.viseme });
    return marks;
  }

  for (let i = 0; at < span.endMs; i++) {
    marks.push({ timeMs: at, viseme: i % 2 === 0 ? span.viseme : LAUGH_REBOUND });
    at += LAUGH_PULSE_MS;
  }
  return marks;
}

/** Where the eyes and head do something, given what the author asked for. */
export function expressionSpans(
  spans: readonly Span[],
  options: LaughOptions,
): ExpressionSpan[] {
  if (!options.closeEyes && !options.nod) return [];
  return spans
    .filter((s) => s.laughing)
    .map((s) => ({
      startMs: s.startMs,
      endMs: s.endMs,
      eyesClosed: options.closeEyes || undefined,
      nod: options.nod || undefined,
    }));
}

export function overlayReactions(
  marks: readonly VisemeMark[],
  spans: readonly Span[],
  options: LaughOptions,
): VisemeMark[] {
  if (spans.length === 0) return [...marks];

  const inside = (ms: number) => spans.some((s) => ms >= s.startMs && ms < s.endMs);
  const out: VisemeMark[] = marks.filter((m) => !inside(m.timeMs));

  for (const span of spans) {
    out.push(...performSpan(span, options));

    // What was in force when the reaction began is what the mouth returns to, unless a
    // real mark already lands at that instant. The last mark before the span STARTED,
    // not before it ended: searching to the end would find one of the marks just
    // dropped, from inside the span, where the aligner was fitting words to a laugh.
    if (!marks.some((m) => m.timeMs === span.endMs)) {
      const before = [...marks].reverse().find((m) => m.timeMs <= span.startMs);
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
