import type { Quota } from './cost';
import type {
  LaughKind,
  LaughLibraryIndex,
  LaughRender,
  LaughSource,
  LaughTreatment,
  VoiceGender,
} from './laughs';
import type {
  ReactionOptions,
  LipsyncModel,
  LipsyncPackage,
  PublishedLine,
  VoiceParams,
} from './published';

/**
 * The browser's side of generating and keeping lines.
 *
 * Everything is a POST, because the gate in functions/api/_middleware.ts allows nothing
 * else through — the same constraint facekit/library.ts works under, and the reason audio
 * travels as base64 in a body rather than as a URL an <audio> element could point at.
 */

export class LipsyncError extends Error {
  readonly status: number;
  /** The machine-readable code, for the two cases the page treats differently. */
  readonly code?: string;
  /** Extra context from the far end — usually the provider's own refusal. */
  readonly detail?: string;

  constructor(message: string, status: number, code?: string, detail?: string) {
    super(message);
    this.name = 'LipsyncError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function post<T>(route: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/lipsync/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as {
      error?: string;
      code?: string;
      detail?: string;
      hint?: string;
    } | null;
    throw new LipsyncError(
      [detail?.error, detail?.hint].filter(Boolean).join(' ') ||
        `The lip-sync service refused that (${response.status})`,
      response.status,
      detail?.code,
      detail?.detail,
    );
  }

  return (await response.json()) as T;
}

/** Keeps Compose's preflight coverage in step with mutations made lower on the page. */
export const LAUGH_LIBRARY_CHANGED = 'lipsync:laugh-library-changed';

async function changed<T>(request: Promise<T>): Promise<T> {
  const result = await request;
  window.dispatchEvent(new Event(LAUGH_LIBRARY_CHANGED));
  return result;
}

export interface Generated {
  package: LipsyncPackage;
  audioBase64: string;
  alignment?: unknown;
}

export interface GenerateRequest {
  text: string;
  language: LipsyncPackage['language'];
  voiceId: string;
  voiceName?: string;
  voiceGender: VoiceGender;
  model: LipsyncModel;
  params: VoiceParams;
  reactions: ReactionOptions;
}

/**
 * Synthesise and align in one call.
 *
 * Slow on purpose rather than by accident: it is two provider round trips, and a cold
 * aligner adds most of a minute to the second. The page shows that rather than hiding
 * it, because a spinner with no explanation is how someone concludes the thing is broken
 * and presses the button again.
 */
export function generate(request: GenerateRequest): Promise<Generated> {
  return post<Generated>('generate', request);
}

/** Keeps a package. Nothing is stored until this is called — see generate.ts. */
export function saveLine(generated: Generated): Promise<{ line: PublishedLine }> {
  return post<{ line: PublishedLine }>('save', generated);
}

export async function listLines(): Promise<PublishedLine[]> {
  const { lines } = await post<{ lines: PublishedLine[] }>('list');
  return lines;
}

export function fetchLine(
  id: string,
): Promise<{ package: LipsyncPackage; audioBase64?: string }> {
  return post<{ package: LipsyncPackage; audioBase64?: string }>('get', { id });
}

/**
 * What ElevenLabs says is left this month.
 *
 * Resolves to null rather than throwing: the quota is context, not a precondition. A
 * page that refused to let anyone generate because a usage endpoint was slow would be
 * worse than one that shows a character count on its own.
 */
export async function fetchQuota(): Promise<Quota | null> {
  try {
    return await post<Quota>('quota');
  } catch {
    return null;
  }
}

export function deleteLine(id: string): Promise<unknown> {
  return post('delete', { id });
}

/**
 * The laugh library.
 *
 * Split in two the way the store is: a laugh you provided is a `LaughSource` and belongs to
 * no voice, while a `LaughRender` is that laugh converted into one particular voice and is
 * the thing the splice actually uses. Importing does both at once; `renderClip` is how an
 * existing laugh reaches a second voice. See src/lipsync/laughs.ts.
 */
export function listClips(): Promise<LaughLibraryIndex> {
  return post<LaughLibraryIndex>('laughs/list');
}

export interface ImportRequest {
  /** The trimmed selection as 16-bit mono PCM WAV, base64. See audioTrim.ts. */
  audioBase64: string;
  /** The same samples encoded for the MP3 splice, with no re-performance. */
  rawMp3Base64: string;
  kind: LaughKind;
  gender: VoiceGender;
  label?: string;
  /** Present only when the author also requests an exact-voice conversion. */
  voiceId?: string;
  voiceName?: string;
  voiceGender?: VoiceGender;
  convert?: boolean;
  durationMs: number;
  removeBackgroundNoise?: boolean;
}

/**
 * Keeps a laugh you provided, and renders it into one voice.
 *
 * Slow: it is a round trip to ElevenLabs' voice changer, on audio that has to go up first.
 * The converted audio comes straight back so it can be auditioned without a second call —
 * whether the conversion did something strange to the laugh is the only question that
 * matters at this moment, and it should be answerable the instant the button stops.
 */
export function importClip(
  request: ImportRequest,
): Promise<{
  source: LaughSource;
  original: LaughRender;
  converted?: LaughRender;
  render: LaughRender;
  conversionError?: { error: string; code: string; detail?: string };
  audioBase64: string;
}> {
  return changed(post('laughs/import', request));
}

/** The same laugh, performed by another voice. One call, one charge. */
export function renderClip(request: {
  sourceId: string;
  voiceId: string;
  voiceName?: string;
  voiceGender: VoiceGender;
  removeBackgroundNoise?: boolean;
}): Promise<{ render: LaughRender; audioBase64: string }> {
  return changed(post('laughs/render', request));
}

/** Add an original-performance derivative to a legacy source. */
export function addOriginalClip(request: {
  sourceId: string;
  gender: VoiceGender;
  rawMp3Base64: string;
}): Promise<{ render: LaughRender; gender: VoiceGender }> {
  return changed(post('laughs/original', request));
}

/** Select which existing treatment one source contributes to one exact voice. */
export function preferClip(request: {
  sourceId: string;
  voiceId: string;
  voiceGender: VoiceGender;
  treatment: LaughTreatment;
}): Promise<{ source: LaughSource }> {
  return changed(post('laughs/prefer', request));
}

/** Voice metadata used to choose the gender-scoped original-performance pool. */
export function fetchVoiceInfo(voiceId: string): Promise<{
  voiceId: string;
  name?: string;
  gender?: VoiceGender;
}> {
  return post('voice', { voiceId });
}

/**
 * A clip's audio, for auditioning.
 *
 * `of` decides which half: the render is what gets spliced, the source is what it was made
 * from. Hearing the two back to back is how you judge the conversion rather than the laugh.
 */
export function fetchClip(
  id: string,
  of: 'render' | 'source' = 'render',
): Promise<{ audioBase64: string; contentType: string }> {
  return post('laughs/get', { id, of });
}

/**
 * Drops one render, or a laugh and every render made from it.
 *
 * Two scopes because there are two regrets: this laugh does not suit this voice, versus
 * this is not a good laugh. See functions/api/lipsync/laughs/delete.ts.
 */
export function deleteClip(
  id: string,
  of: 'render' | 'source' = 'render',
): Promise<{ removedRenders: number }> {
  return changed(post('laughs/delete', { id, of }));
}

/**
 * Base64 audio as something an <audio> element will play.
 *
 * A blob URL rather than a `data:` src, because a data URL of a minute of speech is a
 * megabyte of string in the DOM and Chrome will not seek inside one reliably. The caller
 * owns revoking it — see the object-URL handling on the page, which has the same duty
 * for files it was handed directly.
 */
export function audioUrl(base64: string, type = 'audio/mpeg'): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type }));
}
