import { findModel, type ModelChoice, type Provider } from '../../../src/realtime/models';
import {
  defaultLanguageCode,
  findLanguage,
  type LanguageChoice,
} from '../../../src/realtime/languages';
import { MAX_INSTRUCTIONS, defaultInstructions } from '../../../src/realtime/instructions';
import { sanitizeSettings, type SessionSettings } from '../../../src/realtime/settings';

/**
 * What a lookup gives back. The `ok` flag is a literal on purpose: a union
 * discriminated on `error?: undefined` does not narrow — `string` is not a
 * literal type — so the value stayed `T | undefined` past the guard that was
 * meant to rule it out, and only escaped notice because a JSON field accepts
 * undefined without complaint.
 */
type Resolved<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Turns the client's model key into a provider model id, or refuses.
 *
 * Both session routes go through this so they cannot disagree about what is
 * allowed. The provider check matters as much as the lookup: without it, a
 * caller could hand the OpenAI route a Gemini key and mint against whichever
 * id happened to be in the table.
 */
export function resolveModel(body: unknown, provider: Provider): Resolved<ModelChoice> {
  const key = (body as { model?: unknown } | null)?.model;

  if (typeof key !== 'string' || !key) {
    return { ok: false, error: 'A model key is required' };
  }

  const choice = findModel(key);
  if (!choice) return { ok: false, error: `Unknown model "${key}"` };
  if (choice.provider !== provider) {
    return { ok: false, error: `Model "${key}" is not a ${provider} model` };
  }

  // The whole choice, not just the id: which settings a request may carry
  // depends on the model, not only on the provider. See settings.ts.
  return { ok: true, value: choice };
}

/**
 * Turns the client's language code into a checked choice, or refuses.
 *
 * Unlike the model key this one reaches a provider as free text — Whisper's
 * `prompt` is a decoding hint, which is to say a small prompt injection surface
 * on a metered key. Only the samples in languages.ts are ever sent, so the
 * client picks from a list rather than writing into it.
 *
 * An absent code is not an error: it means the caller never asked, and the
 * default language is a better answer than a 400.
 */
export function resolveLanguage(body: unknown): Resolved<LanguageChoice> {
  const code = (body as { language?: unknown } | null)?.language;

  if (code === undefined || code === null || code === '') {
    return { ok: true, value: defaultLanguage() };
  }

  if (typeof code !== 'string') {
    return { ok: false, error: 'A language must be a code like "fr"' };
  }

  const choice = findLanguage(code);
  if (!choice) return { ok: false, error: `Unsupported language "${code}"` };

  return { ok: true, value: choice };
}

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
 * Those decide what gets spent and what reaches a provider as free text.
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

/** The default is a code in the same list, so this cannot miss. */
export function defaultLanguage(): LanguageChoice {
  const choice = findLanguage(defaultLanguageCode());
  if (!choice) throw new Error('The default language is not in LANGUAGES');
  return choice;
}

/** Bodies are small and client-controlled; a parse failure is just a bad request. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
