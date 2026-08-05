import { findModel, type Provider } from '../../../src/realtime/models';

/**
 * Turns the client's model key into a provider model id, or refuses.
 *
 * Both session routes go through this so they cannot disagree about what is
 * allowed. The provider check matters as much as the lookup: without it, a
 * caller could hand the OpenAI route a Gemini key and mint against whichever
 * id happened to be in the table.
 */
export function resolveModel(
  body: unknown,
  provider: Provider,
): { id: string; error?: undefined } | { id?: undefined; error: string } {
  const key = (body as { model?: unknown } | null)?.model;

  if (typeof key !== 'string' || !key) {
    return { error: 'A model key is required' };
  }

  const choice = findModel(key);
  if (!choice) return { error: `Unknown model "${key}"` };
  if (choice.provider !== provider) {
    return { error: `Model "${key}" is not a ${provider} model` };
  }

  return { id: choice.id };
}

/** Bodies are small and client-controlled; a parse failure is just a bad request. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
