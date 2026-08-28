import { json } from '../_middleware';
import { findLanguage } from '../../../src/realtime/languages';
import {
  MAX_INSTRUCTIONS,
  defaultInstructions,
  findInstructionPreset,
} from '../../../src/realtime/instructions';
import { PACE, composeTutorPrompt, paceSpeed } from '../../../src/realtime/tutorPrompt';
import {
  DEFAULT_OPENAI_VOICE,
  patienceSettings,
} from '../../../src/realtime/settings';
import { FALLBACK_PERFORMANCE } from '../../../src/realtime/house';
import { newLessonCode } from '../../../src/realtime/lessonCodes';
import { defaultModelKey, findModel, isOpenAi } from '../../../src/realtime/models';
import {
  MAX_SESSION,
  MAX_SESSION_LABEL,
  type PublishedSetup,
} from '../../../src/realtime/session';
import {
  MAX_QUESTIONS,
  capMinutesOf,
  type VocoSession,
  MAX_VOCABULARY,
} from '../../../src/realtime/vocoSessions';
import { kitKey } from '../../../src/facekit/published';
import type { Persona } from '../../../src/facekit/persona';
import { readLessonRules, readPerformance, readStyles, type HouseEnv } from '../house/_library';
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
 * IT NO LONGER COMPOSES THE PROMPT, and that is the change this route exists
 * to carry. It resolves the four things a prompt is built from — the style and
 * the lesson rules out of the house library, the persona out of the face
 * bucket, the lesson out of the request — and stores them as data. The student page composes them when it
 * dials. What a teacher decided is still frozen at this moment; what is really
 * a protocol between the prompt and the tools a call declares now moves with
 * the build that implements it. See session.ts and composeTutorPrompt.
 *
 * It still composes one *for measurement*, below, because a prompt too long to
 * send should fail in front of the teacher rather than in front of the class.
 *
 * THE PERSONA IS READ SERVER-SIDE, out of the kit in the face bucket. It could
 * have been sent from the browser, but /teach only ever fetches the face index
 * — names and thumbnails — and pulling several megabytes of artwork to reach
 * one paragraph of bio would be several megabytes spent on a field. A face that
 * cannot be read publishes without a persona rather than failing: a tutor with
 * no backstory is a working tutor, and a teacher pressing publish two minutes
 * before a lesson should not meet a face bucket's outage.
 *
 * THE VOICE COMES OFF THAT SAME PERSONA, and nothing else may set it. A teacher
 * picks a person to put in front of a class, not a larynx: a paragraph saying
 * "my name is Marta, I'm 34" and the voice that delivers it are two halves of
 * one character, and the only thing that knows both is the kit an administrator
 * authored. /teach used to carry its own voice picker beside the face picker,
 * which meant the two halves could be chosen by different people on different
 * days — so it is gone, and this is where the voice is resolved instead.
 *
 * It is spent here the way `performance` below is spent here, and for the same
 * reason: both are an administrator's, both live in a library a teacher never
 * opens, and both are flattened into the setup so that retuning one next week
 * cannot change a lesson already in front of a class.
 *
 * A face with no opinion — and the deployment's own face, which has no kit in
 * the bucket to hold one — publishes an empty string. settings.ts reads that as
 * "leave it upstream" rather than "pin today's default", which is the same
 * answer the bio gives on the same faces.
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
 * bio written. They collapse deliberately: the composer treats undefined as
 * "no persona" and leaves the section out, so every one of these paths lands on
 * a tutor that works.
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
  /*
   * The lesson rules, which unlike the style have no id and cannot be missing
   * in a way that stops a publish. Null is an ordinary state — the state every
   * deployment is in until somebody rewrites the block — and it composes the
   * text this build ships with. So there is no `no_rules` refusal to match the
   * `no_style` one below: a tutor with no instructions is not a tutor, and a
   * tutor with the build’s own instructions is exactly the tutor of last week.
   */
  const lessonRules = env.HOUSE ? await readLessonRules(env.HOUSE) : null;
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

  /*
   * The style, in the language this lesson is being taught in.
   *
   * A style is prose frozen when an administrator published it, and the
   * language it was frozen against is the language studio had on screen that
   * afternoon — not the language of the lesson going out now. Where the prose
   * came out of a built-in, the key is here and the built-in is a function of
   * the language, so it is rendered again for `language` and the frozen copy is
   * ignored. Where it did not — a prompt an administrator wrote themselves —
   * there is nothing to re-render, the text stands as written, and the mismatch
   * is /teach's to show. See `TutorStyle.preset`.
   *
   * This is the fix for a French lesson whose tutor opened in English: every
   * rule in the prompt honoured, in the wrong language, because the manner had
   * been published off an English picker.
   */
  const preset = findInstructionPreset(style.preset ?? '');
  const styleText = preset ? preset.render(language) : style.text;

  const faceId = typeof incoming.faceId === 'string' ? incoming.faceId : null;
  const persona = await personaFor(env.FACES, faceId);

  /*
   * Clamped here rather than trusted, the rule every id on this route follows.
   * A hand-written POST asking for a four-hour lesson gets MAX_CAP_MINUTES, and
   * one asking for zero gets the floor — `capMinutesOf` is the single place
   * that decides.
   *
   * It never reaches the prompt, and that is deliberate rather than an
   * oversight left over from the rename: the cap is the student page's alone,
   * and a tutor told a length paces to fill it. See vocoSessions.ts above
   * `MIN_CAP_MINUTES`, and `composeTutorPrompt`, which takes no minutes at all.
   */
  const capMinutes = capMinutesOf(incoming);

  /*
   * Composed here only to be measured, and thrown away.
   *
   * The student page builds this again at dial time from the fields stored
   * below, with whatever composer is running then — so this is not the text
   * that will be sent, and must not be stored as though it were. What it is
   * good for is the one check that has to happen in front of the person who can
   * act on it: a prompt over the ceiling fails at connect, and a student
   * pressing Commencer cannot shorten a biography they have never seen.
   *
   * It reads the same defaults the student page will: a setup with no style
   * falls back to the built-in preset there too.
   */
  /*
   * The pace, resolved here rather than carried, which is the rule every word
   * on this route follows: a word that names nothing becomes the default rather
   * than a 400, the same call `patienceSettings` makes. An unknown pace is a
   * lesson that talks at its own speed, which is a lesson; a 400 is a teacher
   * two minutes before a class.
   */
  const pace = PACE.find((entry) => entry.key === incoming.pace)?.key ?? 'natural';

  const composed = composeTutorPrompt({
    style: styleText || defaultInstructions(language),
    rules: lessonRules ?? undefined,
    persona,
    pace,
    questions,
  });

  /*
   * The same ceiling the live session enforces, checked here instead of there.
   *
   * A prompt that overflows fails at connect time — which on the student page
   * would mean somebody pressing Commencer and being told the instructions are
   * too long, about a prompt they have never seen and cannot shorten. Refusing
   * the publish puts the error in front of the person who can act on it, and
   * names the three parts so they know which one to cut.
   */
  if (composed.length > MAX_INSTRUCTIONS) {
    return json(
      {
        error: `The style, the persona and the questions come to ${composed.length} characters together, and a session takes ${MAX_INSTRUCTIONS}. Shorten the questions, or pick a face with a shorter biography.`,
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

  /*
   * The model this lesson runs on, resolved here rather than carried.
   *
   * Resolved for the reason every id on this route is resolved: what a student
   * dials has to be a thing this deployment can serve, and the only place that
   * is knowable is the allowlist. A key that names nothing — a hand-written
   * POST, or a lesson saved against a model since retired — becomes the default
   * rather than a 400, which is the same call `patienceSettings` makes on an
   * unknown word. A published code that opens onto the default model is a
   * lesson; one that opens onto nothing is a class standing about.
   *
   * IT MOVED ABOVE THE THREE THINGS THAT NOW READ IT. Patience, the voice and
   * the pace all mean different things on different providers — a silence
   * duration against a semantic detector, two voice vocabularies that share no
   * name, prose against a synthesis rate — so all three are resolved knowing
   * which model this lesson will actually dial.
   */
  const model = findModel(incoming.modelKey ?? '') ?? findModel(defaultModelKey());
  const modelKey = model?.key ?? defaultModelKey();

  /*
   * The lesson's patience, over the house profile's turn-taking.
   *
   * Spread after `performance` and so it wins, which is the whole point: a
   * house profile is tuned once by an administrator for every lesson this
   * deployment runs, and how long to wait for a learner assembling a sentence
   * is the one turn-taking decision that belongs to the class in front of you.
   * A lesson on 'standard' sends nothing and leaves the house profile's own
   * fields — including the absence that means "let the provider decide" —
   * untouched.
   */
  const patience = model ? patienceSettings(incoming.patience, model) : {};


  const setup: PublishedSetup = {
    ...performance,
    ...patience,
    code,
    label: label || undefined,
    updatedAt: Date.now(),
    language: language.code,
    modelKey,
    // The halves of a prompt that are a teacher's and an administrator's, stored
    // as they were at this moment. What is not stored is the protocol the tutor
    // is told to follow — the tool it calls and the notes it will be sent —
    // which is the build's, and travels with the build that implements it.
    // `lessonRules` sits on the administrator's side of that line and not on
    // the build's; see session.ts, and DEFAULT_LESSON_RULES on where the line
    // falls. Undefined rather than '' when nobody has written one, so an
    // unconfigured house stores nothing instead of storing a blank.
    style: styleText,
    lessonRules: lessonRules ?? undefined,
    // 'natural' composes nothing, so it is stored as nothing: a setup with no
    // pace and a setup asking for the tutor's own pace are the same lesson, and
    // only one of them needs a field. The same bargain `lessonRules` takes on
    // the line above.
    pace: pace === 'natural' ? undefined : pace,
    /*
     * The same pace again, as a rate this time, where the model takes one.
     *
     * The line above stores the teacher's word so the prompt can be composed
     * from it when the student dials; this stores the number that word means to
     * this provider. Both, not either — see PACE in tutorPrompt.ts. Absent on
     * Gemini, which has no such field, and absent on 'natural', which asks for
     * nothing on any provider.
     */
    speed: model && isOpenAi(model) ? paceSpeed(pace) : undefined,
    persona,
    /*
     * Off the face, never off the request — see the header. An incoming `voice`
     * is a field /teach no longer sends, and honouring one would leave the door
     * open for a hand-written POST to put Fenrir behind Marta's biography.
     *
     * WHICH OF THE FACE'S TWO VOICES IS A FACT ABOUT THE MODEL, and it is
     * settled here rather than at dial time because the setup carries one
     * `voice` field and always has. The consequence is worth stating: changing
     * a lesson's model changes its voice, and the lesson has to be republished
     * for that to take. That is the right way round — a code already handed out
     * to a class should not change how the tutor sounds because somebody edited
     * a draft — and it is the same bargain every other field on this object
     * takes. See session.ts.
     *
     * A face with no OpenAI voice falls back rather than sending nothing: an
     * absent voice is a provider default nobody chose, and the whole point of
     * putting the voice on the face is that somebody did.
     */
    voice:
      (model && isOpenAi(model)
        ? (persona?.openAiVoice ?? DEFAULT_OPENAI_VOICE)
        : persona?.voice) ?? '',
    faceId,
    evaluatorId: typeof incoming.evaluatorId === 'string' ? incoming.evaluatorId : '',
    // The lesson, copied rather than referenced — see session.ts. It is stored
    // once now rather than twice: it used to be here structurally *and* inside
    // a composed prompt, and the prompt is composed when the student dials.
    brief: typeof incoming.brief === 'string' ? incoming.brief : '',
    // Undefined rather than '' when nobody wrote one, on the same terms as
    // `lessonRules` above: an unfilled box stores nothing, not a blank.
    vocabulary:
      typeof incoming.vocabulary === 'string' && incoming.vocabulary.trim()
        ? incoming.vocabulary.trim().slice(0, MAX_VOCABULARY)
        : undefined,
    questions,
    capMinutes,
    vocoSessionId: typeof incoming.id === 'string' ? incoming.id : undefined,
    vocoSessionName: typeof incoming.name === 'string' ? incoming.name : undefined,
  };

  if (JSON.stringify(setup).length > MAX_SESSION) {
    return json({ error: 'That setup is too large', code: 'too_large' }, 413);
  }

  await writeSetup(env.SESSIONS, setup);

  return json({ setup });
}
