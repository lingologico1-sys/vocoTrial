/**
 * Who the face is, as opposed to what it looks like.
 *
 * A kit has always carried a `name`, and a name is a label on artwork rather
 * than a person: it tells the picker which portrait you mean and tells the
 * model nothing at all. This is the other half — a paragraph the tutor can be
 * given as their own background, so that "where are you from?" has an answer
 * and the same face gives the same answer twice.
 *
 * IT LIVES ON THE KIT, NOT IN A PRESET, and that is the whole design. A preset
 * says what a tutor *does* — corrects every turn, or only when there is
 * something to correct — and it is the axis this rig exists to measure models
 * along. A biography says who is doing it. Weaving one into the prose of
 * `corrective()` would fork all five prompts and end the comparability the
 * preset list is for; hanging it off the kit means any face can be worn under
 * any preset, and the persona can be switched off to measure what it cost.
 *
 * Deliberately free of imports, like imageModels.ts and published.ts beside it:
 * realtime/instructions.ts reads this type, and that file is compiled by
 * functions/ against workers-types with no DOM lib.
 */

/**
 * Mostly prose, structured only where something other than the model reads it.
 *
 * The temptation is a form — age, city, occupation, hobbies, a quirk — and it
 * is the wrong shape twice over. What the model consumes is a paragraph, so
 * fields only buy a rendering step that reassembles one; and a twelve-field
 * form is a form nobody fills in, where a text box with a portrait beside it
 * gets written. The two named fields are here because code reads them: the
 * composed prompt needs a name it can rely on even when the paragraph forgets
 * to give one, and the voice is a pick liveTrial makes on the kit's behalf.
 */
export interface Persona {
  /**
   * What the person is called, as distinct from `FaceKit.name`, which names the
   * artwork. Usually the same word in practice and not the same thing: renaming
   * a kit to "marta-v3-glasses" should not rename the tutor.
   */
  fullName: string;
  /** One first-person paragraph. Prompt text, not display copy. */
  bio: string;
  /**
   * The voice this face was written for. A name from VOICES in
   * realtime/settings.ts, or absent for no opinion.
   *
   * Here rather than in liveTrial's prefs because it belongs to the character:
   * the loudest failure this whole feature can produce is a paragraph saying
   * "my name is Marta, I'm 34" delivered in Fenrir's voice, and the kit is the
   * only thing that knows both halves. Advisory — liveTrial adopts it when you
   * change face, and a deliberate pick afterwards still wins.
   */
  voice?: string;
}

/**
 * A ceiling on the paragraph, in characters.
 *
 * Not a safety limit — MAX_INSTRUCTIONS in realtime/instructions.ts is what
 * stops a composed prompt overrunning, and this sits comfortably inside it with
 * the longest preset. It is a *drafting* limit, which is a different argument:
 * the persona competes with the pedagogy for the model's attention, and a
 * biography long enough to be interesting is long enough to be performed. About
 * a hundred and fifty words is the most that stays texture rather than topic.
 */
export const MAX_BIO_CHARS = 1200;

/** Long enough for any name, short enough not to smuggle a second prompt in. */
export const MAX_NAME_CHARS = 80;

/**
 * Whether there is anything here worth sending.
 *
 * Absent and empty are treated alike on purpose: a kit authored before personas
 * existed and a kit whose text box was cleared are the same instruction, which
 * is "wear this face and say nothing about yourself".
 */
export function hasPersona(persona?: Persona): persona is Persona {
  return Boolean(persona && (persona.fullName.trim() || persona.bio.trim()));
}

/** What faceKit starts a new persona from. */
export function emptyPersona(): Persona {
  return { fullName: '', bio: '' };
}

/**
 * The model that drafts a persona from the portrait, and what it costs.
 *
 * One model, named here rather than sent by the browser — the same rule as
 * realtime/models.ts and imageModels.ts, arrived at from the other direction.
 * There is no key to resolve because there is no choice to offer: this is a
 * paragraph of English generated from one picture, a job every text model does
 * well and none does distinctively, so a picker would be a knob with nothing to
 * learn from it.
 *
 * VERIFIED, in exactly the sense imageModels.ts means it: the id has been seen
 * to return text on this account's Vertex key. Nothing here could check it —
 * the keys live only in Cloudflare — so the proof was a draft that worked, on
 * 2026-08-18, and not that the id looked right. The flag stays rather than
 * going, because it is the answer to a question the next model id will raise
 * again, and `false` is a claim about this one rather than an absence.
 *
 * The rates are list prices per million tokens, read on the date below, and
 * they are used for real rather than for decoration: the route bills from the
 * token counts Vertex reports, so a kit's `spentUsd` absorbs this call instead
 * of quietly missing it. It does not model the discount Vertex gives on cached
 * input — see costUsd in the route for why a made-up factor would be worse than
 * paying the sticker price on a fraction of a cent.
 */
export const PERSONA_MODEL = {
  id: 'gemini-2.5-flash',
  label: 'Gemini 2.5 Flash',
  unverified: false,
  usdPerMillionInput: 0.3,
  usdPerMillionOutput: 2.5,
  ratesReadOn: '2026-08-18',
};

/**
 * A ceiling on the drafting prompt, in characters.
 *
 * Same reasoning as MAX_INSTRUCTIONS: it is not the gate, it is so a runaway
 * paste fails with our own 400 rather than as an opaque platform error partway
 * through an upstream call.
 */
export const MAX_DRAFT_PROMPT = 4000;

/**
 * What the model is asked for, and why it is asked in this shape.
 *
 * Free text at the call site for the same reason the image route takes a free
 * prompt: this rig exists to compare what different wordings produce, and a
 * server-owned prompt would defeat that. This is the wording it starts from.
 *
 * Three things in here are doing work rather than being polite:
 *
 *  - Concrete facts, itemised. "Warm and patient" is unactionable — a model
 *    given adjectives has nothing to say when asked a question, and fills the
 *    gap by narrating its own personality. A hometown and two cats can become
 *    an answer, or an example sentence, which is what a persona is for.
 *  - No description of the picture. Left to itself the model writes about hair
 *    and clothing, which is the one thing the tutor can never refer to and the
 *    learner can already see.
 *  - Somewhere the target language is spoken. This is the only line here that
 *    changes the teaching rather than the small talk: a stated region is
 *    something these models genuinely act on, and it is the only handle this
 *    app has on dialect at all — settings.ts cannot send a BCP-47 region, so
 *    "I grew up in Seville" is the whole of the accent control.
 *
 * JSON out, because two fields have to come back separately and asking for a
 * labelled line is the version that fails silently when the model ignores it.
 * The caller falls back to treating the whole reply as the paragraph.
 */
export function draftPrompt(language: string): string {
  return `Look at this portrait and invent the person in it.

They are going to be a ${language} tutor on a voice call, and this is their own
background — so place them somewhere ${language} is spoken and write it in the
first person.

Make it concrete and usable in conversation: their full name, roughly how old
they are, the town or city they are from, what they do, who they live with, two
things they spend their spare time on, and one opinion they will happily repeat.
About a hundred words. Match the portrait's apparent age and gender.

Do not describe the picture — nothing about hair, clothes or expression, which
the learner can already see. Do not mention teaching or languages.

Reply with JSON only, in this shape:
{"fullName": "their full name", "bio": "the paragraph, in the first person"}`;
}

/** What the drafting route answers with. */
export interface Drafted {
  text: string;
  usd: number;
  /**
   * How much of the prompt Vertex served from an implicit cache, in tokens.
   *
   * Reported rather than acted on. The route sends the portrait ahead of the
   * wording so that redrafting the same face can hit a cache at all, and this
   * is the only way to see whether it did — a number that stays at zero across
   * two drafts of one portrait means the arrangement is not buying anything on
   * this model, which is worth knowing before anyone builds on it.
   */
  cached: number;
}

/**
 * Asks the Worker for a persona to fit the portrait.
 *
 * Returns the raw reply and the spend, and does no parsing: the route is a
 * proxy that knows nothing about personas, and the shape of the answer is the
 * prompt's business, which is editable. See `parseDraft`.
 */
export async function draftPersona(image: string, prompt: string): Promise<Drafted> {
  const response = await fetch('/api/persona/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, prompt }),
  });

  const body = (await response.json().catch(() => null)) as
    | (Partial<Drafted> & { error?: string })
    | null;

  if (!response.ok || typeof body?.text !== 'string') {
    throw new Error(body?.error ?? `The draft failed (${response.status})`);
  }

  return {
    text: body.text,
    usd: typeof body.usd === 'number' ? body.usd : 0,
    cached: typeof body.cached === 'number' ? body.cached : 0,
  };
}

/**
 * Reads a drafted reply into a persona, however it came back.
 *
 * Tolerant on purpose. The prompt asks for JSON and a model asked for JSON
 * mostly sends JSON — sometimes fenced, occasionally with a sentence in front
 * of it, and once in a while just the paragraph. None of those is a failure
 * worth showing someone who can see the text and edit it: the fallback puts
 * whatever came back in the box, which is a draft, which is the point.
 *
 * Trimmed to the same ceilings the editor enforces, so a long reply cannot
 * arrive in a state the text box would not have let you type.
 */
export function parseDraft(text: string, voice?: string): Persona {
  const fenced = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');

  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(fenced.slice(start, end + 1)) as Partial<Persona>;
      if (typeof parsed.bio === 'string' && parsed.bio.trim()) {
        return {
          fullName: (typeof parsed.fullName === 'string' ? parsed.fullName : '')
            .trim()
            .slice(0, MAX_NAME_CHARS),
          bio: parsed.bio.trim().slice(0, MAX_BIO_CHARS),
          voice,
        };
      }
    } catch {
      // Not JSON after all. The paragraph below is a better answer than an error.
    }
  }

  return { fullName: '', bio: fenced.trim().slice(0, MAX_BIO_CHARS), voice };
}
