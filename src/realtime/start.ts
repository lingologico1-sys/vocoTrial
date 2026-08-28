import { startGeminiSession } from './gemini';
import { startOpenAiSession } from './openai';
import { findModel } from './models';
import type { SessionConfig, SessionHandlers, VoiceSession } from './types';

/**
 * Dials whichever provider the chosen model belongs to.
 *
 * A LOOKUP AND A BRANCH, AND THAT IS THE ENTIRE PROVIDER ABSTRACTION. There is
 * no interface with two implementations registered against it, no factory and
 * no registry, because two entries do not need one: what the pages actually
 * depend on is `SessionHandlers`, which both clients satisfy and neither owns.
 * Adding a third provider is a line here and a file beside the other two.
 *
 * IT LIVES IN ITS OWN FILE TO KEEP THE TWO CLIENTS FROM KNOWING ABOUT EACH
 * OTHER. Putting this at the bottom of gemini.ts would make every page that
 * dials Gemini import the OpenAI client and vice versa — harmless for the
 * bundle, and a genuine nuisance the first time one of them needs a module the
 * other cannot load.
 *
 * An unknown key is a programming error rather than a user one — every path
 * that reaches here has already resolved its key against the same allowlist —
 * so it throws rather than falling back to a default that would spend a
 * different meter than the caller asked for.
 */
export function startSession(
  handlers: SessionHandlers,
  modelKey: string,
  language: string,
  config: SessionConfig = {},
): Promise<VoiceSession> {
  const model = findModel(modelKey);
  if (!model) throw new Error(`Unknown model "${modelKey}"`);
  return model.provider === 'openai'
    ? startOpenAiSession(handlers, modelKey, language, config)
    : startGeminiSession(handlers, modelKey, language, config);
}
