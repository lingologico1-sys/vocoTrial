import assert from 'node:assert/strict';
import { Mp3Encoder } from '@breezystack/lamejs';
import { scanMp3 } from '../functions/api/lipsync/_mp3.ts';
import {
  eligible,
  pick,
  type LaughLibraryIndex,
  type LaughRender,
  type LaughSource,
} from '../src/lipsync/laughs.ts';

const source = (id: string, gender?: 'male' | 'female'): LaughSource => ({
  id,
  createdAt: 1,
  kind: 'laughs',
  gender,
  label: id,
  durationMs: 500,
  bytes: 100,
});
const render = (
  id: string,
  sourceId: string | undefined,
  treatment: LaughRender['treatment'],
  voiceId?: string,
): LaughRender => ({
  id,
  sourceId,
  treatment,
  voiceId,
  createdAt: 1,
  kind: 'laughs',
  label: id,
  durationMs: 500,
  bytes: 100,
});

const female = source('female', 'female');
const male = source('male', 'male');
const legacy = source('legacy');
const library: LaughLibraryIndex = {
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

console.log('laugh selection checks passed');
