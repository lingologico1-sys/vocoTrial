import { json } from '../_middleware';
import { findLanguage } from '../../../src/realtime/languages';
import { MAX_INSTRUCTIONS, withPersona } from '../../../src/realtime/instructions';
import { FALLBACK_PERFORMANCE } from '../../../src/realtime/house';
import { newLessonCode } from '../../../src/realtime/lessonCodes';
import {
  MAX_SESSION,
  MAX_SESSION_LABEL,
  type PublishedSetup,
} from '../../../src/realtime/session';
import {
  MAX_QUESTIONS,
  MAX_TARGETS,
  lessonBlock,
  type VocoSession,
} from '../../../src/realtime/vocoSessions';
import { kitKey } from '../../../src/facekit/published';
import type { Persona } from '../../../src/facekit/persona';
import { readPerformance, readStyles, type HouseEnv } from '../house/_library';
import { codeTaken, writeSetup, type SessionEnv } from './_library';

/**
 * Publishes one Voco Session, and hands back the code to read out.
 *
 * WHAT ARRIVES IS A TEACHER'S CHOICES, NOT A FINISHED SETUP, and that inversion
 * is the point of this route. /teach used to be studio, which held a rendered
 * preset, twenty motion knobs and a face's persona in local state and posted
 * the assembled thing. A teacher has none of that and must not be asked to: so
 * what arrives is ids and lesson text, and everything a student's browser
 * eventually reads is composed here, where the house library and the face
 * bucket are both in reach.
 *
 * THE PROMPT IS BUILT IN THREE LAYERS, in this order, and the order is load
 * bearing:
 *
 *   1. the tutor style          what sort of tutor this is
 *   2. the persona wrap         who, if the worn face has a bio
 *   3. the lesson block         which questions, and what to steer towards
 *
 * The lesson goes last because instructions.ts says a constraint held across a
 * whole call survives longest at the end of the prompt, and a question list
 * held for a whole call is exactly that. The persona wraps the style rather
 * than being appended to it because `withPersona` puts the style under YOUR
 * JOB, which is what wins wherever the two disagree.
 *
 * THE PERSONA IS READ SERVER-SIDE, out of the kit in the face bucket. It could
 * have been sent from the browser, but /teach only ever fetches the face index
 * — names and thumbnails — and pulling several megabytes of artwork to reach
 * one paragraph of bio would be several megabytes spent on a field. A face that
 * cannot be read publishes without a persona rather than failing: a tutor with
 * no backstory is a working tutor, and a teacher pressing publish two minutes
 * before a lesson should not meet a face bucket's outage.
 *
 * THE CODE IS MINTED HERE, AND CHECKED. Six characters is a billion, which is
 * unlikely to collide and not unlikely enough to overwrite somebody's live
 * lesson on. Drawn and tested against the bucket, a bounded number of times,
 * then given up on loudly — the shape LingoLecto uses and docs/lesson-codes.md
 * writes down.
 *
 * A REPUBLISH MINTS A NEW CODE. There is no way to say "the same lesson, again"
 * because there is no reason to want one: a code names what was handed out, and
 * changing what a code resolves to after it has been read off a board is the
 * one thing publishing must never do. Publishing twice gives two codes, and the
 * teacher hands out whichever they meant.
 */

/** Codes to try before admitting something is wrong. LingoLecto's number. */
const CODE_ATTEMPTS = 20;

interface PublishBody {
  /** The lesson and the picks, as /teach holds them. */
  session?: unknown;
  /** What to call this on the teacher's list. Never shown to a student. */
  label?: unknown;
}

/** The bindings this route needs: the setups, the house, and the faces. */
type PublishEnv = SessionEnv & HouseEnv & { FACES?: R2Bucket };

/**
 * The worn face's persona, or undefined.
 *
 * Undefined for every reason — no face, no bucket, no kit, unreadable JSON, no
 * bio written. They collapse deliberately: `withPersona` treats undefined as
 * "no persona" and returns the style untouched, so every one of these paths
 * lands on a tutor that works.
 */
async function personaFor(
  bucket: R2Bucket | undefined,
  faceId: string | null,
): Promise<Persona | undefined> {
  if (!bucket || !faceId) return undefined;

  try {
    const object = await bucket.get(kitKey(faceId));
    if (!object) return undefined;
    const kit = (await object.json()) as { persona?: Persona };
    return kit.persona;
  } catch {
    return undefined;
  }
}

/** Blank entries dropped, the way the save route drops them. */
const clean = (entries: unknown, limit: number): string[] =>
  Array.isArray(entries)
    ? entries
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .slice(0, limit)
    : [];

export async function onRequestPost(
  context: EventContext<PublishEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.SESSIONS) {
    return json({ error: 'No session library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as PublishBody | null;
  const incoming = body?.session as Partial<VocoSession> | undefined;
  if (!incoming || typeof incoming !== 'object') {
    return json({ error: 'That is not a Voco Session', code: 'bad_session' }, 400);
  }

  // Resolved rather than trusted, the rule the live and report paths both
  // follow: a language that is not on the list is one nothing downstream can
  // build a prompt for.
  const language = findLanguage(typeof incoming.language === 'string' ? incoming.language : '');
  if (!language) {
    return json({ error: 'Unknown language', code: 'bad_language' }, 400);
  }

  const questions = clean(incoming.questions, MAX_QUESTIONS);
  const targets = clean(incoming.targets, MAX_TARGETS);
  if (!questions.length) {
    return json({ error: 'A Voco Session needs at least one question', code: 'no_questions' }, 400);
  }

  /*
   * The style, resolved the way houseStore.resolveStyle resolves it.
   *
   * The two agree on purpose: /teach shows a fallback selection when the named
   * style is gone, and a route that fell back differently would publish a tutor
   * other than the one the teacher was looking at. Newest first is the order
   * the house library writes, so `[0]` here and `[0]` there are the same style.
   */
  const styles = env.HOUSE ? await readStyles(env.HOUSE) : [];
  const style = styles.find((entry) => entry.id === incoming.styleId) ?? styles[0] ?? null;
  if (!style) {
    return json(
      {
        error:
          'No tutor style has been published yet. An administrator saves one from studio before a lesson can go out.',
        code: 'no_style',
      },
      400,
    );
  }

  const faceId = typeof incoming.faceId === 'string' ? incoming.faceId : null;
  const persona = await personaFor(env.FACES, faceId);

  const instructions = `${withPersona(style.text, persona)}${lessonBlock({ questions, targets })}`;

  /*
   * The same ceiling the live session enforces, checked here instead of there.
   *
   * A prompt that overflows fails at connect time — which on the student page
   * would mean somebody pressing Commencer and being told the instructions are
   * too long, about a prompt they have never seen and cannot shorten. Refusing
   * the publish puts the error in front of the person who can act on it, and
   * names the three parts so they know which one to cut.
   */
  if (instructions.length > MAX_INSTRUCTIONS) {
    return json(
      {
        error: `The style, the persona and the questions come to ${instructions.length} characters together, and a session takes ${MAX_INSTRUCTIONS}. Shorten the questions, or pick a face with a shorter biography.`,
        code: 'too_long',
      },
      400,
    );
  }

  /*
   * The house profile, or the face's own defaults.
   *
   * Flattened into the setup rather than referenced, for session.ts's reason:
   * what was handed out stays handed out, so an administrator retuning studio
   * next week cannot change how a face already in front of a class behaves.
   */
  const performance =
    (env.HOUSE ? await readPerformance(env.HOUSE) : null) ?? FALLBACK_PERFORMANCE;

  let code: string | null = null;
  for (let attempt = 0; attempt < CODE_ATTEMPTS && !code; attempt += 1) {
    const candidate = newLessonCode();
    if (!(await codeTaken(env.SESSIONS, candidate))) code = candidate;
  }
  if (!code) {
    return json(
      { error: 'Could not find an unused code. Try again.', code: 'no_code' },
      503,
    );
  }

  const label =
    typeof body?.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, MAX_SESSION_LABEL)
      : typeof incoming.name === 'string'
        ? incoming.name.trim().slice(0, MAX_SESSION_LABEL)
        : undefined;

  const setup: PublishedSetup = {
    ...performance,
    code,
    label: label || undefined,
    updatedAt: Date.now(),
    language: language.code,
    instructions,
    voice: typeof incoming.voice === 'string' ? incoming.voice : '',
    faceId,
    evaluatorId: typeof incoming.evaluatorId === 'string' ? incoming.evaluatorId : '',
    // The lesson, copied rather than referenced — see session.ts. The questions
    // are already inside `instructions` above; these are the same text again,
    // structurally, so the student page can render a list instead of a wall of
    // prompt. A few hundred duplicated bytes against MAX_SESSION's 30,000,
    // bought deliberately.
    brief: typeof incoming.brief === 'string' ? incoming.brief : '',
    targets,
    questions,
    vocoSessionId: typeof incoming.id === 'string' ? incoming.id : undefined,
    vocoSessionName: typeof incoming.name === 'string' ? incoming.name : undefined,
  };

  if (JSON.stringify(setup).length > MAX_SESSION) {
    return json({ error: 'That setup is too large', code: 'too_large' }, 413);
  }

  await writeSetup(env.SESSIONS, setup);

  return json({ setup });
}
