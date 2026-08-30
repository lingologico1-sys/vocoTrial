import type { Quota } from './cost';
import type { LaughClip, LaughKind } from './laughs';
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
  model: LipsyncModel;
  params: VoiceParams;
  reactions: ReactionOptions;
  /**
   * Leave the laugh tags in the prompt and let ElevenLabs try, rather than splicing.
   *
   * This is how the library gets its first clip, and it is not an alternative mode. Once
   * a voice has laughs kept for it, `[laughs]` never reaches the model again — so without
   * a way to ask for one deliberately, the library could never grow past whatever
   * happened to be in it, and a voice with a single mediocre giggle would be stuck with
   * it forever. Off by default: the unreliability is the thing being fixed, and this is
   * the switch that goes looking for it on purpose.
   */
  harvest?: boolean;
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
 * Four calls rather than one because they are asked at four different moments: the
 * listing on mount, a cut when something worth keeping has just been heard, the audio
 * only when a clip is auditioned, and a delete rarely. See src/lipsync/laughs.ts for
 * what a clip is and functions/api/lipsync/laughs for what each route does.
 */
export async function listClips(): Promise<LaughClip[]> {
  const { clips } = await post<{ clips: LaughClip[] }>('laughs/list');
  return clips;
}

export interface CutRequest {
  /** A SAVED line. A clip is cut from R2, so an unsaved take has nothing to cut from. */
  sourceId: string;
  kind: LaughKind;
  startMs: number;
  endMs: number;
  label?: string;
}

/**
 * Keeps part of a saved line as a laugh.
 *
 * The times that come back are the times the cut actually landed on, which are up to
 * half a frame from the ones asked for — the caller should show those rather than its
 * own, so that what the panel says matches what the clip contains.
 */
export function cutClip(
  request: CutRequest,
): Promise<{ clip: LaughClip; audioBase64: string; cutFromMs: number; cutToMs: number }> {
  return post('laughs/cut', request);
}

export function fetchClip(id: string): Promise<{ audioBase64: string }> {
  return post<{ audioBase64: string }>('laughs/get', { id });
}

export function deleteClip(id: string): Promise<unknown> {
  return post('laughs/delete', { id });
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
