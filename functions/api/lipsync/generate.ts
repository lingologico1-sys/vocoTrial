import { json } from '../_middleware';
import type { LipsyncEnv } from './_library';
import {
  DEFAULT_REACTIONS,
  DEFAULT_PARAMS,
  type ReactionOptions,
  type LipsyncModel,
  type LipsyncPackage,
  type VoiceParams,
  nameFrom,
} from '../../../src/lipsync/published';
import {
  expressionSpans,
  overlayReactions,
  reactionSpans,
  stripTags,
} from '../../../src/lipsync/tags';
import {
  POLLY_VISEMES,
  type PollyViseme,
  type VisemeMark,
} from '../../../src/live/visemeTable';

/**
 * Text in, a playable package out: audio, timings, transcript and marks, made together.
 *
 * THE POINT IS THAT THEY ARE MADE TOGETHER. Every one of these four artefacts existed
 * before; what did not exist was any guarantee they described the same utterance. They
 * were assembled by a person moving files between two tools, and the failure mode is
 * silent — a transcript that does not match its audio still aligns, and still returns a
 * confident set of marks. It happened twice in one afternoon. Nothing downstream can
 * detect it, because there is nothing inconsistent to detect: the marks are a correct
 * alignment of the wrong text.
 *
 * One request that synthesises and then aligns *the bytes it just synthesised* removes
 * the possibility rather than guarding against it. That is the whole reason this route
 * exists, and the reason it does the two calls in one place rather than exposing them
 * separately for a caller to sequence.
 *
 * WHY CLOUDFLARE AND NOT MODAL. The ElevenLabs key joins the others already here, and R2
 * is a native binding — Modal would reach it only over the S3 API with a second set of
 * credentials. image/generate.ts already awaits a slow provider inline, so a long
 * request is an established shape in this codebase rather than a new risk.
 *
 * Nothing is stored. The package comes back for the page to play and judge, and save.ts
 * writes it only if someone decides it is worth keeping — the same author-then-publish
 * split faceKit uses, and the reason tuning a voice does not fill a bucket with takes.
 */

interface GenerateBody {
  text?: string;
  language?: string;
  voiceId?: string;
  voiceName?: string;
  model?: LipsyncModel;
  params?: Partial<VoiceParams>;
  /** How reactions are performed. See ReactionOptions. */
  reactions?: Partial<ReactionOptions>;
}

const LANGUAGES = new Set(['en', 'fr', 'es']);
const MODELS = new Set<LipsyncModel>(['eleven_v3', 'eleven_multilingual_v2']);

/** What the aligner sends back. Its shape is fixed by lipsync/lip_sync_api.py. */
interface AlignResult {
  durationMs: number;
  oovCount: number;
  oovWords?: Array<{ word: string; startMs: number; endMs: number; reason: string }>;
  marks: Array<{ timeMs: number; polly: string }>;
  words: Array<{ word: string; startMs: number; endMs: number }>;
}

interface ElevenAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;

  if (!env.ELEVENLABS_API_KEY) {
    return json(
      { error: 'ELEVENLABS_API_KEY is not configured on this deployment', code: 'no_key' },
      500,
    );
  }
  if (!env.LIPSYNC_URL || !env.LIPSYNC_API_KEY) {
    return json(
      {
        error: 'LIPSYNC_URL / LIPSYNC_API_KEY are not configured, so nothing can align',
        code: 'no_aligner',
      },
      500,
    );
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return json({ error: 'Expected a JSON body', code: 'bad_body' }, 400);
  }

  const text = (body.text ?? '').trim();
  const language = body.language ?? 'en';
  const voiceId = (body.voiceId ?? '').trim();
  const model = body.model ?? 'eleven_v3';
  const params: VoiceParams = { ...DEFAULT_PARAMS, ...(body.params ?? {}) };
  const reactions: ReactionOptions = { ...DEFAULT_REACTIONS, ...(body.reactions ?? {}) };

  if (!text) return json({ error: 'Nothing to say', code: 'no_text' }, 400);
  if (!voiceId) return json({ error: 'No voice chosen', code: 'no_voice' }, 400);
  if (!LANGUAGES.has(language)) {
    return json({ error: `language must be one of ${[...LANGUAGES].join(', ')}` }, 400);
  }
  if (!MODELS.has(model)) {
    return json({ error: `model must be one of ${[...MODELS].join(', ')}` }, 400);
  }

  // The aligner is given the words and nothing else. A tag is a stage direction, not
  // something anybody said, and MFA would look one up, fail, and align it as silence —
  // shutting the mouth across a real word beside it. See tags.ts.
  const script = stripTags(text);
  if (!script) {
    return json({ error: 'That is all tags and no words', code: 'no_script' }, 400);
  }

  // --- 1. Synthesise, keeping the timings the synthesiser stamped -------------------
  const speech = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: {
          stability: params.stability,
          similarity_boost: params.similarityBoost,
          style: params.style,
          use_speaker_boost: params.speakerBoost,
        },
      }),
    },
  );

  if (!speech.ok) {
    const detail = await speech.text();
    return json(
      { error: 'ElevenLabs refused', code: 'tts_failed', detail: detail.slice(0, 600) },
      speech.status === 401 ? 500 : 502,
    );
  }

  const spoken = (await speech.json()) as {
    audio_base64?: string;
    alignment?: ElevenAlignment;
    normalized_alignment?: ElevenAlignment;
  };
  if (!spoken.audio_base64) {
    return json({ error: 'ElevenLabs returned no audio', code: 'tts_empty' }, 502);
  }

  // normalized_alignment is used only to locate tags, and it is worth recording what it
  // is NOT, because this comment used to claim the opposite. It does not spell numbers
  // out: sending "à 6 heures" returns "à 6 heures" in both alignments, padded with a
  // space and otherwise untouched. So there is no normalised transcript to hand the
  // aligner, and a digit reaches MFA as a digit, which no dictionary lists — the mouth
  // then shuts over a word the voice plainly said. Compose warns about digits before
  // anyone spends a generation on one; see scriptWarnings in warnings.ts.
  const alignment = spoken.normalized_alignment ?? spoken.alignment;

  // --- 2. Align the bytes we just made ---------------------------------------------
  const audio = Uint8Array.from(atob(spoken.audio_base64), (c) => c.charCodeAt(0));

  const form = new FormData();
  form.append('audio', new Blob([audio], { type: 'audio/mpeg' }), 'speech.mp3');
  form.append('script', script);
  form.append('language', language);

  const aligned = await fetch(env.LIPSYNC_URL, {
    method: 'POST',
    headers: { 'X-API-Key': env.LIPSYNC_API_KEY },
    body: form,
  });

  if (!aligned.ok) {
    const detail = await aligned.text();
    return json(
      {
        error: 'Alignment failed',
        code: 'align_failed',
        // A cold Modal container takes 30-60s to answer its first request. Say so,
        // because "alignment failed" on its own sends someone looking at their text.
        hint: aligned.status === 504 ? 'The aligner may have been cold; try again.' : undefined,
        detail: detail.slice(0, 600),
      },
      502,
    );
  }

  const result = (await aligned.json()) as AlignResult;

  // --- 3. Put the reactions back where the aligner could not -----------------------
  const marks: VisemeMark[] = result.marks
    .filter((m): m is { timeMs: number; polly: PollyViseme } =>
      Object.prototype.hasOwnProperty.call(POLLY_VISEMES, m.polly))
    .map((m) => ({ timeMs: m.timeMs, polly: m.polly, viseme: POLLY_VISEMES[m.polly] }));

  const spans = alignment
    ? reactionSpans(
        alignment.characters,
        alignment.character_start_times_seconds,
        alignment.character_end_times_seconds,
      )
    : [];

  const pkg: LipsyncPackage = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    name: nameFrom(script),
    text,
    script,
    language: language as LipsyncPackage['language'],
    voiceId,
    voiceName: body.voiceName,
    model,
    params,
    durationMs: result.durationMs,
    oovCount: result.oovCount,
    oovWords: result.oovWords ?? [],
    reactionCount: spans.length,
    marks: overlayReactions(marks, spans, reactions),
    reactions,
    expressions: expressionSpans(spans, reactions),
    words: result.words ?? [],
  };

  return json({
    package: pkg,
    // Base64 back to the browser rather than a URL, because nothing is stored yet —
    // this is a preview, and a preview that needed a bucket write would defeat the
    // point of previewing.
    audioBase64: spoken.audio_base64,
    alignment,
  });
}
