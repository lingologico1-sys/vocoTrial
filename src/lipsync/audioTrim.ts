/**
 * Reading a laugh out of whatever file you happen to have, in the browser.
 *
 * WHY THE BROWSER AND NOT THE WORKER. The Workers runtime has no codec and no Web Audio,
 * so it cannot open an m4a, cannot find where a sound starts, and cannot cut a selection
 * out of a compressed file. A browser can do all three: `decodeAudioData` handles mp3, wav,
 * m4a, ogg and webm natively, and once it has, the samples are just numbers.
 *
 * That also makes the trim SAMPLE-ACCURATE, which the splice itself can never be. _mp3.ts
 * cuts on frame boundaries because it refuses to decode; here we have already decoded, so
 * a laugh can be topped and tailed exactly rather than to the nearest 26ms. It is the one
 * place in this pipeline where precision is free, which is a good reason to spend it on the
 * edges of the sound rather than on its position.
 *
 * NOTHING IS RE-ENCODED TO A LOSSY FORMAT ON THE WAY OUT. The selection leaves as 16-bit
 * PCM in a WAV, which is a 44-byte header over samples we already hold — no library, no
 * quality lost on top of whatever the file arrived as. ElevenLabs accepts WAV, and it is
 * ElevenLabs that produces the mp3 the splice actually uses, so this side never needs an
 * encoder at all.
 */

/**
 * The window the level is measured over.
 *
 * 20ms is long enough that a single glottal pulse does not read as silence between beats
 * of a laugh — laughter is periodic at around 5Hz and a shorter window finds a gap in every
 * cycle — and short enough to place an edge within a frame of where the ear puts it.
 */
const WINDOW_MS = 20;

/**
 * How far below the loudest window still counts as the sound.
 *
 * -32dB rather than an absolute floor, because the files this takes are of no fixed
 * loudness: a phone recording and a mastered library clip differ by tens of dB, and any
 * absolute threshold would be silence on one and mid-laugh on the other. Relative to the
 * peak, the same number works on both.
 *
 * The same reasoning as `measured_silences` in lipsync/verify_timing.py, which finds pauses
 * in generated speech the same way. That one can afford an absolute floor because it only
 * ever sees ElevenLabs output at a known level; this cannot.
 */
const FLOOR_DB = -32;

/**
 * Kept either side of the sound once its edges are found.
 *
 * A laugh cut exactly at the threshold starts abruptly, because the attack that crosses it
 * is already underway. A little room in front lets the onset arrive, and a little behind
 * lets it decay rather than being chopped. Small enough that it cannot pull in a
 * neighbouring word.
 */
const PAD_MS = 60;

/** Decoded audio, and the AudioContext is closed rather than left open per file. */
export async function decodeFile(file: File): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  // Not the shared realtime context: that one is opened at a fixed rate for playback, and
  // decoding through it would resample the file on the way in for no reason. A fresh
  // context decodes at the file's own rate.
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(bytes);
  } finally {
    void context.close();
  }
}

/** One channel of the buffer, downmixed. Laughs are mono by the time they leave here. */
function mono(buffer: AudioBuffer): Float32Array {
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < channel.length; i++) out[i] += channel[i];
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < out.length; i++) out[i] /= buffer.numberOfChannels;
  }
  return out;
}

/**
 * Where the sound in this file starts and stops, as a first offer.
 *
 * AN OFFER, NOT AN ANSWER. It is right often enough to save the work of scrubbing, and
 * wrong often enough — two laughs in one recording, a cough before it, a room that never
 * goes quiet — that the panel shows it as editable numbers rather than acting on it. The
 * failure it cannot detect at all is a file with no laugh in it: silence returns the whole
 * file, which is why the caller auditions before keeping anything.
 */
export function proposeBounds(buffer: AudioBuffer): { startMs: number; endMs: number } {
  const samples = mono(buffer);
  const rate = buffer.sampleRate;
  const window = Math.max(1, Math.round((WINDOW_MS / 1000) * rate));

  // RMS per window, and the peak window to measure the others against.
  const levels: number[] = [];
  for (let at = 0; at + window <= samples.length; at += window) {
    let sum = 0;
    for (let i = at; i < at + window; i++) sum += samples[i] * samples[i];
    levels.push(Math.sqrt(sum / window));
  }
  if (levels.length === 0) return { startMs: 0, endMs: Math.round(buffer.duration * 1000) };

  const peak = Math.max(...levels);
  if (peak === 0) return { startMs: 0, endMs: Math.round(buffer.duration * 1000) };
  const floor = peak * 10 ** (FLOOR_DB / 20);

  const first = levels.findIndex((l) => l >= floor);
  let last = levels.length - 1;
  while (last > first && levels[last] < floor) last--;
  if (first < 0) return { startMs: 0, endMs: Math.round(buffer.duration * 1000) };

  const perWindowMs = (window / rate) * 1000;
  const startMs = Math.max(0, Math.round(first * perWindowMs - PAD_MS));
  const endMs = Math.min(
    Math.round(buffer.duration * 1000),
    Math.round((last + 1) * perWindowMs + PAD_MS),
  );
  return { startMs, endMs };
}

/**
 * The level of generated ElevenLabs speech, as an RMS over its loud windows.
 *
 * MEASURED, NOT GUESSED, and worth saying how. Taken from `mp3_44100_128` takes of ordinary
 * lesson lines at the default voice settings, averaging the windows above the same -32dB
 * relative floor `proposeBounds` uses — so it is the level of the speech itself rather than
 * of the speech plus its pauses, which is the number a clip should be compared against.
 *
 * A REFERENCE AND NOT A TARGET. Nothing in this file applies gain, and that is deliberate
 * rather than unfinished — see `levelOf`.
 */
const SPEECH_RMS = 0.13;

/**
 * How loud the selection is, in dB relative to generated speech.
 *
 * WHAT THIS IS MEASURED AGAINST, AND WHY IT IS NOT A TARGET. Matching every clip to the
 * level of the speech — plain normalisation — is wrong in a way that gets worse the better
 * it works. A breathy sound's character *is* its quietness: a sniff pulled up to speech
 * level is not integrated, it is a loud wet noise where a sniff used to be. A gasp is
 * *supposed* to sit above the line. The sounds a normaliser moves furthest are precisely
 * the ones it ruins.
 *
 * The answer is not to give up on a default, though, which was this file's first position
 * and was too cautious. It is that the right level is a fact about the KIND rather than
 * about the speech — see `levelDb` in tags.ts, where each of the eight says where it
 * belongs. `suggestedGain` below turns this measurement plus that target into an opening
 * position for the slider, and the author moves it by ear from there.
 *
 * Null when the selection is silent, which is a real answer: there is no level, rather
 * than a level of zero to be reported as minus infinity.
 */
export function levelOf(buffer: AudioBuffer, fromMs: number, toMs: number): number | null {
  const samples = mono(buffer);
  const rate = buffer.sampleRate;
  const from = Math.max(0, Math.floor((fromMs / 1000) * rate));
  const to = Math.min(samples.length, Math.ceil((toMs / 1000) * rate));
  if (to <= from) return null;

  const window = Math.max(1, Math.round((WINDOW_MS / 1000) * rate));
  const levels: number[] = [];
  for (let at = from; at + window <= to; at += window) {
    let sum = 0;
    for (let i = at; i < at + window; i++) sum += samples[i] * samples[i];
    levels.push(Math.sqrt(sum / window));
  }
  if (levels.length === 0) return null;

  // The loud part only, against the same relative floor the trim uses. Averaging the whole
  // selection would report the pause inside a two-beat laugh as part of its loudness, and
  // rank a clip quieter for having a gap in it.
  const peak = Math.max(...levels);
  if (peak === 0) return null;
  const floor = peak * 10 ** (FLOOR_DB / 20);
  const loud = levels.filter((l) => l >= floor);
  if (loud.length === 0) return null;

  const rms = Math.sqrt(loud.reduce((sum, l) => sum + l * l, 0) / loud.length);
  return 20 * Math.log10(rms / SPEECH_RMS);
}

/**
 * The gain that would put this clip where its kind belongs.
 *
 * Returns a plain multiplier, and `1` whenever there is nothing to go on — a silent
 * selection, or a kind with no stated target. Clamped, because the arithmetic is happy to
 * suggest 40dB of lift on a recording made across a room, and a slider that opens at the
 * far end of its own range is worse than one that opens at unity: it presents a number
 * nobody chose as though it were considered.
 */
export const MAX_GAIN_DB = 12;
export const MIN_GAIN_DB = -24;

export function suggestedGainDb(measuredDb: number | null, targetDb: number | undefined): number {
  if (measuredDb === null || targetDb === undefined) return 0;
  return Math.max(MIN_GAIN_DB, Math.min(MAX_GAIN_DB, targetDb - measuredDb));
}

export const gainFromDb = (db: number) => 10 ** (db / 20);
export const dbFromGain = (gain: number) => 20 * Math.log10(gain);

/**
 * How much louder this clip can be made before it starts clipping.
 *
 * THE THING THAT MADE THE LEVEL CONTROL LOOK BROKEN. A lift is applied by multiplying the
 * samples, and anything past full scale is clamped flat to avoid a wrap — which is right,
 * and silently means a lift on a clip that is already loud does nothing but square off its
 * peaks. ElevenLabs conversions arrive mastered near full scale, so on exactly the clips
 * somebody is most likely to reach for the button, every press was inaudible.
 *
 * So the ceiling is measured first and the caller is told. Zero is a real answer: a clip
 * with no headroom cannot be made louder at all, and the honest response is to say so
 * rather than to re-encode it into a slightly more distorted version of itself.
 *
 * Cutting is never limited. You can always go quieter.
 */
export function headroomDb(buffer: AudioBuffer, fromMs: number, toMs: number): number {
  const peak = peakOf(buffer, fromMs, toMs);
  if (peak <= 0) return MAX_GAIN_DB;
  return Math.max(0, Math.min(MAX_GAIN_DB, -dbFromGain(peak)));
}

/** The loudest single sample in the selection, for the clipping warning. */
export function peakOf(buffer: AudioBuffer, fromMs: number, toMs: number): number {
  const samples = mono(buffer);
  const rate = buffer.sampleRate;
  const from = Math.max(0, Math.floor((fromMs / 1000) * rate));
  const to = Math.min(samples.length, Math.ceil((toMs / 1000) * rate));

  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak;
}

/**
 * A slice of the buffer as a 16-bit mono PCM WAV.
 *
 * Mono because a laugh is one mouth and the conversion returns mono anyway, so carrying a
 * second channel up the wire buys nothing. The sample rate is left exactly as the file's:
 * resampling here would be a second lossy step before the one that matters, and
 * speech-to-speech is content to take whatever rate it is handed.
 */
export function toWav(
  buffer: AudioBuffer,
  startMs: number,
  endMs: number,
  /**
   * The same multiplier toMp3 takes, and it has to be the same one.
   *
   * THE WAV IS WHAT SPEECH-TO-SPEECH CONVERTS FROM, which is why this is not merely a
   * consistency nicety. Applying the level to the encoded MP3 and not to this left the two
   * treatments of one clip at different loudnesses — and once conversion became the
   * default, the import slider was adjusting the copy almost nobody would hear.
   *
   * It does mean the kept recording is the selection *at the level you chose* rather than
   * as it came off the file. That is the honest reading of what this archive is for: it
   * already stores your trim rather than the whole file, and the level is the same kind of
   * decision. Nothing is lost that the headroom cap would have let you clip.
   */
  gain = 1,
): Uint8Array {
  const rate = buffer.sampleRate;
  const from = Math.max(0, Math.floor((startMs / 1000) * rate));
  const to = Math.min(buffer.length, Math.ceil((endMs / 1000) * rate));
  const samples = mono(buffer).subarray(from, Math.max(from, to));

  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format 1 = uncompressed PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate: one channel, two bytes
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    // Clamped AFTER the gain and before scaling: decodeAudioData can return values outside
    // -1..1 on audio that was mastered hot, and letting one wrap through setInt16 turns a
    // loud peak into a full-scale spike of the opposite sign — an audible click in the
    // middle of the laugh. A lift can put a sample there just as easily as a hot master.
    const clamped = Math.max(-1, Math.min(1, samples[i] * gain));
    view.setInt16(44 + i * 2, clamped * 0x7fff, true);
  }

  return bytes;
}

/** The format ElevenLabs speech uses and the frame splicer therefore requires. */
export const SPLICE_SAMPLE_RATE = 44_100;
export const SPLICE_BITRATE_KBPS = 128;

/**
 * The selected performance as a splice-ready MP3, without asking a model to re-perform it.
 *
 * The encoder is loaded only for this action: it is a sizeable, LGPL-licensed dependency
 * and has no reason to sit in the first page load for somebody who never imports a laugh.
 * A mono encode also pins the channel mode to the one ElevenLabs currently returns. The
 * server scans and refuses every result before storage, so that provider assumption cannot
 * turn into a silently skipped clip.
 */
export async function toMp3(
  buffer: AudioBuffer,
  startMs: number,
  endMs: number,
  /**
   * A multiplier applied before encoding, and the only moment it can be applied at all.
   *
   * Baked into the bytes rather than stored as a number for the splice to honour, because
   * the splice cannot honour it: generate.ts joins MP3 frames without decoding, which is
   * what makes it possible in a Worker at all, and a decoder is exactly what changing a
   * level requires. The browser is holding the samples already, so it is the one place in
   * the app where this costs nothing.
   */
  gain = 1,
): Promise<Uint8Array> {
  const from = Math.max(0, Math.floor((startMs / 1000) * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.ceil((endMs / 1000) * buffer.sampleRate));
  const selected = mono(buffer).slice(from, Math.max(from, to));
  if (selected.length === 0) return new Uint8Array();

  let samples = selected;
  if (gain !== 1) {
    // Clamped here as well as at the encoder, because a lift applied to a clip already
    // near full scale wraps rather than distorting, and a wrap is a click.
    samples = new Float32Array(selected.length);
    for (let i = 0; i < selected.length; i++) {
      samples[i] = Math.max(-1, Math.min(1, selected[i] * gain));
    }
  }
  if (buffer.sampleRate !== SPLICE_SAMPLE_RATE) {
    // `samples`, not `selected`: the gain above has already been applied to it, and
    // resampling from the untouched selection would silently throw the level away on
    // every file that is not already at 44.1kHz.
    const outputLength = Math.max(
      1,
      Math.ceil((samples.length * SPLICE_SAMPLE_RATE) / buffer.sampleRate),
    );
    const context = new OfflineAudioContext(1, outputLength, SPLICE_SAMPLE_RATE);
    const input = context.createBuffer(1, samples.length, buffer.sampleRate);
    input.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = input;
    source.connect(context.destination);
    source.start();
    samples = (await context.startRendering()).getChannelData(0).slice();
  }

  const { Mp3Encoder } = await import('@breezystack/lamejs');
  const encoder = new Mp3Encoder(1, SPLICE_SAMPLE_RATE, SPLICE_BITRATE_KBPS);
  const parts: Uint8Array[] = [];
  const blockSize = 1152;

  for (let at = 0; at < samples.length; at += blockSize) {
    const block = samples.subarray(at, Math.min(samples.length, at + blockSize));
    const pcm = new Int16Array(block.length);
    for (let i = 0; i < block.length; i++) {
      const clamped = Math.max(-1, Math.min(1, block[i]));
      pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
    const encoded = encoder.encodeBuffer(pcm);
    if (encoded.length > 0) parts.push(encoded);
  }
  const tail = encoder.flush();
  if (tail.length > 0) parts.push(tail);

  const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/** Bytes as base64, for the JSON body every route on this page speaks. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked: String.fromCharCode(...bytes) overflows the argument limit somewhere around a
  // hundred thousand samples, which a two-second clip passes comfortably.
  for (let at = 0; at < bytes.length; at += 8192) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 8192));
  }
  return btoa(binary);
}
