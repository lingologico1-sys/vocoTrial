import assert from 'node:assert/strict';
import { Mp3Encoder } from '@breezystack/lamejs';
import { scanMp3 } from '../functions/api/lipsync/_mp3.ts';
import { silence } from '../functions/api/lipsync/generate.ts';
import { addRoom, roomWarnings } from '../src/lipsync/warnings.ts';
import {
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  gainFromDb,
  suggestedGainDb,
} from '../src/lipsync/audioTrim.ts';
import {
  chosenFor,
  eligible,
  pick,
  preferredFor,
  treatmentOf,
  type ReactionLibraryIndex,
  type ReactionRender,
  type ReactionSource,
} from '../src/lipsync/laughs.ts';
import {
  REACTION_CLIP_KINDS,
  TAGS,
  clipKindOf,
  clipSpan,
  clipTimeMs,
  tagForKind,
  splitClips,
  type ReactionClipKind,
} from '../src/lipsync/tags.ts';

const source = (
  id: string,
  gender?: 'male' | 'female',
  kind: ReactionClipKind = 'laughs',
): ReactionSource => ({
  id,
  createdAt: 1,
  kind,
  gender,
  label: id,
  durationMs: 500,
  bytes: 100,
});
const render = (
  id: string,
  sourceId: string | undefined,
  treatment: ReactionRender['treatment'],
  voiceId?: string,
  kind: ReactionClipKind = 'laughs',
): ReactionRender => ({
  id,
  sourceId,
  treatment,
  voiceId,
  createdAt: 1,
  kind,
  label: id,
  durationMs: 500,
  bytes: 100,
});

const female = source('female', 'female');
const male = source('male', 'male');
const legacy = source('legacy');
const library: ReactionLibraryIndex = {
  sources: [female, male, legacy],
  renders: [
    render('female-original', female.id, 'original'),
    render('female-voice', female.id, 'voice-converted', 'voice-f'),
    render('male-original', male.id, 'original'),
    render('legacy-voice', legacy.id, undefined, 'voice-f'),
    render('harvested', undefined, undefined, 'voice-f'),
  ],
};

assert.deepEqual(
  eligible(library, 'laughs', 'other-female', 'female').map((clip) => clip.id),
  ['female-original'],
  'matching-gender originals are shared with every voice in the pool',
);
assert.deepEqual(
  eligible(library, 'laughs', 'voice-f', 'female').map((clip) => clip.id),
  ['female-voice', 'legacy-voice', 'harvested'],
  'an exact conversion supersedes its original while legacy exact-voice clips survive',
);
assert.deepEqual(
  eligible(library, 'laughs', 'voice-f', 'male').map((clip) => clip.id),
  ['male-original', 'legacy-voice', 'harvested'],
  'opposite-gender originals stay out while legacy exact-voice clips remain compatible',
);

female.preferredTreatmentByVoice = { 'voice-f': 'original' };
assert.equal(
  pick(library, 'laughs', 'voice-f', 'female', () => 0)?.id,
  'female-original',
  'the explicit original preference wins for one voice',
);
delete female.preferredTreatmentByVoice;

// --- the table is the kind set ---------------------------------------------------------
//
// REACTION_CLIP_KINDS is derived from TAGS while the union is written by hand, so this is
// the one moment the two could disagree. Adding a kind to the union and forgetting the
// table flag, or the reverse, is caught here rather than as a tag that silently does
// nothing.
assert.deepEqual(
  [...REACTION_CLIP_KINDS].sort(),
  ['clears throat', 'gasps', 'giggles', 'gulps', 'laughs', 'sighs', 'sniffs', 'yawn'],
  'the derived kind set matches the ReactionClipKind union',
);
for (const kind of REACTION_CLIP_KINDS) {
  // A clip builds its face span from this table, so a row with no pose is a reaction that
  // splices audio and draws nothing.
  assert.ok(
    clipSpan(kind, 0, 500),
    `[${kind}] has a viseme, so a spliced clip has a pose to wear`,
  );
  assert.equal(clipKindOf(`[${kind}]`), kind, `[${kind}] round-trips through clipKindOf`);
}
assert.equal(clipKindOf('[whispering]'), null, 'a directive is not a clip kind');
assert.equal(clipKindOf('[panting]'), null, 'a reaction without a clip flag is not one');
assert.equal(clipKindOf('  [CLEARS THROAT] '), 'clears throat', 'case and space forgiven');
for (const tag of TAGS) {
  if (!tag.clip) continue;
  assert.equal(tag.kind, 'reaction', `${tag.tag} is a reaction if it is spliceable`);
}

// --- per-kind treatment defaults -------------------------------------------------------
assert.equal(preferredFor('laughs'), 'voice-converted', 'a laugh carries timbre worth converting');
assert.equal(preferredFor('gulps'), 'original', 'a throat click has nothing for a speech model');
assert.equal(preferredFor('yawn'), 'voice-converted', 'a yawn is voiced and sustained');

const sniffLib: ReactionLibraryIndex = {
  sources: [source('s-sniff', 'female', 'sniffs')],
  renders: [
    render('sniff-original', 's-sniff', 'original', undefined, 'sniffs'),
    render('sniff-voice', 's-sniff', 'voice-converted', 'voice-f', 'sniffs'),
  ],
};
assert.deepEqual(
  eligible(sniffLib, 'sniffs', 'voice-f', 'female').map((c) => c.id),
  ['sniff-original'],
  'a sniff prefers the recording even where an exact conversion exists',
);
assert.deepEqual(
  eligible(sniffLib, 'laughs', 'voice-f', 'female').map((c) => c.id),
  [],
  'kinds do not stand in for one another',
);

// A kind whose preferred treatment has not been rendered still plays the other one, rather
// than falling through to nothing.
const yawnLib: ReactionLibraryIndex = {
  sources: [source('s-yawn', 'female', 'yawn')],
  renders: [render('yawn-original', 's-yawn', 'original', undefined, 'yawn')],
};
assert.deepEqual(
  eligible(yawnLib, 'yawn', 'voice-f', 'female').map((c) => c.id),
  ['yawn-original'],
  'a preference for a conversion nobody rendered falls back to the recording',
);

// --- anchors and source order ------------------------------------------------------------
const split = splitClips('one [sighs] [yawn] two', REACTION_CLIP_KINDS);
assert.deepEqual(
  split.clips.map((c) => [c.kind, c.wordsBefore, c.index]),
  [['sighs', 1, 0], ['yawn', 1, 1]],
  'adjacent tags share an anchor and are told apart by source order alone',
);
assert.equal(split.spoken, 'one two', 'the lifted tags leave the words behind');

const words = [
  { startMs: 0, endMs: 300 },
  { startMs: 800, endMs: 1100 },
];
const mid = clipTimeMs(split.clips[0], 2, words, 1100);
assert.deepEqual(mid, { atMs: 550, gapMs: 500 }, 'the midpoint of the gap, and the gap');

const runOn = clipTimeMs(split.clips[0], 2, [
  { startMs: 0, endMs: 300 },
  { startMs: 300, endMs: 600 },
], 600);
assert.deepEqual(runOn, { atMs: 300, gapMs: 0 }, 'two words run together leave no room');

assert.equal(
  clipTimeMs({ kind: 'sighs', tag: '[sighs]', wordsBefore: 0, index: 0 }, 2, words, 1100).gapMs,
  0,
  'the start of a take reports no gap rather than a measured one',
);

// --- the panel and the generator resolve through one function ----------------------------
//
// The bug this pins: LaughLibrary worked out "which version does this voice use" with a
// rule of its own, and when the per-kind default arrived only eligible() learned about it.
// A sniff with both treatments then played its conversion in the panel and spliced its
// recording. Anything that can answer this question must answer it the same way.
{
  const both = (kind: ReactionClipKind): ReactionLibraryIndex => {
    const s = source(`s-${kind}`, 'female', kind);
    return {
      sources: [s],
      renders: [
        render(`${kind}-original`, s.id, 'original', undefined, kind),
        render(`${kind}-voice`, s.id, 'voice-converted', 'voice-f', kind),
      ],
    };
  };

  for (const kind of REACTION_CLIP_KINDS) {
    const lib = both(kind);
    const panel = chosenFor(lib, lib.sources[0], 'voice-f');
    const generated = eligible(lib, kind, 'voice-f', 'female');
    assert.deepEqual(
      [panel?.id],
      generated.map((r) => r.id),
      `[${kind}] resolves the same for the panel and for generation`,
    );
    // And that answer is the kind's stated default, not whichever happens to exist.
    assert.equal(
      treatmentOf(panel!),
      preferredFor(kind),
      `[${kind}] uses its declared default when both treatments exist`,
    );
  }

  // An explicit per-voice choice outranks the kind, in both directions.
  const lib = both('sniffs');
  assert.equal(treatmentOf(chosenFor(lib, lib.sources[0], 'voice-f')!), 'original');
  lib.sources[0].preferredTreatmentByVoice = { 'voice-f': 'voice-converted' };
  assert.equal(
    treatmentOf(chosenFor(lib, lib.sources[0], 'voice-f')!),
    'voice-converted',
    'the author overrides the kind for one voice',
  );
  assert.deepEqual(
    eligible(lib, 'sniffs', 'voice-f', 'female').map((r) => r.id),
    ['sniffs-voice'],
    'and generation follows that override too',
  );

  // Another voice is unaffected by that choice and falls back to the recording.
  assert.equal(
    treatmentOf(chosenFor(lib, lib.sources[0], 'other-f')!),
    'original',
    'a preference is per voice, not per source',
  );
}

// --- room, and the punctuation offered to buy it -----------------------------------------
{
  const noRoom = 'Bonjour [gulps] excusez-moi';
  const warned = roomWarnings(noRoom);
  assert.equal(warned.length, 1, 'a tag between two bare words has no room');
  assert.equal(warned[0].kind, 'gulps');

  // Punctuation on EITHER side is enough, because the tag is removed and what is left is
  // the mark standing between the two words.
  assert.deepEqual(roomWarnings('Bonjour, [gulps] excusez-moi'), [], 'a comma before is room');
  assert.deepEqual(roomWarnings('Bonjour [gulps], excusez-moi'), [], 'a comma after is room');
  assert.deepEqual(roomWarnings('Bonjour. [gulps] Excusez-moi'), [], 'a sentence boundary is room');
  assert.deepEqual(roomWarnings('[gulps] Excusez-moi'), [], 'the start of a line is room');
  assert.deepEqual(roomWarnings('Excusez-moi [gulps]'), [], 'the end of a line is room');
  assert.deepEqual(roomWarnings('Bonjour\n[gulps]\nExcusez-moi'), [], 'a line break is room');
  assert.deepEqual(roomWarnings('a [whispering] b'), [], 'a directive is not spliced, so it needs none');
  assert.deepEqual(
    roomWarnings('a [gulps] b', ['sniffs']),
    [],
    'a kind this voice cannot cover is the model\'s problem, not the author\'s',
  );

  // THE FIX MUST SURVIVE THE LIFT. This is the assertion that matters: what the model is
  // asked to say is the text with the tag gone, and a mark on both sides would double up.
  const fixed = addRoom(noRoom, warned);
  assert.equal(fixed, 'Bonjour, [gulps] excusez-moi', 'a brief reaction gets a comma');
  assert.equal(
    splitClips(fixed, REACTION_CLIP_KINDS).spoken,
    'Bonjour, excusez-moi',
    'the lifted text carries exactly one comma, which is the pause the clip sits in',
  );
  assert.deepEqual(roomWarnings(fixed), [], 'the fix satisfies the warning it came from');

  // An arc wants more than a comma, and a dash is spaced on both sides.
  const long = addRoom('Bonjour [yawn] excusez-moi', roomWarnings('Bonjour [yawn] excusez-moi'));
  assert.equal(long, 'Bonjour — [yawn] excusez-moi', 'a yawn gets a dash');
  assert.equal(splitClips(long, REACTION_CLIP_KINDS).spoken, 'Bonjour — excusez-moi');

  // Several in one line, applied right to left so earlier offsets stay valid.
  const many = 'un [gulps] deux [sniffs] trois';
  assert.equal(
    addRoom(many, roomWarnings(many)),
    'un, [gulps] deux, [sniffs] trois',
    'every reaction in the line is fixed and none of the offsets drift',
  );

  // No period is ever inserted, in any kind, because that would mean recapitalising.
  for (const kind of REACTION_CLIP_KINDS) {
    const line = `aa [${kind}] bb`;
    const out = addRoom(line, roomWarnings(line));
    assert.ok(!/\./.test(out), `[${kind}] is not given a full stop`);
  }
}

// --- the level suggestion ----------------------------------------------------------------
{
  // Every clip kind states where it belongs, since the slider opening at unity was the
  // thing the per-kind target replaced.
  for (const kind of REACTION_CLIP_KINDS) {
    assert.equal(
      typeof tagForKind(kind)?.levelDb,
      'number',
      `[${kind}] says where it sits against speech`,
    );
  }

  // A gasp belongs above the line and a gulp well below it. If these ever collapse toward
  // each other the feature has quietly become normalisation, which is what it exists not
  // to be.
  assert.ok(
    tagForKind('gasps')!.levelDb! > tagForKind('laughs')!.levelDb!,
    'a gasp cuts through more than a laugh',
  );
  assert.ok(
    tagForKind('gulps')!.levelDb! < tagForKind('sighs')!.levelDb!,
    'a gulp is quieter than a sigh',
  );

  // The suggestion is the distance from measured to target, in that direction.
  assert.equal(suggestedGainDb(-14, -8), 6, 'a clip under its target is lifted');
  assert.equal(suggestedGainDb(-2, -8), -6, 'a clip over its target is cut');
  assert.equal(suggestedGainDb(-8, -8), 0, 'a clip already there is left alone');
  assert.equal(suggestedGainDb(null, -8), 0, 'silence suggests nothing');
  assert.equal(suggestedGainDb(-14, undefined), 0, 'a kind with no target suggests nothing');

  // Clamped, so a recording made across a room cannot open the slider at its own end.
  assert.equal(suggestedGainDb(-60, 0), MAX_GAIN_DB, 'a distant recording is clamped');
  assert.equal(suggestedGainDb(40, 0), MIN_GAIN_DB, 'a hot recording is clamped');

  // dB to multiplier, in the direction that makes +6 louder rather than quieter.
  assert.ok(Math.abs(gainFromDb(6) - 1.995) < 0.01, '+6 dB roughly doubles amplitude');
  assert.ok(Math.abs(gainFromDb(-6) - 0.501) < 0.01, '-6 dB roughly halves it');
  assert.equal(gainFromDb(0), 1, 'unity is unity');
}

// --- the pad is real MP3 ----------------------------------------------------------------
//
// The pad is built from a hand-written frame header rather than encoded, so nothing but
// this check stands between a wrong constant and silence that does not decode. It is
// spliced without a sameFormat guard — it IS the format by construction — which makes a
// mistake here a corrupt take rather than a skipped clip.
const pad = silence(3);
const padScan = scanMp3(pad);
assert.ok(padScan, 'the hand-built silent frames scan as MP3');
assert.equal(padScan.frames.length, 3, 'every frame in the pad is found');
assert.deepEqual(
  {
    version: padScan.format.version,
    layer: padScan.format.layer,
    sampleRate: padScan.format.sampleRate,
    bitrateKbps: padScan.format.bitrateKbps,
    channelMode: padScan.format.channelMode,
  },
  { version: 3, layer: 1, sampleRate: 44_100, bitrateKbps: 128, channelMode: 3 },
  'the pad matches SPLICE_MP3 exactly, so it joins speech without a codec',
);
assert.ok(
  padScan.durationMs >= 75 && padScan.durationMs <= 80,
  `three frames is about 78ms (got ${padScan.durationMs}ms)`,
);
assert.equal(silence(0).length, 0, 'no frames is no bytes, not one empty frame');

// The dependency's undocumented channel mode is the one field the format name cannot
// guarantee. Pin it with an executable check because a mismatch is silently skipped at
// generation time by design.
const encoder = new Mp3Encoder(1, 44_100, 128);
const encoded: Uint8Array[] = [];
for (let at = 0; at < 44_100; at += 1152) {
  const length = Math.min(1152, 44_100 - at);
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    pcm[i] = Math.sin(((at + i) * Math.PI * 2 * 440) / 44_100) * 20_000;
  }
  const part = encoder.encodeBuffer(pcm);
  if (part.length > 0) encoded.push(part);
}
encoded.push(encoder.flush());
const bytes = new Uint8Array(encoded.reduce((size, part) => size + part.length, 0));
let offset = 0;
for (const part of encoded) {
  bytes.set(part, offset);
  offset += part.length;
}
const scan = scanMp3(bytes);
assert.ok(scan, 'the server scanner accepts the browser encoder output');
assert.deepEqual(
  {
    version: scan.format.version,
    layer: scan.format.layer,
    sampleRate: scan.format.sampleRate,
    channelMode: scan.format.channelMode,
  },
  { version: 3, layer: 1, sampleRate: 44_100, channelMode: 3 },
  'the encoder output matches the join fields pinned for ElevenLabs speech',
);
assert.ok(
  scan.durationMs >= 1000 && scan.durationMs <= 1080,
  `encoder delay and flush padding stay bounded (got ${scan.durationMs}ms for 1000ms)`,
);

console.log('reaction library checks passed');
