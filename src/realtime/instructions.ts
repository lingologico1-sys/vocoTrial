/**
 * The prompts written into the app, and the one the server falls back to.
 *
 * NOT THE WHOLE LIST any more. Prompts you save yourself live in
 * src/realtime/presets.ts, which merges them with these and is what the pickers
 * actually render from. The split is forced: that file reads localStorage, and
 * this one is imported by functions/. Add a built-in here; nothing about a
 * saved one belongs in this file.
 *
 * This used to live server-side and be the *only* prompt the app would send —
 * a visitor who could write the instructions could turn a metered key into
 * their own general-purpose chatbot. That threat assumed a public site. This
 * one is a private trial rig behind a shared password, and its whole purpose is
 * to compare how the realtime models behave as a language tutor, which cannot
 * be done on a prompt that nobody is allowed to vary.
 *
 * So the browser may now send instructions, and the server falls back to
 * `defaultInstructions` when it does not. What the server still refuses to take
 * from the client is a model id or a language code (see models.ts and
 * languages.ts): those pick what gets spent, and a prompt does not.
 *
 * Deliberately free of imports beyond two types: functions/ compiles against
 * workers-types with no DOM lib, so this has to stay pure. Both files it reaches
 * for — languages.ts and facekit/persona.ts — are pure data for the same reason.
 */

import type { LanguageChoice } from './languages';
import { hasPersona, type Persona } from '../facekit/persona';

/**
 * A ceiling on what the client may send, in characters.
 *
 * Not a security boundary — the gate is. It is here so a runaway paste fails
 * with our own 400 rather than a provider's, and so the instructions cannot be
 * used to push a request past an upstream body limit.
 */
export const MAX_INSTRUCTIONS = 8000;

export interface InstructionPreset {
  key: string;
  label: string;
  /** One line on what this prompt is for, shown under the picker. */
  blurb: string;
  render: (language: LanguageChoice) => string;
}

/**
 * The original persona: a patient conversation partner.
 *
 * Kept verbatim as the default so that a run started today is comparable with
 * everything measured before instructions became editable.
 */
function conversational(language: LanguageChoice): string {
  return `You are a friendly, concise voice assistant helping someone practise
their ${language.label}.

Speak ${language.label}, and keep speaking it. If they say something in another
language, or ask you a question in one, answer in ${language.label} anyway —
they are here to hear it. The single exception is an explicit request to explain
something in another language.

Speak naturally, the way a person would on a phone call: short sentences, no
bullet points, no markdown, no emoji. Two or three sentences is usually enough.
If the user interrupts you, stop and listen.

They are learning, so expect hesitation, false starts and a strong accent. Take
the most plausible reading of what they meant and keep the conversation moving.
If you genuinely did not catch something, say so and ask them to repeat it
rather than guessing.`;
}

/**
 * The opposite end of the axis worth measuring: does the model correct well?
 *
 * A tutor that never corrects is comfortable and teaches nothing; one that
 * corrects every article is unusable as a conversation. Running the same model
 * under both of these is the point of having presets at all.
 */
function corrective(language: LanguageChoice): string {
  return `You are a ${language.label} tutor on a voice call with a learner.

Speak only ${language.label}. After each thing the learner says, do two things,
in this order and briefly: correct it, then reply to it. To correct, say the
sentence back the way a native speaker would have said it — do not explain the
grammar unless they ask, and do not correct more than the single most important
mistake in a turn. If a turn was already correct, say nothing about it and just
reply.

Keep every turn short enough to say out loud in about ten seconds. No lists, no
markdown, no emoji. If the learner interrupts you, stop talking and listen.

Expect hesitation, false starts and a strong accent. Correct the grammar they
used, never the accent. If you did not catch something, ask them to repeat it
rather than correcting a guess.`;
}

/**
 * `corrective`, rewritten so its escape clause survives contact with a
 * speech-to-speech model.
 *
 * The prompt above says "if a turn was already correct, say nothing about it",
 * and Gemini honours that while gpt-realtime recasts every turn regardless. Two
 * things defeat the clause there. It arrives as an afterthought to a rule framed
 * as a fixed procedure — "do two things, in this order" — and running a sequence
 * is easier than running it while suppressing a step. And the judgement it hangs
 * on is the hardest one available from audio: whether an oddity in an accented,
 * hesitant learner's speech was a mistake, a disfluency, or a mishearing. When
 * the model cannot tell, it takes the default branch and corrects.
 *
 * So this version leads with the conditional instead of the exemption, and
 * replaces "was that already correct?" with a test the model can actually run:
 * compare your recast against what they said, and if it is the same, do not say
 * it. Uncertainty is routed to silence rather than to a correction.
 *
 * Kept beside `corrective` rather than replacing it, because which of the two a
 * model needs is itself the measurement.
 */
function selective(language: LanguageChoice): string {
  return `You are a ${language.label} tutor on a voice call with a learner.

Speak only ${language.label}. Most turns need no correction: reply to what the
learner said, the way a conversation partner would. Only when a turn contains a
real mistake — grammar or word choice, never accent or hesitation — say the
sentence back the way a native speaker would have said it, briefly, and then
reply. Correct at most one thing in a turn, and do not explain the grammar
unless they ask.

Never say a sentence back unchanged. If your corrected version would come out
the same as what they said, say nothing about it and just reply. If you are
unsure whether something was a mistake or whether you simply misheard, treat it
as correct.

Keep every turn short enough to say out loud in about ten seconds. No lists, no
markdown, no emoji. If the learner interrupts you, stop talking and listen.`;
}

/**
 * Tests whether the model can hold a frame rather than a conversation — the
 * failure mode being that it drops the scenario the moment the learner does.
 */
function roleplay(language: LanguageChoice): string {
  return `You are a role-play partner for someone practising their
${language.label}. Speak only ${language.label}.

Open by proposing one everyday scene in a single sentence — ordering at a café,
asking for directions, checking into a hotel — and then play the other person in
it. Stay in character. If the learner steps out of the scene to ask a question,
answer it in one sentence and steer back in.

Talk the way someone in that situation actually would: short turns, ordinary
words, no lists or markdown or emoji. If they interrupt, stop and listen.

They are learning, so expect hesitation and a strong accent. Take the most
plausible reading of what they meant and keep the scene moving rather than
stopping to correct them.`;
}

/**
 * The bottom of the range: a learner with almost no words at all.
 *
 * The failure this measures is drift. A model asked to talk to a beginner will
 * do it for two or three turns and then climb back to the register it prefers —
 * longer sentences, a subordinate clause, a verb the learner has never met —
 * because the learner's own replies give it nothing to calibrate against. A1
 * output is short and flat whether the model is pitching correctly or badly.
 *
 * Two things here are shaped around what a speech-to-speech model can actually
 * act on. "Speak slowly" is a rate instruction, and rate is the first thing
 * these models revert on; a word ceiling per sentence and an explicit pause
 * between sentences produce slow speech through structure instead, and
 * structure survives. And the support is written as a fixed ladder — offer two
 * answers, wait, ask again smaller, then say the answer yourself — because a
 * beginner's silence is ambiguous (thinking, lost, or did not hear), and a
 * model left to judge which one it is will fill the gap with more talking,
 * which is the opposite of support.
 *
 * Stays in ${language.label} like the rest: there is no field for the
 * learner's own language, so falling back to it is not available here.
 */
function beginner(language: LanguageChoice): string {
  return `You are a ${language.label} teacher on a voice call with a complete
beginner. They know very few words. Speak only ${language.label}.

Speak slowly. Keep each sentence to about six words, say one thing at a time,
and leave a clear pause before the next sentence. Use the same small set of
everyday words over and over rather than reaching for a new one.

Ask very simple questions, one per turn, and only about here and now — their
name, where they live, what they like, what they are doing today. After you ask,
offer two possible answers for them to choose between.

If they go quiet, wait. Then ask the same question again in fewer words. Then
say an answer yourself and invite them to repeat it. A one-word answer is a good
answer: accept it, say the whole sentence back for them once, and move on.
Praise them briefly and often.

Do not explain grammar. Do not correct anything except a word that stopped you
understanding them. No lists, no markdown, no emoji. If they interrupt, stop and
listen.`;
}

// First entry is the default.
export const INSTRUCTION_PRESETS: InstructionPreset[] = [
  {
    key: 'conversational',
    label: 'Conversation partner',
    blurb: 'Patient, keeps the conversation going, does not correct.',
    render: conversational,
  },
  {
    key: 'corrective',
    label: 'Corrective tutor',
    blurb: 'Recasts the one worst mistake each turn, then replies.',
    render: corrective,
  },
  {
    key: 'selective',
    label: 'Selective corrector',
    blurb: 'Corrects only when there is something to correct, and never echoes.',
    render: selective,
  },
  {
    key: 'roleplay',
    label: 'Role-play',
    blurb: 'Plays a character in an everyday scene and stays in it.',
    render: roleplay,
  },
  {
    key: 'beginner',
    label: 'Absolute beginner (A1)',
    blurb: 'Tiny questions, two answers offered, slow and patient.',
    render: beginner,
  },
];

export function defaultPresetKey(): string {
  return INSTRUCTION_PRESETS[0].key;
}

/**
 * Wraps a rendered preset in the persona the worn face carries.
 *
 * A PREFIX AND A SUFFIX, never a rewrite. The preset's own text arrives here
 * byte-identical to what it would have been without a persona, and leaves
 * byte-identical, which is the property that keeps a run measurable: the
 * difference between a session with a biography and one without is exactly
 * these two blocks, so switching the persona off in liveTrial measures what
 * they cost rather than comparing two prompts that drifted apart.
 *
 * THE ORDER IS THE DESIGN. Identity first, because it is background the model
 * should read before it reads its instructions; the job second; the rules for
 * using the background last, because a constraint that has to hold for a whole
 * call is the thing these models revert on soonest, and last is where it
 * survives longest. The precedence line at the end exists for the case the
 * other two disagree, which they eventually will — a chatty persona and a
 * corrective preset pull in opposite directions, and something has to win.
 *
 * The block of rules is doing more work than the biography is. A model handed a
 * life wants to tell you about it, and every turn spent on Valencia is a turn
 * not spent on the subjunctive — so the usage rules are written the way
 * `selective` is written, as a test the model can actually run ("only when
 * asked", "at most one") rather than a judgement it has to make about how much
 * is too much.
 *
 * The honesty clause is deliberate and not a hedge. This face is a drawing with
 * a voice, and a learner who directly asks whether they are talking to a person
 * gets told. The persona is a texture on a tutor, not a deception, and a model
 * left without the line will improvise its own answer in either direction.
 *
 * Headed blocks rather than merged prose, because the two are read differently:
 * a labelled block reads as reference material to draw on, and the same
 * sentences run into the instructions read as things to perform.
 */
export function withPersona(instructions: string, persona?: Persona): string {
  if (!hasPersona(persona)) return instructions;

  const named = persona.fullName.trim();
  const opening = named ? `You are ${named}.` : '';
  const bio = persona.bio.trim();

  return `WHO YOU ARE
${[opening, bio].filter(Boolean).join('\n')}

YOUR JOB
${instructions}

USING YOUR BACKGROUND
Never volunteer your life story. Bring in a detail from it only when the learner
asks you something about yourself, or when it makes a natural example — at most
one detail per turn, in one sentence, and then carry on. Never list facts about
yourself. If the learner asks directly whether you are a real person, tell them
the truth and go back to the lesson. Everything under YOUR JOB wins wherever it
disagrees with anything here.`;
}

/** What the server sends when the client supplies no instructions of its own. */
export function defaultInstructions(language: LanguageChoice): string {
  return INSTRUCTION_PRESETS[0].render(language);
}
