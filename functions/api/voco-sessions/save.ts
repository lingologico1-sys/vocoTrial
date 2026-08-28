import { json } from '../_middleware';
import {
  MAX_BRIEF,
  MAX_VOCABULARY,
  MAX_QUESTIONS,
  MAX_VOCO_SESSION,
  capMinutesOf,
  type VocoSession,
  looksLikeVocoSession,
} from '../../../src/realtime/vocoSessions';
import { PATIENCE, WHILE_TUTOR_SPEAKS } from '../../../src/realtime/settings';
import { findModel } from '../../../src/realtime/models';
import type { Patience, WhileTutorSpeaks } from '../../../src/realtime/settings';
import { PACE } from '../../../src/realtime/tutorPrompt';
import type { Pace } from '../../../src/realtime/tutorPrompt';
import { type VocoSessionEnv, readVocoSessions, writeVocoSessions } from './_library';

/**
 * Writes one Voco Session into the shared library.
 *
 * Keyed by its own id, so saving twice replaces rather than leaving two with
 * one name — what saving should mean for something still being drafted.
 *
 * The checks are shape checks, not a security boundary; the middleware has
 * already established the caller knew the site password. What they catch is a
 * malformed lesson reaching a live system prompt: the questions are asked out
 * loud by the tutor, and an empty entry produces a tutor asking a blank
 * question.
 *
 * THE TUTOR HALF IS CARRIED, NOT VALIDATED. `language`, `styleId`, `faceId`
 * and `evaluatorId` are ids naming things in four other libraries, and checking
 * them here would mean four reads on every save — and would still be stale by
 * the time anybody published, because a face can be deleted between the two.
 * They are resolved where they are spent, in the publish route, which is the
 * same posture `looksLikeSetup` takes on the motion enums and for the same
 * reason. A Voco Session naming a face since deleted is a picker that has lost
 * its selection, not a corrupt row.
 *
 * `voice` is not among them and is not carried. It was, until the voice became
 * the face's — see vocoSessions.ts. Dropping it here rather than passing it
 * through is what drains the stale field off rows that still have one: a save
 * writes the whole object, so the key is gone the next time a teacher touches
 * an old lesson.
 *
 * There is no built-in id to refuse, unlike evaluators/save.ts. Nothing ships,
 * so nothing can be shadowed by collision.
 */

interface SaveBody {
  session?: unknown;
}

/** Blank entries dropped rather than rejected — see the note in the header. */
const clean = (entries: string[], limit: number): string[] =>
  entries.map((entry) => entry.trim()).filter(Boolean).slice(0, limit);

/** Carried through only when it is the right sort of thing. See the header. */
const carried = <T>(value: unknown, ok: (candidate: unknown) => boolean): T | undefined =>
  ok(value) ? (value as T) : undefined;

export async function onRequestPost(
  context: EventContext<VocoSessionEnv, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  if (!env.VOCO_SESSIONS) {
    return json({ error: 'No Voco Session library is configured', code: 'no_bucket' }, 500);
  }

  const body = (await request.json().catch(() => null)) as SaveBody | null;
  if (!looksLikeVocoSession(body?.session)) {
    return json({ error: 'That is not a Voco Session', code: 'bad_session' }, 400);
  }

  const incoming = body.session;

  const questions = clean(incoming.questions, MAX_QUESTIONS + 1);
  if (!questions.length) {
    return json({ error: 'A Voco Session needs at least one question', code: 'no_questions' }, 400);
  }
  if (questions.length > MAX_QUESTIONS) {
    return json(
      { error: `That is more than ${MAX_QUESTIONS} questions`, code: 'too_many_questions' },
      400,
    );
  }

  const brief = incoming.brief.trim();
  if (brief.length > MAX_BRIEF) {
    return json({ error: `A consigne takes ${MAX_BRIEF} characters`, code: 'brief_too_long' }, 400);
  }

  /*
   * Clamped rather than refused, unlike the consigne above it. A consigne over
   * the limit is text a teacher wrote and would want back; a word list over the
   * limit is a paste accident, and the tail of it was never going to reach the
   * transcriber anyway — see MAX_KEYWORDS, which cuts at a hundred words well
   * inside this.
   */
  const vocabulary =
    typeof incoming.vocabulary === 'string'
      ? incoming.vocabulary.trim().slice(0, MAX_VOCABULARY)
      : '';

  const isText = (value: unknown) => typeof value === 'string';
  /*
   * Checked against the table rather than merely carried, unlike the ids above
   * it. Those name things in libraries this route cannot read, so carrying them
   * is the only option; this one is a closed vocabulary that lives in a file
   * this route already imports. An unrecognised word is dropped, and an absent
   * patience is spent as 'standard' — see patienceSettings.
   */
  const isPatience = (value: unknown) => PATIENCE.some((entry) => entry.key === value);
  /* The same closed vocabulary, checked the same way. See WHILE_TUTOR_SPEAKS. */
  const isWhileTutorSpeaks = (value: unknown) =>
    WHILE_TUTOR_SPEAKS.some((entry) => entry.key === value);
  /*
   * Checked against the allowlist for patience's reason and one of its own: a
   * model key is the field that decides which meter a lesson spends. Carrying
   * an arbitrary string would put that decision in the request body, which is
   * the hole models.ts opens by explaining. An unrecognised key is dropped and
   * reads as the default at publish.
   */
  const isModelKey = (value: unknown) => typeof value === 'string' && !!findModel(value);
  /* A closed vocabulary again, and the one this route used to drop. See PACE. */
  const isPace = (value: unknown) => PACE.some((entry) => entry.key === value);

  const session: VocoSession = {
    id: incoming.id,
    name: incoming.name.trim() || 'Untitled session',
    note: typeof incoming.note === 'string' ? incoming.note.trim() : '',
    brief,
    // Undefined rather than '' when nobody wrote one, so an untouched box
    // stores nothing instead of storing a blank.
    vocabulary: vocabulary || undefined,
    questions,
    language: carried<string>(incoming.language, isText),
    styleId: carried<string>(incoming.styleId, isText),
    faceId: incoming.faceId === null ? null : carried<string>(incoming.faceId, isText),
    evaluatorId: carried<string>(incoming.evaluatorId, isText),
    patience: carried<Patience>(incoming.patience, isPatience),
    /*
     * WRITTEN DOWN, WHICH `pace` BESIDE IT WAS NOT UNTIL NOW. That field was
     * on the type, on the page, in the publish body and nowhere in this list —
     * so a teacher who slowed the tutor down, saved, and reopened the lesson
     * found it back at 'natural', and only a publish from that same unreloaded
     * tab ever carried the choice. The two are added together because a reader
     * comparing them should not have to wonder which omission was deliberate.
     */
    pace: carried<Pace>(incoming.pace, isPace),
    whileTutorSpeaks: carried<WhileTutorSpeaks>(incoming.whileTutorSpeaks, isWhileTutorSpeaks),
    modelKey: carried<string>(incoming.modelKey, isModelKey),
    // Clamped rather than carried, unlike the ids above it. Those name things
    // in other libraries and are resolved where they are spent; this one is a
    // number with a range, and the range is knowable here.
    //
    // Written as `capMinutes` whatever arrived. `capMinutesOf` reads a legacy
    // `lengthMinutes` off rows that predate the cap, so re-saving one migrates
    // it — and the old key is simply not copied forward, which is how it
    // drains. See vocoSessions.ts.
    capMinutes: capMinutesOf(incoming),
    updatedAt: Date.now(),
  };

  const serialised = JSON.stringify(session);
  if (serialised.length > MAX_VOCO_SESSION) {
    return json({ error: 'That Voco Session is too long', code: 'too_large' }, 413);
  }

  const existing = await readVocoSessions(env.VOCO_SESSIONS);
  const without = existing.filter((entry) => entry.id !== session.id);
  await writeVocoSessions(env.VOCO_SESSIONS, [session, ...without]);

  return json({ session });
}
