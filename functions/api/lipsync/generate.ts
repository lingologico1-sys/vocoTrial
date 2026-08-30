import { json } from '../_middleware';
import { type LipsyncEnv, readClips } from './_library';
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
  laughSpan,
  laughTimeMs,
  overlayReactions,
  reactionSpans,
  splitLaughs,
  stripTags,
  wordCount,
  type Span,
} from '../../../src/lipsync/tags';
import {
  LAUGH_KINDS,
  eligible,
  laughClipKey,
  pick,
  shiftPast,
  type LaughClip,
  type LaughKind,
  type SplicedLaugh,
} from '../../../src/lipsync/laughs';
import { concat, sameFormat, scanMp3, splitAt } from './_mp3';
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
 *
 * THE LAUGHS ARE OURS NOW, which adds a third step between the two above. `[laughs]` and
 * `[giggles]` are v3 audio tags, and audio tags are advisory: the model decides per
 * generation whether to render one, so the same line laughed on one take and did not on
 * the next, with nothing downstream able to tell the difference. Those two tags are
 * therefore lifted out of the prompt entirely and replaced afterwards with a clip cut
 * from a take where the laugh came out well — same voice, same encoder, joined frame to
 * frame without a codec (see _mp3.ts and laughs.ts).
 *
 * The ordering below is the part worth reading carefully. Synthesis and alignment both
 * happen on the UNSPLICED speech, because that is the audio whose words MFA can align and
 * whose timings ElevenLabs stamped. Only then is the audio cut open, and every mark, word
 * and span that sits after an insertion is moved along by exactly what was inserted. Doing
 * it the other way — splicing first — would hand MFA a laugh with no transcript, which is
 * precisely the hazard the reaction overlay exists to work around.
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
  /** Ask the model for the laughs instead of splicing ours. See GenerateRequest. */
  harvest?: boolean;
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

/** Bytes as base64, the way get.ts does it. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Speech with our laughs cut into it, and a truthful account of where they went.
 *
 * THREE THINGS COME BACK BECAUSE THREE THINGS ARE NEEDED, and conflating any two of them
 * was the first version's bug. `placed` is on the FINAL timeline — where a listener will
 * hear each laugh, which is what the package records and what the spans are built from.
 * `insertions` is on the ORIGINAL one — the map from before to after, which is what marks
 * and words measured against the unspliced audio have to be shifted by. They differ by
 * exactly the laughs inserted earlier, and using one where the other belongs puts every
 * laugh after the first in the wrong place.
 *
 * The times in both are the times the cut ACTUALLY landed on, taken from `splitAt` rather
 * than from what was asked for. A cut lands on a frame boundary, up to 13ms from the
 * request; shifting marks by the request instead would leave them permanently
 * disagreeing with the audio for no reason at all. See _mp3.ts.
 *
 * EVERY REFUSAL IS SILENT AND EVERY REFUSAL IS SAFE. A clip whose object has gone, or
 * which will not scan, or whose format does not match the speech, is skipped — the line
 * comes back with one fewer laugh rather than with a 502, and because a skipped clip is
 * absent from both lists, the marks are shifted by what was really inserted rather than
 * by what was intended. The alternative, failing the whole generation because one clip in
 * a library of thirty went missing, costs a take from a paid quota to punish a
 * bookkeeping error.
 */
async function spliceLaughs(
  audio: Uint8Array,
  wanted: ReadonlyArray<{ clip: LaughClip; atMs: number }>,
  load: (id: string) => Promise<Uint8Array | null>,
): Promise<{
  spliced: Uint8Array;
  placed: SplicedLaugh[];
  insertions: Array<{ atMs: number; durationMs: number }>;
}> {
  const placed: SplicedLaugh[] = [];
  const insertions: Array<{ atMs: number; durationMs: number }> = [];
  let spliced = audio;
  // How much longer the buffer is than the timeline `wanted` was measured against.
  let grown = 0;

  for (const { clip, atMs } of wanted) {
    const scan = scanMp3(spliced);
    if (!scan) break;

    const bytes = await load(clip.id);
    if (!bytes) continue;
    const clipScan = scanMp3(bytes);
    if (!clipScan || !sameFormat(scan.format, clipScan.format)) continue;

    const { head, tail, atMs: cutAt } = splitAt(spliced, scan, atMs + grown);
    spliced = concat([head, bytes, tail]);

    placed.push({
      clipId: clip.id,
      kind: clip.kind,
      label: clip.label,
      atMs: cutAt,
      durationMs: clipScan.durationMs,
    });
    // Back onto the original timeline, which is where the marks still live.
    insertions.push({ atMs: cutAt - grown, durationMs: clipScan.durationMs });
    grown += clipScan.durationMs;
  }

  return { spliced, placed, insertions };
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

  // --- 0. Decide which laughs we can take over --------------------------------------
  //
  // Read before synthesis because the answer changes what is synthesised. A kind with an
  // eligible clip is lifted out of the prompt; a kind without one stays in it and takes
  // its chances with the model, which is what this route did before the library existed.
  // Deciding per kind rather than per tag keeps the prompt coherent: every `[giggles]` in
  // a line is treated the same way, so the model is not asked to giggle in one clause and
  // silently expected to skip it in the next.
  //
  // A harvesting run covers nothing on purpose — see GenerateRequest.harvest. It is how
  // a library that has taken every laugh out of the prompt can still be given a new one.
  const clips: LaughClip[] = env.LIPSYNC && !body.harvest ? await readClips(env.LIPSYNC) : [];
  const covered: LaughKind[] = LAUGH_KINDS.filter(
    (kind) => eligible(clips, kind, voiceId).length > 0,
  );
  const { spoken, laughs: lifted } = splitLaughs(text, covered);

  // Everything that was going to be said is now a laugh we removed. There is no audio to
  // align and nothing for a clip to be spliced into, so this is refused for the same
  // reason an all-tags line is, rather than synthesised as an empty string.
  if (!spoken.trim()) {
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
        // `spoken`, not `text`: the laugh tags we are covering ourselves never reach the
        // model, which is what makes its output deterministic where they used to be.
        text: spoken,
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

  const voiced = (await speech.json()) as {
    audio_base64?: string;
    alignment?: ElevenAlignment;
    normalized_alignment?: ElevenAlignment;
  };
  if (!voiced.audio_base64) {
    return json({ error: 'ElevenLabs returned no audio', code: 'tts_empty' }, 502);
  }

  // normalized_alignment is used only to locate tags, and it is worth recording what it
  // is NOT, because this comment used to claim the opposite. It does not spell numbers
  // out: sending "à 6 heures" returns "à 6 heures" in both alignments, padded with a
  // space and otherwise untouched. So there is no normalised transcript to hand the
  // aligner, and a digit reaches MFA as a digit, which no dictionary lists — the mouth
  // then shuts over a word the voice plainly said. Compose warns about digits before
  // anyone spends a generation on one; see scriptWarnings in warnings.ts.
  const alignment = voiced.normalized_alignment ?? voiced.alignment;

  // --- 2. Align the bytes we just made ---------------------------------------------
  const audio = Uint8Array.from(atob(voiced.audio_base64), (c) => c.charCodeAt(0));

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

  // --- 4. Splice our own laughs into the speech -------------------------------------
  const wanted = lifted
    .map((laugh) => ({
      clip: pick(clips, laugh.kind, voiceId),
      atMs: laughTimeMs(laugh, wordCount(script), result.words ?? [], result.durationMs),
    }))
    .filter((w): w is { clip: LaughClip; atMs: number } => w.clip !== null)
    .sort((a, b) => a.atMs - b.atMs);

  const { spliced, placed, insertions } = await spliceLaughs(audio, wanted, async (id) => {
    const object = env.LIPSYNC ? await env.LIPSYNC.get(laughClipKey(id)) : null;
    return object ? new Uint8Array(await object.arrayBuffer()) : null;
  });

  // --- 5. Move everything the splice pushed along -----------------------------------
  const shift = shiftPast(insertions);
  const addedMs = insertions.reduce((n, i) => n + i.durationMs, 0);

  // Spans and words move as wholes, by the shift at their start. Shifting an end
  // independently would let an insertion that lands inside one stretch it across a laugh
  // it has nothing to do with — a gesture made longer by an unrelated edit.
  const moved: Span[] = spans.map((s) => {
    const by = shift(s.startMs) - s.startMs;
    return { ...s, startMs: s.startMs + by, endMs: s.endMs + by };
  });
  const words = (result.words ?? []).map((w) => {
    const by = shift(w.startMs) - w.startMs;
    return { ...w, startMs: w.startMs + by, endMs: w.endMs + by };
  });

  // The laughs join the reaction spans and the whole list is put back in time order,
  // which leadIns depends on: it measures the quiet in front of a span against the end
  // of the one before it, and "the one before it" is an index, not a search.
  const all = [
    ...moved,
    ...placed.flatMap((p) => laughSpan(p.kind, p.atMs, p.durationMs) ?? []),
  ].sort((a, b) => a.startMs - b.startMs);

  const pkg: LipsyncPackage = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    name: nameFrom(script),
    text,
    spoken,
    script,
    language: language as LipsyncPackage['language'],
    voiceId,
    voiceName: body.voiceName,
    model,
    params,
    durationMs: result.durationMs + addedMs,
    oovCount: result.oovCount,
    oovWords: result.oovWords ?? [],
    reactionCount: all.length,
    laughs: placed,
    marks: overlayReactions(
      marks.map((m) => ({ ...m, timeMs: shift(m.timeMs) })),
      all,
      reactions,
    ),
    reactions,
    expressions: expressionSpans(all, reactions),
    words,
  };

  return json({
    package: pkg,
    // Base64 back to the browser rather than a URL, because nothing is stored yet —
    // this is a preview, and a preview that needed a bucket write would defeat the
    // point of previewing. The spliced bytes, not what ElevenLabs returned: the laughs
    // are in the audio, so save.ts stores audio that already matches its own marks.
    audioBase64: toBase64(spliced),
    alignment,
  });
}
