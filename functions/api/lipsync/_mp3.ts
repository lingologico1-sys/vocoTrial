/**
 * MP3 as a sequence of frames, so that speech and a laugh can be joined without a codec.
 *
 * WHY THIS EXISTS AT ALL, given that nothing else in this codebase touches audio bytes.
 * ElevenLabs' `[laughs]` and `[giggles]` are v3 *audio tags*: advisory, not instructions.
 * The model decides per generation whether to render one, so the same script gives an
 * audible laugh on one take and silence on the next — and reactionSpans, which reads the
 * laugh's span off the tag's character timings, cannot tell the two apart. The face then
 * performs a laugh over speech. Splicing a laugh we chose removes the coin flip at its
 * source, and this file is what makes the splice cost nothing.
 *
 * IT IS A CONCATENATION, NOT A MIX, and that is the whole design. An MPEG audio stream is
 * self-framing: every frame carries its own four-byte header naming version, layer, rate,
 * bitrate and channel mode, and a decoder resynchronises on each one. Two streams that
 * agree on all five can be joined by putting one array of bytes after another — no
 * decode, no resample, no re-encode, and therefore no generation loss and no ffmpeg. The
 * Workers runtime has neither ffmpeg nor Web Audio, so an approach needing either would
 * have meant a second service and a second round trip on every generation.
 *
 * The five fields agree by construction rather than by luck: a clip is cut out of a take
 * this app generated, so it came from the same ElevenLabs endpoint with the same output
 * format. `sameFormat` still checks, because "by construction" is an argument about today
 * and a mismatched join is silence or noise rather than an error.
 *
 * WHAT IS GIVEN UP. Cuts land on a frame boundary — 26.122ms at 44.1kHz — so an insertion
 * point is quantised to that. Nothing here pretends otherwise: `splitAt` returns the time
 * it actually cut at, and the caller shifts its marks by that rather than by what it
 * asked for. Twenty-six milliseconds is a third of the tolerance lip-sync survives, and
 * the alternative is decoding a whole clip to move a laugh by half a frame.
 *
 * There is also the bit reservoir: Layer III lets a frame borrow space from its
 * predecessors, so the first frame after a join can be missing data it expected to find.
 * That is at most one frame of degraded audio at each seam, on a boundary that is silence
 * either side of a laugh. It is audible in theory and has not been in practice; it is the
 * price of not re-encoding, and it is written down here so nobody rediscovers it as a
 * mystery.
 */

/** Layer III, MPEG1 then MPEG2/2.5. Index 0 is "free" and 15 is invalid; both refuse. */
const BITRATES_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

/** By version field: 0 = MPEG2.5, 1 = reserved, 2 = MPEG2, 3 = MPEG1. */
const SAMPLE_RATES = [
  [11025, 12000, 8000, 0],
  [0, 0, 0, 0],
  [22050, 24000, 16000, 0],
  [44100, 48000, 32000, 0],
];

/** The five fields two streams must agree on before they can be joined. */
export interface Mp3Format {
  /** The raw version field, kept raw because that is what has to match. */
  version: number;
  layer: number;
  sampleRate: number;
  bitrateKbps: number;
  /** 3 is single channel; 0, 1 and 2 are the three stereo modes. */
  channelMode: number;
}

export interface Mp3Scan {
  format: Mp3Format;
  /** Byte offset of each frame, in order. The stream is `frames.length` frames long. */
  frames: number[];
  /** One past the last frame's last byte — where an ID3v1 trailer would begin. */
  end: number;
  /** 1152 on MPEG1, 576 on MPEG2 and 2.5. Constant within one stream. */
  samplesPerFrame: number;
  durationMs: number;
}

interface Header {
  format: Mp3Format;
  length: number;
  samplesPerFrame: number;
}

/**
 * A frame header at `at`, or null if there is not a valid one there.
 *
 * Every reserved combination is refused rather than defaulted. A sync word is only eleven
 * bits, so roughly one byte pair in 2048 of arbitrary data looks like the start of a
 * frame; the reserved-value checks are most of what separates a real frame from a
 * coincidence, and treating a coincidence as a frame is how a scan walks off into album
 * art and reports a plausible, wrong duration.
 */
function readHeader(bytes: Uint8Array, at: number): Header | null {
  if (at + 4 > bytes.length) return null;
  if (bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;

  const version = (bytes[at + 1] >> 3) & 0x03;
  const layer = (bytes[at + 1] >> 1) & 0x03;
  // 1 is the reserved version; 0 is the reserved layer. Layer III is field value 1.
  if (version === 1 || layer !== 1) return null;

  const bitrateIndex = (bytes[at + 2] >> 4) & 0x0f;
  const rateIndex = (bytes[at + 2] >> 2) & 0x03;
  const padding = (bytes[at + 2] >> 1) & 0x01;
  const channelMode = (bytes[at + 3] >> 6) & 0x03;

  const isV1 = version === 3;
  const bitrateKbps = (isV1 ? BITRATES_V1 : BITRATES_V2)[bitrateIndex];
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  // Free-format and invalid bitrates both land on 0, and neither has a computable frame
  // length — a free-format stream's length is implied by the distance to the next sync,
  // which is a different scanner for a case ElevenLabs does not produce.
  if (!bitrateKbps || !sampleRate) return null;

  const samplesPerFrame = isV1 ? 1152 : 576;
  const length =
    Math.floor(((samplesPerFrame / 8) * bitrateKbps * 1000) / sampleRate) + padding;
  if (length < 4) return null;

  return { format: { version, layer, sampleRate, bitrateKbps, channelMode }, length, samplesPerFrame };
}

/** Whether two streams can be joined. Every field, because every field must match. */
export function sameFormat(a: Mp3Format, b: Mp3Format): boolean {
  return (
    a.version === b.version &&
    a.layer === b.layer &&
    a.sampleRate === b.sampleRate &&
    a.bitrateKbps === b.bitrateKbps &&
    a.channelMode === b.channelMode
  );
}

/** True when a frame header sits at `at` and agrees with one already established. */
function continues(bytes: Uint8Array, at: number, format: Mp3Format): boolean {
  const header = readHeader(bytes, at);
  return header !== null && sameFormat(header.format, format);
}

/** Everything before the first frame: an ID3v2 tag, or nothing. */
function audioStart(bytes: Uint8Array): number {
  if (bytes.length >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    // Syncsafe: seven bits per byte, so a size can never itself contain a sync word.
    const size =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f);
    // Bit 4 of the flags is a footer, ten more bytes at the end of the tag.
    const footer = bytes[5] & 0x10 ? 10 : 0;
    return Math.min(bytes.length, 10 + size + footer);
  }
  return 0;
}

/** Everything after the last frame: an ID3v1 trailer, or nothing. */
function audioEnd(bytes: Uint8Array): number {
  const at = bytes.length - 128;
  if (at > 0 && bytes[at] === 0x54 && bytes[at + 1] === 0x41 && bytes[at + 2] === 0x47) {
    return at;
  }
  return bytes.length;
}

/**
 * A frame that describes the stream rather than carrying any of it.
 *
 * Encoders put a Xing, Info or VBRI header in the first frame, holding the frame count
 * and a seek table. It is a structurally valid frame full of zeroes, so it decodes as a
 * moment of silence and joining it would be harmless to listen to — but it is 26ms of
 * nothing at the head of every clip, and its frame count stops being true the instant
 * anything is spliced. Dropped from clips for the first reason and from joins for the
 * second.
 *
 * The tag sits after the side information, whose length depends on version and channel
 * mode; rather than encode that table, this looks across the whole frame, which cannot
 * false-positive on compressed audio at a fixed offset from the header.
 */
function isDescriptorFrame(bytes: Uint8Array, at: number, length: number): boolean {
  const stop = Math.min(at + length, bytes.length) - 4;
  for (let i = at + 4; i <= stop; i++) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const d = bytes[i + 3];
    // "Xing", "Info", "VBRI"
    if (a === 0x58 && b === 0x69 && c === 0x6e && d === 0x67) return true;
    if (a === 0x49 && b === 0x6e && c === 0x66 && d === 0x6f) return true;
    if (a === 0x56 && b === 0x42 && c === 0x52 && d === 0x49) return true;
  }
  return false;
}

/**
 * Where every frame in a stream begins, or null if this is not one we can join.
 *
 * The first sync is confirmed by requiring a second frame to follow it exactly where the
 * first one's length says it should. One header can appear by chance inside album art;
 * two consecutive, agreeing, correctly spaced headers effectively cannot, and the cost is
 * being unable to scan a single-frame file, which is not audio anybody would splice.
 *
 * A frame whose successor does not line up ends the scan rather than triggering a
 * resynchronisation hunt. Everything reaching this came from one encoder in one pass, so
 * a broken chain means the assumption is wrong somewhere and stopping reports that; a
 * hunt would paper over it and hand back a stream with a hole in the middle.
 */
export function scanMp3(bytes: Uint8Array): Mp3Scan | null {
  const from = audioStart(bytes);
  const limit = audioEnd(bytes);

  let first = -1;
  let head: Header | null = null;
  for (let at = from; at + 4 <= limit; at++) {
    const candidate = readHeader(bytes, at);
    if (candidate && continues(bytes, at + candidate.length, candidate.format)) {
      first = at;
      head = candidate;
      break;
    }
  }
  if (first < 0 || !head) return null;

  const { format, samplesPerFrame } = head;
  const frames: number[] = [];
  let at = first;

  while (at + 4 <= limit) {
    const frame = readHeader(bytes, at);
    if (!frame || !sameFormat(frame.format, format)) break;
    if (at + frame.length > limit) break;
    if (!(frames.length === 0 && isDescriptorFrame(bytes, at, frame.length))) {
      frames.push(at);
    }
    at += frame.length;
  }

  if (frames.length === 0) return null;

  return {
    format,
    frames,
    end: at,
    samplesPerFrame,
    durationMs: Math.round((frames.length * samplesPerFrame * 1000) / format.sampleRate),
  };
}

/** How far into the stream frame `index` begins. */
export function frameTimeMs(scan: Mp3Scan, index: number): number {
  return Math.round((index * scan.samplesPerFrame * 1000) / scan.format.sampleRate);
}

/**
 * The frame containing `ms`, clamped to the stream.
 *
 * Rounds to the nearest boundary rather than flooring, so the error is half a frame in
 * either direction instead of a whole frame early. At 44.1kHz that is 13ms rather than
 * 26, and the difference is free.
 */
export function frameAt(scan: Mp3Scan, ms: number): number {
  const exact = (ms * scan.format.sampleRate) / (scan.samplesPerFrame * 1000);
  return Math.max(0, Math.min(scan.frames.length, Math.round(exact)));
}

/** The bytes of frames [from, to), with no ID3 either side. */
export function framesOf(
  bytes: Uint8Array,
  scan: Mp3Scan,
  from: number,
  to: number,
): Uint8Array {
  const start = from >= scan.frames.length ? scan.end : scan.frames[from];
  const stop = to >= scan.frames.length ? scan.end : scan.frames[to];
  return bytes.slice(start, Math.max(start, stop));
}

/**
 * A stream cut in two at a frame boundary, and the time the cut really landed on.
 *
 * The returned time is the point of the whole thing. A caller asking to insert at 1840ms
 * gets a cut at 1828, and every mark after the insertion has to move by the clip's length
 * measured from *there* — shifting by what was asked for instead would leave the marks
 * disagreeing with the audio by up to half a frame, permanently, for no reason.
 */
export function splitAt(
  bytes: Uint8Array,
  scan: Mp3Scan,
  ms: number,
): { head: Uint8Array; tail: Uint8Array; atMs: number } {
  const index = frameAt(scan, ms);
  return {
    head: framesOf(bytes, scan, 0, index),
    tail: framesOf(bytes, scan, index, scan.frames.length),
    atMs: frameTimeMs(scan, index),
  };
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
