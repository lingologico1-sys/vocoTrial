import { type ModelChoice } from '../../../src/realtime/models';
import { type LanguageChoice } from '../../../src/realtime/languages';
import { MAX_INSTRUCTIONS, defaultInstructions } from '../../../src/realtime/instructions';
import { sanitizeSettings, type SessionSettings } from '../../../src/realtime/settings';

/**
 * Checks what the browser sent before any of it reaches Google.
 *
 * It used to serve two session routes as well as the relay, and carried lookups
 * for the model key and the language code to go with them. Those routes were
 * OpenAI's and are gone; the relay resolves its own model straight out of the
 * query string (see gemini.ts) because it needs the surface and the key that
 * travel with it, not just the id. What is left here is the pair that arrives
 * in the socket's opening frame, which is the only part of a call the client
 * gets to write.
 */

/**
 * What a lookup gives back. The `ok` flag is a literal on purpose: a union
 * discriminated on `error?: undefined` does not narrow — `string` is not a
 * literal type — so the value stayed `T | undefined` past the guard that was
 * meant to rule it out, and only escaped notice because a JSON field accepts
 * undefined without complaint.
 */
type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Takes the caller's system instructions, or supplies the default.
 *
 * The client is allowed to write this one. That is a deliberate reversal: the
 * prompt used to be server-only so that a visitor could not repurpose a metered
 * key, which was the right call for a public page and the wrong one for a
 * private rig whose entire job is comparing models on prompts you vary. The
 * password gate is what keeps strangers off the account now; see
 * src/realtime/instructions.ts.
 *
 * What is still refused from the client is the model key and the language code.
 * Those ride in the query string and are looked up against the allowlists in
 * models.ts and languages.ts, because the model decides which meter gets spent.
 */
export function resolveInstructions(body: unknown, language: LanguageChoice): Resolved<string> {
  const raw = (body as { instructions?: unknown } | null)?.instructions;

  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: defaultInstructions(language) };
  }

  if (typeof raw !== 'string') {
    return { ok: false, error: 'Instructions must be text' };
  }

  const text = raw.trim();
  if (!text) return { ok: true, value: defaultInstructions(language) };

  if (text.length > MAX_INSTRUCTIONS) {
    return {
      ok: false,
      error: `Instructions are limited to ${MAX_INSTRUCTIONS} characters`,
    };
  }

  return { ok: true, value: text };
}

/**
 * Reduces the caller's settings to what this model accepts.
 *
 * Never fails. Unknown keys are dropped, numbers are clamped and enums are
 * checked against the same table the picker renders from, so the worst a bad
 * settings object can do is fall back to the provider's own defaults. A 400
 * here would be worse than useless: it would reject a call over a knob the
 * caller could simply have left alone.
 */
export function resolveSettings(body: unknown, model: ModelChoice): SessionSettings {
  return sanitizeSettings((body as { settings?: unknown } | null)?.settings, model);
}

/**
 * Reduces the caller's transcription keywords to a list worth sending.
 *
 * Never fails, for the reason `resolveSettings` never fails: a bad keyword list
 * is not worth refusing a lesson over. Non-strings are dropped, everything is
 * trimmed, blanks and duplicates go, and the result is capped — the cap being
 * the point, since this arrives over a socket from a page that could send a
 * megabyte of them.
 *
 * The four-character floor and the hundred-word ceiling are argued where they
 * are applied — see `lessonKeywords` in _setup.ts. This is the same shape
 * enforced a second time on the far side of the network, because that function
 * runs in the browser's page and this one does not.
 */
export function resolveKeywords(body: unknown): string[] {
  const raw = (body as { keywords?: unknown } | null)?.keywords;
  if (!Array.isArray(raw)) return [];
  const words = raw
    .filter((word): word is string => typeof word === 'string')
    .map((word) => word.trim())
    .filter((word) => word.length >= 4 && word.length <= 64);
  return [...new Set(words)].slice(0, 100);
}
