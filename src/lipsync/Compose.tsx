import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import {
  fetchQuota,
  fetchVoiceInfo,
  generate,
  LAUGH_LIBRARY_CHANGED,
  listClips,
  LipsyncError,
  type Generated,
} from './library';
import {
  eligible,
  type ReactionLibraryIndex,
  type VoiceGender,
} from './laughs';
import {
  costOf,
  estimateUsd,
  formatQuota,
  linesLeft,
  remaining,
  spentFraction,
  type Quota,
} from './cost';
import {
  ACCENT_PARAMS,
  type VoiceProfile,
  type ReactionOptions,
  type LipsyncModel,
  type LipsyncPackage,
  type VoiceParams,
} from './published';
import {
  REACTION_CLIP_KINDS,
  SMILE_LEAD_MIN_MS,
  TAGS,
  applyAccent,
  clipKindOf,
  reactionsIn,
  stripTags,
  type Tag,
} from './tags';
import { addRoom, roomWarnings, scriptWarnings } from './warnings';
import { loadPrefs, loadVoiceGender, savePrefs, saveVoiceGender } from './prefs';

/**
 * Writing a line and hearing it, without leaving the page.
 *
 * The panel exists because the alternative was four files carried between two tools by
 * hand, and the pairing went wrong twice in one afternoon. Generating here means the
 * audio, the timings, the transcript and the marks are made by one request from one
 * piece of text, so they cannot describe different utterances. See generate.ts.
 *
 * WHICH TAGS ARE OFFERED DEPENDS ON THE MODEL, in two tiers rather than one. Directives
 * and pauses are v3's to perform, so on v2 they are disabled rather than absent — it is
 * clearer that the feature exists and which model it belongs to than that it was never
 * built. The eight clip-capable reactions are enabled on both, and that is not an
 * exception so much as the point of the library: generate.ts lifts the tag out and splices
 * a recording afterwards, so those work on v2 *because* the model never sees them.
 *
 * Each of those eight also says on the button what it will actually do here — spliced from
 * the library, performed by the model, or dropped for want of a clip. The answer depends
 * on the voice and on what has been recorded for it, so it is not something an author can
 * work out from the tag.
 */

/**
 * What will become of a reaction tag in this line, as a mark on its button.
 *
 * A glyph rather than a word because it sits inside a monospace tag button next to seven
 * others, and "Spliced from library" on each would be a paragraph pretending to be a
 * palette. The legend under the palette spells all three out, and the title attribute says
 * it in full on the one being pointed at.
 */
/**
 * Whether a tag does anything on the chosen model.
 *
 * At module scope rather than inside the component because a closure redefined every
 * render cannot go in a dependency array honestly: it changes identity constantly while
 * meaning the same thing, so listing it re-runs the memo on every keystroke and omitting
 * it is a lie about what the memo reads. A plain function of its two inputs has neither
 * problem.
 */
const worksOn = (tag: Tag, tagsAllowed: boolean) =>
  tagsAllowed || clipKindOf(tag.tag) !== null;

type Fate = 'spliced' | 'timed' | 'gone';

const FATE_MARK: Record<Fate, string> = { spliced: '●', timed: '○', gone: '×' };

const FATE_STYLE: Record<Fate, string> = {
  spliced: 'text-emerald-400',
  timed: 'text-amber-400',
  gone: 'text-rose-400',
};

const FATE_HINT: Record<Fate | 'unused', string> = {
  spliced: 'Spliced from your library.',
  timed: 'No recording for this voice, so the model is asked to perform it.',
  gone: 'No recording for this voice and v2 cannot perform it, so it will be dropped.',
  unused: 'Can be spliced from a recording you provide.',
};

interface ComposeProps {
  onGenerated: (result: Generated) => void;
  onVoiceChange: (voice: ComposeVoice) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
}

export interface ComposeVoice {
  voiceId: string;
  voiceName?: string;
  voiceGender?: VoiceGender;
}

const LANGUAGES: Array<{ id: LipsyncPackage['language']; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
];

const MODELS: Array<{ id: LipsyncModel; label: string; hint: string }> = [
  {
    id: 'eleven_v3',
    label: 'v3 — expressive',
    hint: 'Audio tags work. A research preview, so its output can shift under you.',
  },
  {
    id: 'eleven_multilingual_v2',
    label: 'multilingual v2 — stable',
    hint: 'Tags are stripped, not performed. Often keeps an accent v3 would flatten.',
  },
];

const GROUPS: Array<Tag['group']> = ['Emotions', 'Delivery', 'Reactions', 'Pacing'];

/** How a tag is dressed, which is a warning as much as a colour. */
const KIND_STYLE: Record<Tag['kind'], string> = {
  directive: 'border-slate-700 text-slate-300 hover:border-slate-500',
  pause: 'border-sky-900 text-sky-300 hover:border-sky-700',
  reaction: 'border-amber-900 text-amber-300 hover:border-amber-700',
};

export default function Compose({ onGenerated, onVoiceChange, busy, setBusy }: ComposeProps) {
  /**
   * Seeded from the last visit, read once rather than in a mount effect.
   *
   * An effect would render the empty form first and then replace it, which flashes
   * a blank voice ID at exactly the moment someone is looking to see whether they
   * still need to fetch one. Reading in the initialiser means the first paint is
   * already correct. `useState(loadPrefs)` — the function form, so the read happens
   * on mount and not on every render.
   *
   * Reset is a remount, not a setter: LipSync clears the store and changes this
   * component's key, so these initialisers run again over cleared storage. That
   * keeps the defaults in one place instead of duplicated into a reset handler.
   */
  const remembered = useState(loadPrefs)[0];
  const [text, setText] = useState(remembered.text);
  const [language, setLanguage] = useState<LipsyncPackage['language']>(remembered.language);
  const [voiceId, setVoiceId] = useState(remembered.voiceId);
  const [voiceName, setVoiceName] = useState(remembered.voiceName ?? '');
  const [voiceGender, setVoiceGender] = useState<VoiceGender | undefined>(
    loadVoiceGender(remembered.voiceId) ?? remembered.voiceGender,
  );
  const [lookingUpVoice, setLookingUpVoice] = useState(false);
  const [model, setModel] = useState<LipsyncModel>(remembered.model);
  const [accent, setAccent] = useState(remembered.accent);
  /**
   * What ElevenLabs says the voice is, filled by the lookup that already runs for gender.
   *
   * The one fact the sliders cannot supply, and the reason it is beside the accent field
   * rather than in the report only: a voice labelled `american` and categorised `premade`
   * will not speak French-African however it is driven, and the cheapest moment to learn
   * that is before the first take rather than after twelve.
   */
  const [profile, setProfile] = useState<VoiceProfile | undefined>();
  const [params, setParams] = useState<VoiceParams>(remembered.params);
  const [reactions_, setReactions] = useState<ReactionOptions>(remembered.reactions);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);

  // The laugh library configures the NEXT generation, so it needs the voice currently
  // selected here rather than the voice stamped onto the previous generated package.
  useEffect(() => {
    onVoiceChange({
      voiceId: voiceId.trim(),
      voiceName: voiceName.trim() || undefined,
      voiceGender,
    });
  }, [onVoiceChange, voiceId, voiceName, voiceGender]);

  // Written on every keystroke. It is one small JSON blob to the same key, and the
  // alternative — saving on blur, or on generate — loses the line to the refresh
  // that happens mid-edit, which is the only case this is for.
  useEffect(() => {
    savePrefs({
      text,
      language,
      voiceId,
      voiceName,
      voiceGender,
      model,
      accent,
      params,
      reactions: reactions_,
    });
  }, [text, language, voiceId, voiceName, voiceGender, model, accent, params, reactions_]);

  // Voice labels are optional in ElevenLabs, so lookup can fill this control but never
  // replace it. A missing label leaves the two-button choice waiting for the author.
  useEffect(() => {
    const id = voiceId.trim();
    if (!id) {
      setLookingUpVoice(false);
      return;
    }
    let current = true;
    // Cleared as the ID changes rather than left standing, so a stale label never sits
    // under a voice it does not describe — which on this panel would be the one kind of
    // wrong worth avoiding, since the whole point of the line is to be believed.
    setProfile(undefined);
    const timer = window.setTimeout(() => {
      setLookingUpVoice(true);
      void fetchVoiceInfo(id)
        .then((voice) => {
          if (!current) return;
          setProfile(voice.profile);
          if (voice.name) setVoiceName(voice.name);
          if (voice.gender) {
            setVoiceGender(voice.gender);
            saveVoiceGender(id, voice.gender);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          if (current) setLookingUpVoice(false);
        });
    }, 500);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [voiceId]);

  // Read once on mount and again after each generation, since generating is the only
  // thing on this page that spends any of it.
  useEffect(() => {
    void fetchQuota().then(setQuota);
  }, []);

  /**
   * Whether the model reads tags at all, which is not the same as whether a tag works.
   *
   * v2 ignores audio tags, and generate.ts strips every one of them out of what it sends,
   * so a directive there is inert. A clip-capable reaction is the exception and the whole
   * point of the library: the tag is lifted and a recording is spliced in afterwards, so
   * it works on v2 precisely because the model never sees it. Hence two gates below rather
   * than this one doing double duty — it used to disable the entire palette on v2, which
   * left the eight kinds that do work with no way to insert them.
   */
  const tagsAllowed = model === 'eleven_v3';
  /** Whether this particular tag does something on the model currently chosen. */
  const worksHere = (tag: Tag) => worksOn(tag, tagsAllowed);
  /**
   * The accent actually in force, which on v2 is none whatever the field says.
   *
   * The field is left enabled and filled on v2 rather than cleared, for the same reason
   * the tag palette is disabled rather than hidden there: switching models to hear the
   * difference and finding the accent silently wiped is worse than being told it does
   * not apply. The same rule runs server-side in generate.ts; this copy exists so the
   * cost panel can be right before a take is spent finding out.
   */
  const accentUsed = tagsAllowed ? accent.trim() : '';
  /**
   * Billed on what will be SENT, not on what was typed.
   *
   * The accent tag is repeated on every line and every one of those characters is
   * charged, so a panel counting the raw script would understate a long accented line by
   * a few hundred characters — which is exactly the surprise cost.ts exists to prevent.
   * Slightly conservative on purpose: covered laughs are lifted out server-side, so the
   * real send is a little shorter than this. Over rather than under is the right way for
   * an estimate against a quota to be wrong.
   */
  const billed = useMemo(() => applyAccent(text, accentUsed), [text, accentUsed]);
  const cost = useMemo(() => costOf(billed), [billed]);
  const script = useMemo(() => stripTags(text), [text]);
  /**
   * The reactions in this line that the chosen model will do something about.
   *
   * On v3 that is all of them. On v2 it is the clip-capable ones only — this used to be
   * flatly empty there, which was right when no tag did anything on that model and became
   * a silent hole the moment eight of them did: the coverage panel had nothing to report
   * about a v2 take even though it was about to splice four clips into one.
   */
  const reactions = useMemo(
    () => reactionsIn(text).filter((t) => worksOn(t, tagsAllowed)),
    [text, tagsAllowed],
  );
  const warnings = useMemo(() => scriptWarnings(script), [script]);
  /**
   * Which of this line's tags the library will take over, and which the model still gets.
   *
   * The same rule generate.ts applies, evaluated here so the panel can say what will
   * happen before a take is spent finding out. Duplicated logic is worth flagging: what
   * keeps the two in step is that both ask `eligible` from laughs.ts rather than each
   * deciding for itself what "covered" means.
   */
  const [library, setLibrary] = useState<ReactionLibraryIndex>({ sources: [], renders: [] });
  useEffect(() => {
    const refresh = () => void listClips().then(setLibrary).catch(() => undefined);
    refresh();
    window.addEventListener(LAUGH_LIBRARY_CHANGED, refresh);
    return () => window.removeEventListener(LAUGH_LIBRARY_CHANGED, refresh);
  }, []);

  /**
   * The kinds this voice has a clip for, which is what generate.ts will decide too.
   *
   * Lifted out of the coverage memo below because the punctuation warning needs the same
   * answer, and two places deriving it independently is how they drift. Both ask
   * `eligible` from laughs.ts rather than each deciding what "covered" means.
   */
  const covered = useMemo(
    () =>
      voiceId.trim()
        ? REACTION_CLIP_KINDS.filter(
            (k) => eligible(library, k, voiceId.trim(), voiceGender).length > 0,
          )
        : [],
    [library, voiceId, voiceGender],
  );

  /**
   * Reactions with a word butted against them, which will splice as an interruption.
   *
   * Only the ones actually being spliced, which is why this reads `covered` rather than
   * warning about every reaction in the line: a tag the model performs itself phrases its
   * own room, and telling somebody to punctuate around it would be advice about a problem
   * they do not have.
   */
  const crowded = useMemo(() => roomWarnings(text, covered), [text, covered]);

  const { fromLibrary, fromTimings, dropped, byTag } = useMemo(() => {
    const coveredSet = new Set(covered);
    // Read off the raw text rather than off `reactions`, so that a tag the current model
    // ignores is still classified rather than quietly missing from the panel.
    const clips = reactionsIn(text).filter((t) => clipKindOf(t.tag));
    const spliced: string[] = [];
    const timed: string[] = [];
    const gone: string[] = [];
    const byTag = new Map<string, Fate>();

    for (const tag of clips) {
      const kind = clipKindOf(tag.tag);
      if (kind && coveredSet.has(kind)) {
        spliced.push(tag.tag);
        byTag.set(tag.tag, 'spliced');
      } else if (tagsAllowed) {
        // v3 with no clip: the model is asked for it and may oblige. Unreliable, and
        // strictly better than nothing, which is what this did before the library.
        timed.push(tag.tag);
        byTag.set(tag.tag, 'timed');
      } else {
        // v2, no clip: lifted out and nothing put back. Silence, which is the point —
        // left in, the model is liable to read the tag aloud as a word.
        gone.push(tag.tag);
        byTag.set(tag.tag, 'gone');
      }
    }
    // Everything else keeps the old rule, and on v2 there is nothing else to report.
    for (const tag of reactions) {
      if (!clipKindOf(tag.tag)) {
        timed.push(tag.tag);
        byTag.set(tag.tag, 'timed');
      }
    }
    return { fromLibrary: spliced, fromTimings: timed, dropped: gone, byTag };
  }, [reactions, covered, text, tagsAllowed]);

  /** Inserts at the cursor rather than appending — a tag placed mid-line is the point. */
  function insert(tag: string) {
    const el = box.current;
    if (!el) {
      setText((t) => `${t}${tag} `);
      return;
    }
    const at = el.selectionStart ?? text.length;
    const next = `${text.slice(0, at)}${tag} ${text.slice(el.selectionEnd ?? at)}`;
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = at + tag.length + 1;
      el.setSelectionRange(cursor, cursor);
    });
  }

  async function run() {
    setProblem(null);
    if (!script.trim()) {
      setProblem('There are no words in that — only tags.');
      return;
    }
    if (!voiceId.trim()) {
      setProblem('Paste an ElevenLabs voice ID.');
      return;
    }
    if (!voiceGender) {
      setProblem('Choose whether this voice is male or female.');
      return;
    }
    setBusy(true);
    try {
      const result = await generate({
        text,
        language,
        voiceId: voiceId.trim(),
        voiceName: voiceName || undefined,
        voiceGender,
        model,
        // Sent as typed. The server writes the tag and places it, so that this panel and
        // generate.ts cannot disagree about the wording — see applyAccent in tags.ts.
        accent: accentUsed || undefined,
        params,
        reactions: reactions_,
      });
      onGenerated(result);
      // The count just changed, so the panel should stop showing the old one.
      void fetchQuota().then(setQuota);
    } catch (error) {
      const message =
        error instanceof LipsyncError
          ? [error.message, error.detail].filter(Boolean).join(' — ')
          : 'Could not generate that.';
      setProblem(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-800 p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-slate-200">Compose</h2>
        <span className="text-xs text-slate-600">
          audio, timings, transcript and marks, made together
        </span>
      </div>

      <textarea
        ref={box}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={5}
        placeholder="Bonjour. Aujourd'hui, nous allons travailler les sons qui posent le plus de difficulté."
        className="w-full resize-y rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-sm text-slate-200 placeholder:text-slate-700"
      />

      {/* What this line costs, in the unit ElevenLabs bills in.
          Beneath the box rather than beside the button, because the number that
          changes a decision is the one visible while the decision is being made. */}
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-slate-600">
        <span>
          <span className="font-mono text-slate-300">{cost.total.toLocaleString()}</span>{' '}
          characters
          {cost.tagChars > 0 && (
            <>
              {' — '}
              <span className="font-mono text-amber-400/80">{cost.tagChars}</span> of them
              tags, billed but never spoken
            </>
          )}
        </span>
        <span>≈ ${estimateUsd(cost.total).toFixed(3)}</span>
        {quota && (
          <>
            <span className="h-3 w-px bg-slate-800" />
            <span>
              <span className="font-mono text-slate-300">
                {remaining(quota).toLocaleString()}
              </span>{' '}
              credits left
            </span>
            {cost.total > 0 && (
              <span>
                room for{' '}
                <span className="font-mono text-slate-400">
                  {linesLeft(quota, cost.total)?.toLocaleString()}
                </span>{' '}
                more like it
              </span>
            )}
          </>
        )}
      </div>

      {/* The allowance at a glance. A bar rather than only a number because the useful
          question while writing is "am I near the end of the month", which is a
          proportion, and a proportion is faster to see than to read. */}
      {quota && (
        <div className="flex flex-col gap-1">
          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-900">
            <div
              className={`h-full rounded-full transition-all ${
                spentFraction(quota) > 0.9 ? 'bg-rose-500/70' : 'bg-slate-600'
              }`}
              style={{ width: `${Math.max(1, spentFraction(quota) * 100)}%` }}
            />
          </div>
          <div className="flex flex-wrap justify-between gap-x-4 text-[11px] text-slate-600">
            <span>
              {quota.tier} · {formatQuota(quota)} characters
            </span>
            {quota.resetsAt && (
              <span>
                resets{' '}
                {new Date(quota.resetsAt * 1000).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-400">Voice ID</span>
          <input
            value={voiceId}
            onChange={(event) => {
              const next = event.target.value;
              setVoiceId(next);
              setVoiceName('');
              setVoiceGender(loadVoiceGender(next));
            }}
            placeholder="from the ElevenLabs voice page"
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-700"
          />
          <span className="text-[11px] leading-snug text-slate-600">
            {lookingUpVoice
              ? 'Checking voice metadata…'
              : voiceName
                ? voiceName
                : 'Name and gender are read when available.'}
          </span>
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-xs font-medium text-slate-400">Voice gender</legend>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
            {(['female', 'male'] as const).map((gender) => (
              <label
                key={gender}
                className={`cursor-pointer rounded-md px-2 py-1.5 text-center text-xs capitalize transition-colors ${
                  voiceGender === gender
                    ? 'bg-slate-700 text-slate-100'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                <input
                  type="radio"
                  name="voice-gender"
                  value={gender}
                  checked={voiceGender === gender}
                  onChange={() => {
                    setVoiceGender(gender);
                    saveVoiceGender(voiceId, gender);
                  }}
                  className="sr-only"
                />
                {gender}
              </label>
            ))}
          </div>
          <span className="text-[11px] leading-snug text-slate-600">
            Sets which original laugh pool this voice can use.
          </span>
        </fieldset>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-400">Language</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as LipsyncPackage['language'])}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200"
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </select>
          {/* Not a hint about the voice: it picks the acoustic model the aligner uses,
              and a clip aligned against the wrong language returns confident nonsense. */}
          <span className="text-[11px] leading-snug text-slate-600">
            Which aligner model reads it back. Not guessed from the text.
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-400">Model</span>
          <select
            value={model}
            onChange={(event) => setModel(event.target.value as LipsyncModel)}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200"
          >
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <span className="text-[11px] leading-snug text-slate-600">
            {MODELS.find((m) => m.id === model)?.hint}
          </span>
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-xs font-medium text-slate-400">Audio tags</span>
          {!tagsAllowed && (
            <span className="text-[11px] text-slate-600">
              v2 reads no tags — the {REACTION_CLIP_KINDS.length} with recordings still work,
              because they are spliced in rather than performed
            </span>
          )}
        </div>
        {GROUPS.map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-slate-600">
              {group}
            </span>
            {TAGS.filter((t) => t.group === group).map((t) => (
              <button
                key={t.tag}
                type="button"
                disabled={!worksHere(t)}
                onClick={() => insert(t.tag)}
                title={
                  t.clip
                    ? `${FATE_HINT[byTag.get(t.tag) ?? 'unused']} Recorded clips are spliced into the finished audio, so this works on either model.`
                    : t.kind === 'reaction'
                      ? 'Makes sound the transcript has no words for. Its span is marked from the timings rather than aligned.'
                      : t.kind === 'pause'
                        ? 'Inserts silence, which the aligner reads correctly on its own.'
                        : 'Changes how the words are said. No effect on alignment.'
                }
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-700 ${KIND_STYLE[t.kind]}`}
              >
                {t.tag}
                {/* Only once the tag is in the line, because before that its fate is a
                    hypothetical and eight permanent badges would be noise. */}
                {byTag.get(t.tag) && (
                  <span className={`ml-1 ${FATE_STYLE[byTag.get(t.tag)!]}`}>
                    {FATE_MARK[byTag.get(t.tag)!]}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
        <p className="text-[11px] leading-snug text-slate-600">
          Amber tags make sound the words do not cover — a laugh, a sigh. The aligner
          would smear the surrounding words across them, so their span is taken from
          ElevenLabs&rsquo; own timings instead. Blue tags are silence, which the aligner
          already handles. Grey tags cost nothing.
        </p>
        <p className="text-[11px] leading-snug text-slate-600">
          Once a reaction is in the line it is marked with what will happen to it:{' '}
          <span className={FATE_STYLE.spliced}>{FATE_MARK.spliced}</span> spliced from your
          library, <span className={FATE_STYLE.timed}>{FATE_MARK.timed}</span> left for the
          model to perform, <span className={FATE_STYLE.gone}>{FATE_MARK.gone}</span> no
          recording for this voice, so it will be dropped.
        </p>
      </div>

      <details className="rounded-lg border border-slate-800 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-400">
          Voice parameters
        </summary>
        {/*
          * The accent, above the sliders because it is the thing that decides what they
          * should be. It is not a slider itself: the sliders are how freely the voice
          * reads and this is what it should read as, and putting a text field in the grid
          * with them would suggest they are the same kind of setting.
          */}
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-slate-800 px-3 py-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-slate-400">Accent</span>
            <input
              type="text"
              value={accent}
              maxLength={40}
              onChange={(event) => setAccent(event.target.value)}
              placeholder="French-African"
              className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-700"
            />
          </label>
          {/*
            * What the voice is, above what we are asking it to be. Only rendered when
            * ElevenLabs actually said something: labels are free-form there, so a voice
            * with no accent label is one nobody labelled, and printing "accent: none"
            * would be this panel asserting a thing it does not know.
            */}
          {(profile?.accent || profile?.category) && (
            <p className="text-[11px] leading-snug text-slate-500">
              This voice is labelled{' '}
              {profile.accent ? (
                <span className="text-slate-300">{profile.accent}</span>
              ) : (
                'with no accent'
              )}
              {profile.category && (
                <>
                  , category <span className="text-slate-300">{profile.category}</span>
                </>
              )}
              .{' '}
              {profile.category === 'premade' || profile.category === 'generated'
                ? 'It has no source audio behind it, so a weak accent cannot be re-cut — only a different voice fixes that.'
                : profile.category === 'cloned' || profile.category === 'professional'
                  ? 'It was cloned, so if the accent is weak the source audio is the place to fix it.'
                  : null}
            </p>
          )}
          <p className="text-[11px] leading-snug text-slate-600">
            {accentUsed ? (
              <>
                Sent as <code className="text-slate-400">[strong {accentUsed} accent]</code>{' '}
                at the head of every line — restated each time because v3 drifts back to
                its own baseline over a paragraph. The aligner never sees it, so the mouth
                is unaffected; the characters are billed, and the count below includes them.
              </>
            ) : model === 'eleven_v3' ? (
              <>
                Left empty, the voice reads in whatever accent it was built with. v3 is
                tuned for clarity and sands regional accents toward a standard baseline,
                which is what this is for. It cannot add an accent the voice does not have.
              </>
            ) : (
              <>
                Not applied on multilingual v2, which cannot act on tags &mdash; every
                tag is stripped there rather than spoken aloud. v2 tends to keep an
                accent the voice already has, so it often needs less help than v3 does.
                Kept as typed, and back in force on v3.
              </>
            )}
          </p>
        </div>

        {/*
          * A button, not a mode. It moves the sliders and then gets out of the way, so
          * the sliders stay the only account of what will be sent — a toggle that forced
          * them would leave two things on this panel claiming to say what the stability
          * is, and the visible one would be the one that was wrong.
          */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button
            type="button"
            onClick={() => setParams(ACCENT_PARAMS)}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500"
          >
            Optimize for accents
          </button>
          <span className="text-[11px] text-slate-600">
            Sets stability 0, similarity 0.90, style 0.30. Tune from there.
          </span>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([
            ['stability', 'Stability', 'v3 rounds this to 0 (creative), 0.5 or 1 (robust)'],
            ['similarityBoost', 'Similarity', 'How close to the original voice'],
            ['style', 'Style exaggeration', 'Amplifies the voice&rsquo;s own manner'],
          ] as const).map(([key, label, hint]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-xs text-slate-400">
                {label} — {params[key].toFixed(2)}
              </span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={params[key]}
                onChange={(event) =>
                  setParams((p) => ({ ...p, [key]: Number(event.target.value) }))
                }
              />
              <span className="text-[11px] text-slate-600">{hint}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 self-end">
            <input
              type="checkbox"
              checked={params.speakerBoost}
              onChange={(event) =>
                setParams((p) => ({ ...p, speakerBoost: event.target.checked }))
              }
            />
            <span className="text-xs text-slate-400">Speaker boost</span>
          </label>
        </div>
        {/* Worth saying, because everything else on this page affects the mouth. */}
        <p className="mt-3 text-[11px] leading-snug text-slate-600">
          These reach ElevenLabs untouched and change nothing about the alignment. Very
          low stability makes a more variable read, which is harder to align well, but
          that is a consequence of the audio rather than of the setting &mdash; which is
          why the accent preset raises style only as far as 0.30. On v3 stability is not
          continuous: it rounds to 0, 0.5 or 1, so anything between 0.26 and 0.74 is the
          same middle setting, and 1 makes the voice stop responding to tags at all.
        </p>
      </details>

      {reactions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-800 px-3 py-2">
          <span className="text-xs font-medium text-slate-400">How reactions are performed</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <label className="flex items-center gap-2" title="Each reaction moves the eyes the way the body does — a yawn shuts them, a sniff blinks, a gasp leaves them alone">
              <input
                type="checkbox"
                checked={reactions_.eyes}
                onChange={(e) => setReactions((r) => ({ ...r, eyes: e.target.checked }))}
              />
              <span className="text-xs text-slate-300">Eyes follow the reaction</span>
            </label>
            {reactions.some((r) => r.laughing) && (
              <label className="flex items-center gap-2" title={`A beat of smile before a laugh opens, on spans over ${SMILE_LEAD_MIN_MS}ms`}>
                <input
                  type="checkbox"
                  checked={reactions_.smileLeadIn}
                  onChange={(e) => setReactions((r) => ({ ...r, smileLeadIn: e.target.checked }))}
                />
                <span className="text-xs text-slate-300">Smile before a laugh</span>
              </label>
            )}
            {reactions.some((r) => r.laughing) && (
              <label className="flex items-center gap-2" title="The mouth holds the laugh pose and the head bobs through it — which is what makes it read as laughing rather than as an open mouth">
                <input
                  type="checkbox"
                  checked={reactions_.nod}
                  onChange={(e) => setReactions((r) => ({ ...r, nod: e.target.checked }))}
                />
                <span className="text-xs text-slate-300">Head bobs through a laugh</span>
              </label>
            )}
            {reactions.some((r) => r.giggling) && (
              <label className="flex items-center gap-2" title="A giggle is a closed-mouth smile, so the bob is the only thing saying it is a laugh at all — shallower than the laugh's, and switched separately for that reason">
                <input
                  type="checkbox"
                  checked={reactions_.giggleNod}
                  onChange={(e) => setReactions((r) => ({ ...r, giggleNod: e.target.checked }))}
                />
                <span className="text-xs text-slate-300">Head bobs through a giggle</span>
              </label>
            )}
          </div>
          {/* What each tag does is not a preference, so it is shown rather than offered. */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
            {reactions.map((r) => (
              <span key={r.tag} className="font-mono">
                {r.tag}
                <span className="text-slate-700">
                  {' '}
                  {r.perform === 'pulse'
                    ? 'pulses'
                    : r.perform === 'arc'
                      ? 'opens and closes'
                      : r.laughing
                        ? 'holds, head bobs'
                        : r.giggling
                          ? 'closed smile, small bob'
                          : 'holds'}
                  {r.eyes === 'closed' ? ', eyes shut' : r.eyes === 'blink' ? ', blinks' : ''}
                </span>
              </span>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-slate-600">
            What each reaction does is anatomy, not preference — a gasp keeps its eyes
            open because a gasp widens them and no kit has wide-eye artwork. The switches
            are there because whether that suits a particular drawing is a different
            question. A laugh holds its pose and takes its rhythm from the head: drawn
            artwork swaps whole mouths rather than opening a jaw, so a pulsing laugh
            flapped between two pictures. A giggle is that same gesture held in: the
            lips stay shut, the eyes stay open, and the head bobs half as far.
          </p>
        </div>
      )}

      {warnings.map((w) => (
        <p
          key={w.found}
          className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {w.message}
        </p>
      ))}

      {crowded.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <div className="flex flex-col items-start gap-1.5">
            <span>
              {crowded.map((w) => w.tag).join(' ')} —{' '}
              {crowded.length === 1 ? 'this one has' : 'these have'} a word hard against{' '}
              {crowded.length === 1 ? 'it' : 'them'}. The tag is removed before synthesis,
              so the voice has no reason to leave a pause there and the clip will be cut
              into continuous speech. Punctuation gives it somewhere to sit.
            </span>
            <button
              type="button"
              onClick={() => setText(addRoom(text, crowded))}
              className="rounded-md border border-amber-800/70 px-2 py-0.5 text-[11px] text-amber-200 transition-colors hover:border-amber-600 hover:text-amber-100"
            >
              Add {crowded.length === 1 ? 'a pause' : `${crowded.length} pauses`}
            </button>
            <span className="text-[11px] text-amber-300/60">
              Adds a comma, or a dash for a yawn or a sigh — never a full stop, so nothing
              needs recapitalising. Undo puts it back. A clip is padded with a little
              silence either way, so this changes how the line reads rather than whether
              it works.
            </span>
          </div>
        </div>
      )}

      {cost.unknownTags.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {cost.unknownTags.join(' ')} — not a tag this build knows. It will be stripped
          from the transcript either way, but ElevenLabs may well speak it aloud, and you
          are billed for the characters regardless.
        </p>
      )}

      {/* Two different claims about two different sets of tags, so two notices. Merging
          them into one count was actively wrong once the library existed: a spliced laugh
          is the opposite of "marked from the timings" — its span is the length of a clip
          chosen before synthesis, which is the strongest guarantee on this page, and
          filing it under the same warning as an unaligned sigh buries that. */}
      {fromLibrary.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/20 px-3 py-2 text-xs text-emerald-300">
          <Sparkles size={14} className="mt-0.5 shrink-0" />
          {fromLibrary.join(' ')} will be spliced in from the laugh library and never sent
          to ElevenLabs, so the span is exactly as long as the clip.
        </p>
      )}

      {dropped.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-slate-800 px-3 py-2 text-xs text-slate-400">
          <AlertTriangle size={14} className="mt-0.5 shrink-0 text-slate-600" />
          {dropped.join(' ')} will be removed and nothing put in its place — multilingual v2
          cannot perform a tag, and leaving one in risks the word being read aloud. Add a
          laugh for this voice below and it will be spliced in instead.
        </p>
      )}

      {fromTimings.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {fromTimings.length} reaction tag{fromTimings.length === 1 ? '' : 's'} —{' '}
          {fromTimings.join(' ')} — will have their spans marked from the timings rather
          than aligned.
        </p>
      )}

      {problem && (
        <p className="flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {problem}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !script.trim() || !voiceId.trim() || !voiceGender}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-700"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {busy ? 'Generating…' : 'Generate'}
        </button>
        {busy && (
          // Said plainly rather than left to a spinner: the second call is a container
          // that may be cold, and a minute of silence is how someone decides it broke.
          <span className="text-xs text-slate-600">
            Synthesising, then aligning. A cold aligner adds up to a minute.
          </span>
        )}
      </div>
    </section>
  );
}
