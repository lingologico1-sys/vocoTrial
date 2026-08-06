/**
 * The prompts the agent can be run with.
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
 * Deliberately free of imports beyond the language type: functions/ compiles
 * against workers-types with no DOM lib, so this has to stay pure.
 */

import type { LanguageChoice } from './languages';

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
    key: 'roleplay',
    label: 'Role-play',
    blurb: 'Plays a character in an everyday scene and stays in it.',
    render: roleplay,
  },
];

export function findPreset(key: string): InstructionPreset | undefined {
  return INSTRUCTION_PRESETS.find((preset) => preset.key === key);
}

export function defaultPresetKey(): string {
  return INSTRUCTION_PRESETS[0].key;
}

/** What the server sends when the client supplies no instructions of its own. */
export function defaultInstructions(language: LanguageChoice): string {
  return INSTRUCTION_PRESETS[0].render(language);
}
