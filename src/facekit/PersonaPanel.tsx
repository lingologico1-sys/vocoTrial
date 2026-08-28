import { useState } from 'react';
import { LANGUAGES, defaultLanguageCode, findLanguage } from '../realtime/languages';
import { DEFAULT_OPENAI_VOICE, OPENAI_VOICES, VOICES } from '../realtime/settings';
import type { FaceKit as Kit } from './kit';
import {
  MAX_BIO_CHARS,
  MAX_NAME_CHARS,
  PERSONA_MODEL,
  draftPersona,
  draftPrompt,
  emptyPersona,
  parseDraft,
  type Persona,
} from './persona';

/**
 * The one part of a kit that is not a picture.
 *
 * It sits on this page rather than beside the prompt picker in studio for a
 * reason worth stating: a persona belongs to a face, so it has to be authored
 * where the face is and travel with it when the face is published. The prompt
 * on the other page is the *job*; this is the person doing it, and the two are
 * deliberately kept apart — see withPersona in realtime/instructions.ts.
 *
 * Everything here goes through the page's own `edit` funnel, so a persona is a
 * change to the kit like any other: it marks the kit dirty, it is written by
 * the same Save, and closing without saving loses it the same way a box drag
 * would be lost.
 */
export default function PersonaPanel({
  kit,
  edit,
  money,
}: {
  kit: Kit;
  /** The page's single mutation funnel. See `edit` in FaceKit.tsx. */
  edit: (change: (current: Kit) => Kit) => void;
  /** The page's own money formatter, so both totals read alike. */
  money: (usd: number) => string;
}) {
  /**
   * Which language the draft is written to fit, and it is *not* stored on the
   * kit. A face is worn under whatever language studio is set to, so
   * pinning one here would be inventing a constraint the rest of the app does
   * not have. It steers one generation and then stops mattering — the
   * paragraph it produced is the thing that lasts, and it is editable.
   */
  const [language, setLanguage] = useState(defaultLanguageCode);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the last draft cost and how much of it was cached.
   *
   * Session-only, and not on the kit: the kit already carries the money in
   * `spentUsd`, and this is here to answer a question about the *arrangement*
   * rather than about the artwork — whether sending the portrait ahead of the
   * wording buys anything on a redraft. Nothing depends on it. See Drafted.
   */
  const [last, setLast] = useState<{ usd: number; cached: number } | null>(null);

  const persona = kit.persona;
  const spoken = findLanguage(language)?.label ?? 'the target language';
  // Held only once it has been edited, so that changing the language keeps
  // updating the wording underneath — until someone takes it over, after which
  // it is theirs and the picker stops rewriting it.
  const wording = prompt ?? draftPrompt(spoken);

  const change = (next: Partial<Persona>) =>
    edit((current) => ({
      ...current,
      persona: { ...emptyPersona(), ...current.persona, ...next },
    }));

  const draft = async () => {
    setDrafting(true);
    setError(null);
    try {
      const { text, usd, cached } = await draftPersona(kit.base, wording);
      const written = parseDraft(text, persona?.voice, persona?.openAiVoice);
      setLast({ usd, cached });
      // Spent whether or not the words are kept, exactly as a generated patch
      // is counted whether or not it is chosen: a total that only counted the
      // keepers would be a lie in the direction that flatters the page.
      edit((current) => ({
        ...current,
        persona: { ...written, fullName: written.fullName || current.persona?.fullName || '' },
        spentUsd: current.spentUsd + usd,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That draft failed');
    } finally {
      setDrafting(false);
    }
  };

  const used = persona?.bio.length ?? 0;

  return (
    <section className="space-y-3 rounded-xl border border-slate-800 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-medium text-slate-300">Who they are</h2>
        <p className="text-xs text-slate-500">
          Prompt text, not artwork. It travels with the face when you save, and studio can
          switch it off — which is the point of keeping it out of the prompt itself.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-xs text-slate-500">
          <span>Name</span>
          <input
            value={persona?.fullName ?? ''}
            maxLength={MAX_NAME_CHARS}
            onChange={(event) => change({ fullName: event.target.value })}
            placeholder="Nobody in particular"
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
          />
          <span className="block text-slate-600">
            What the person is called, which is not what the kit is called — renaming this kit to
            something with a version number in it should not rename them.
          </span>
        </label>

        <label className="space-y-1 text-xs text-slate-500">
          <span>Voice</span>
          <select
            value={persona?.voice ?? ''}
            onChange={(event) => change({ voice: event.target.value || undefined })}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
          >
            <option value="">No opinion</option>
            {VOICES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="block text-slate-600">
            Adopted by studio when you switch to this face, and overridable there. Worth setting
            if the background states an age or a gender: the voice is the half of the character
            this page cannot show you.
          </span>
        </label>

        {/*
          A second voice rather than a translation of the first. The two
          catalogues share no name, so there is nothing to derive from — see
          `openAiVoice` on Persona for why a timbre map was rejected. A face
          left on "no opinion" here still sounds like somebody; it just sounds
          like whoever OpenAI's default is rather than whoever this page
          decided, which is the one thing putting the voice on the face is
          meant to prevent.
        */}
        <label className="space-y-1 text-xs text-slate-500">
          <span>Voice on GPT Realtime</span>
          <select
            value={persona?.openAiVoice ?? ''}
            onChange={(event) => change({ openAiVoice: event.target.value || undefined })}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
          >
            <option value="">No opinion &mdash; {DEFAULT_OPENAI_VOICE}</option>
            {OPENAI_VOICES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="block text-slate-600">
            The same character on the other provider. The two voice sets share no names and
            nothing maps between them, so this is asked rather than guessed. A lesson published
            on a GPT model uses this one; left unset it gets {DEFAULT_OPENAI_VOICE}.
          </span>
        </label>
      </div>

      <label className="block space-y-1 text-xs text-slate-500">
        <span>Background</span>
        <textarea
          value={persona?.bio ?? ''}
          maxLength={MAX_BIO_CHARS}
          rows={6}
          onChange={(event) => change({ bio: event.target.value })}
          placeholder="First person, concrete, about a hundred words. Where they are from, what they do, who they live with, what they do at the weekend."
          className="w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-sm leading-relaxed text-slate-200 placeholder:text-slate-600"
        />
        <span className="flex justify-between">
          <span className="text-slate-600">
            Facts beat adjectives. &ldquo;Warm and patient&rdquo; gives the model nothing to say
            when it is asked a question; a hometown and two cats can become an answer, or an
            example sentence.
          </span>
          <span className="tabular-nums text-slate-600">
            {used}/{MAX_BIO_CHARS}
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-300"
        >
          {LANGUAGES.map((choice) => (
            <option key={choice.code} value={choice.code}>
              {choice.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={drafting}
          onClick={() => void draft()}
          title="Sends the portrait and asks for a person to fit it. Overwrites what is in the boxes above."
          className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-40"
        >
          {drafting ? 'Drafting…' : 'Draft from the portrait'}
        </button>

        {persona && (
          <button
            type="button"
            onClick={() => edit((current) => ({ ...current, persona: undefined }))}
            title="Leaves the face with nothing to say about itself, which is what every kit did before this existed."
            className="text-xs text-slate-500 underline-offset-4 hover:underline"
          >
            clear
          </button>
        )}

        <span className="ml-auto text-xs text-slate-500">
          {PERSONA_MODEL.label}
          {PERSONA_MODEL.unverified && <span className="text-amber-400/80"> · unverified</span>} ·
          billed from the tokens it reports, rates read {PERSONA_MODEL.ratesReadOn}
        </span>
      </div>

      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer select-none">The drafting prompt</summary>
        <textarea
          value={wording}
          rows={12}
          onChange={(event) => setPrompt(event.target.value)}
          className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-slate-300"
        />
        <p className="mt-1">
          Editable for the same reason the slot prompts and the tutor prompts are: what a wording
          produces is the thing being compared. What you type here is not kept — this prompt
          steers one draft and is then done with, and the thing that lasts is what the draft
          writes into Name, Voice and Background above. Changing the language rewrites this box
          until you edit it, after which it stops rewriting and the wording is yours.
        </p>
      </details>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      <p className="text-xs text-slate-500">
        Spent on this kit, including any drafts:{' '}
        <span className="tabular-nums">{money(kit.spentUsd)}</span>
        {last && (
          <>
            {' '}
            · last draft {money(last.usd)}, priced at the full rate
            {last.cached > 0
              ? ` even though ${last.cached} tokens of it came from cache`
              : ', nothing served from cache'}
          </>
        )}
      </p>
    </section>
  );
}
