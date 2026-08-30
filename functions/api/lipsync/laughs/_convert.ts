import { scanMp3, type Mp3Scan } from '../_mp3';

/**
 * One laugh, re-performed in a chosen voice by ElevenLabs' voice changer.
 *
 * WHAT THIS BUYS, and it is two things that used to need two different solutions. A laugh
 * you recorded is the wrong voice and the wrong file format; speech-to-speech fixes both in
 * one call, because it renders into the voice you name and returns audio in the format you
 * ask for. Asking for `mp3_44100_128` — the same format the text-to-speech endpoint
 * returns — is what lets _mp3.ts join the two by concatenating bytes. Without it this app
 * would need a codec, and the Workers runtime has none, so it would have needed a second
 * service and a second round trip on the way in.
 *
 * THE MODEL IS NOT THE ONE THE LINE USES, and cannot be. `eleven_v3` is text-to-speech
 * only; there is no v3 voice changer, so a laugh spliced into a v3 line is rendered by a v2
 * engine and there may be a slight difference in timbre at the seam. On an
 * `eleven_multilingual_v2` line both sides come from the same generation of engine and the
 * question does not arise. Worth knowing when judging the first clip, and not worth
 * pretending away with a model parameter that has nowhere to point.
 *
 * Multilingual rather than English-only because this app speaks en, fr and es — though for
 * a laugh, which has no words in it, the distinction is close to academic.
 */
const STS_MODEL = 'eleven_multilingual_sts_v2';

/**
 * The one output format the splice can use.
 *
 * Named explicitly rather than left to the endpoint's default, even though the default
 * happens to be this. A default is a fact about ElevenLabs today; the splice's correctness
 * depends on it forever, and the failure if it ever changed would be silent — `sameFormat`
 * would start refusing every clip and laughs would quietly stop appearing. generate.ts pins
 * the same value on the text-to-speech call for the same reason.
 */
export const SPLICE_FORMAT = 'mp3_44100_128';

export interface Converted {
  bytes: Uint8Array;
  scan: Mp3Scan;
}

export type ConvertFailure =
  | { error: string; code: string; status: number; detail?: string };

/**
 * WAV in, mp3 in the target voice out — or a failure worth showing whoever asked.
 *
 * Errors come back as values rather than thrown, because every caller wants to turn them
 * into a JSON body with a status, and the two callers disagree about nothing except which
 * one they are.
 */
export async function convertToVoice(
  key: string,
  voiceId: string,
  wav: Uint8Array,
  removeBackgroundNoise: boolean,
): Promise<Converted | ConvertFailure> {
  const form = new FormData();
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'laugh.wav');
  form.append('model_id', STS_MODEL);
  // A phone recording carries a room; the isolation model takes it off, and without it the
  // conversion tends to render the room as breath. Off is offered because on a clean studio
  // clip it can soften the laugh's edges, which is exactly the part that carries it.
  form.append('remove_background_noise', String(removeBackgroundNoise));

  const response = await fetch(
    `https://api.elevenlabs.io/v1/speech-to-speech/${encodeURIComponent(voiceId)}` +
      `?output_format=${SPLICE_FORMAT}`,
    { method: 'POST', headers: { 'xi-api-key': key }, body: form },
  );

  if (!response.ok) {
    const detail = await response.text();
    return {
      error: 'ElevenLabs could not convert that',
      code: 'convert_failed',
      status: response.status === 401 ? 500 : 502,
      detail: detail.slice(0, 600),
    };
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const scan = scanMp3(bytes);
  // Checked here rather than trusted, because this is the last moment anything can tell.
  // Past this point the bytes go into a bucket and are only looked at again by the splice,
  // where a format that cannot be joined is silently skipped and a laugh simply never
  // appears — a bug that would present as "the library does not work" with nothing to see.
  if (!scan) {
    return {
      error: 'The conversion came back as audio this cannot splice',
      code: 'unreadable',
      status: 502,
    };
  }

  return { bytes, scan };
}

export function isFailure(result: Converted | ConvertFailure): result is ConvertFailure {
  return 'error' in result;
}
