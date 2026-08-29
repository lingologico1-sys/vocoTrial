import { json } from '../_middleware';
import type { LipsyncEnv } from './_library';

/**
 * What ElevenLabs says is left this month.
 *
 * A route rather than a call from the browser because the key must not leave the server,
 * which is the same reason generate.ts exists in this directory at all.
 *
 * READ FROM THE ACCOUNT, NEVER ASSUMED. The tier's published allowance and the account's
 * actual limit are different numbers — this one bills as `starter`, whose headline figure
 * is 30,000, and reports a limit of 88,736 because rollover has accumulated. Anything
 * that hardcoded the tier's number would have been wrong by a factor of three while
 * looking perfectly plausible, so nothing here is derived from the tier name.
 */
export async function onRequestPost(
  context: EventContext<LipsyncEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { env } = context;
  if (!env.ELEVENLABS_API_KEY) {
    return json({ error: 'ELEVENLABS_API_KEY is not configured', code: 'no_key' }, 500);
  }

  const upstream = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
  });

  if (!upstream.ok) {
    // Not fatal to the page: the cost panel simply shows the character count without a
    // quota beside it. Generating does not depend on this succeeding, so it must not be
    // able to stop someone generating.
    return json(
      { error: 'Could not read the ElevenLabs quota', code: 'quota_unavailable' },
      502,
    );
  }

  const sub = (await upstream.json()) as {
    tier?: string;
    character_count?: number;
    character_limit?: number;
    next_character_count_reset_unix?: number;
  };

  return json({
    tier: sub.tier ?? 'unknown',
    used: sub.character_count ?? 0,
    limit: sub.character_limit ?? 0,
    resetsAt: sub.next_character_count_reset_unix,
  });
}
