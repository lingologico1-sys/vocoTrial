import type { VoiceProfile } from '../../../src/lipsync/published';
import type { VoiceGender } from '../../../src/lipsync/laughs';

/**
 * What ElevenLabs knows about a voice, which is more than this app used to ask.
 *
 * The lookup already existed and read one field out of the answer. Everything else in
 * the response was discarded, including the two that decide whether an accent problem is
 * worth chasing at all: `labels.accent` says what accent the voice is *supposed* to have,
 * and `category` says where it came from. A voice labelled American is not going to speak
 * French-African however the tags are written, and a `premade` one cannot be re-cut from
 * better source audio because there is no source audio to re-cut. Those two facts turn
 * "the accent is weak, maybe it's the voice" into a settled question, and they were one
 * property access away the whole time.
 *
 * Labels are a free-form string map with no fixed schema — `accent`, `age`, `gender`,
 * `use_case` and `description` are conventional and none is guaranteed — so every field
 * here is optional and nothing is inferred from a missing one.
 */
export interface VoiceLookup {
  voiceId: string;
  name?: string;
  gender?: VoiceGender;
  profile: VoiceProfile;
}

/** The subset of /v1/voices/{id} this app reads. */
interface ElevenVoice {
  voice_id?: string;
  name?: string;
  category?: string;
  description?: string | null;
  labels?: Record<string, string> | null;
  verified_languages?: Array<{ language?: string; accent?: string; locale?: string }> | null;
}

const text = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || undefined;
};

/**
 * The voice, or why not.
 *
 * A RESULT AND NOT A NULL, because the two callers need different amounts of the answer
 * and one of them needs the status. voice.ts is *being asked* for a voice, so a failure
 * is the whole of its reply and the code matters: a 401 is this deployment's key being
 * wrong, which is a 500 and nothing the author can fix, while a 404 is the ID they just
 * pasted. Collapsing both to "not found" sends someone hunting for a typo in a voice ID
 * that was correct. generate.ts wants none of that — it ignores the failure entirely,
 * because the profile is a note on the package and a metadata call that did not answer
 * is not a reason to refuse a generation that would otherwise have worked.
 */
export type VoiceResult =
  | { ok: true; voice: VoiceLookup }
  | { ok: false; status: number; detail: string };

export async function lookupVoice(voiceId: string, key: string): Promise<VoiceResult> {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/voices/${encodeURIComponent(voiceId)}`,
    { headers: { 'xi-api-key': key } },
  );
  if (!response.ok) {
    return { ok: false, status: response.status, detail: (await response.text()).slice(0, 400) };
  }

  const voice = (await response.json()) as ElevenVoice;
  const labels = voice.labels ?? {};
  const labelled = labels.gender?.trim().toLowerCase();

  return {
    ok: true,
    voice: {
      voiceId: voice.voice_id ?? voiceId,
      name: text(voice.name),
      gender: labelled === 'male' || labelled === 'female' ? labelled : undefined,
      profile: {
        accent: text(labels.accent),
        age: text(labels.age),
        useCase: text(labels.use_case),
        category: text(voice.category),
        description: text(voice.description) ?? text(labels.description),
        // Kept as written rather than reduced to a list of language codes: the accent and
        // the locale are the informative half. A voice verified for French with a Canadian
        // locale is a different thing from one verified for French with a Senegalese one,
        // and a bare "fr" cannot tell the two apart.
        languages: (voice.verified_languages ?? [])
          .map((l) => [text(l.language), text(l.accent), text(l.locale)]
            .filter(Boolean)
            .join(' / '))
          .filter((l) => l.length > 0),
      },
    },
  };
}
