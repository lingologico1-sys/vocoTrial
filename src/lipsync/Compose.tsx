import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { fetchQuota, generate, LipsyncError, type Generated } from './library';
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
  DEFAULT_REACTIONS,
  DEFAULT_PARAMS,
  type ReactionOptions,
  type LipsyncModel,
  type LipsyncPackage,
  type VoiceParams,
} from './published';
import { SMILE_LEAD_MIN_MS, TAGS, reactionsIn, stripTags, type Tag } from './tags';
import { scriptWarnings } from './warnings';

/**
 * Writing a line and hearing it, without leaving the page.
 *
 * The panel exists because the alternative was four files carried between two tools by
 * hand, and the pairing went wrong twice in one afternoon. Generating here means the
 * audio, the timings, the transcript and the marks are made by one request from one
 * piece of text, so they cannot describe different utterances. See generate.ts.
 *
 * Tags are offered only on v3, because only v3 has them; on the other model the palette
 * is disabled rather than absent, so it is clear the feature exists and which model it
 * belongs to rather than looking like it was never built.
 */

interface ComposeProps {
  onGenerated: (result: Generated) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
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
    hint: 'Well proven and still returns timings, but ignores tags entirely.',
  },
];

const GROUPS: Array<Tag['group']> = ['Emotions', 'Delivery', 'Reactions', 'Pacing'];

/** How a tag is dressed, which is a warning as much as a colour. */
const KIND_STYLE: Record<Tag['kind'], string> = {
  directive: 'border-slate-700 text-slate-300 hover:border-slate-500',
  pause: 'border-sky-900 text-sky-300 hover:border-sky-700',
  reaction: 'border-amber-900 text-amber-300 hover:border-amber-700',
};

export default function Compose({ onGenerated, busy, setBusy }: ComposeProps) {
  const [text, setText] = useState('');
  const [language, setLanguage] = useState<LipsyncPackage['language']>('fr');
  const [voiceId, setVoiceId] = useState('');
  const [model, setModel] = useState<LipsyncModel>('eleven_v3');
  const [params, setParams] = useState<VoiceParams>(DEFAULT_PARAMS);
  const [reactions_, setReactions] = useState<ReactionOptions>(DEFAULT_REACTIONS);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);

  // Read once on mount and again after each generation, since generating is the only
  // thing on this page that spends any of it.
  useEffect(() => {
    void fetchQuota().then(setQuota);
  }, []);

  const tagsAllowed = model === 'eleven_v3';
  const cost = useMemo(() => costOf(text), [text]);
  const script = useMemo(() => stripTags(text), [text]);
  const reactions = useMemo(() => (tagsAllowed ? reactionsIn(text) : []), [text, tagsAllowed]);
  const warnings = useMemo(() => scriptWarnings(script), [script]);

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
    setBusy(true);
    try {
      const result = await generate({
        text,
        language,
        voiceId: voiceId.trim(),
        model,
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

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-slate-400">Voice ID</span>
          <input
            value={voiceId}
            onChange={(event) => setVoiceId(event.target.value)}
            placeholder="from the ElevenLabs voice page"
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 placeholder:text-slate-700"
          />
        </label>

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
            <span className="text-[11px] text-slate-600">v3 only</span>
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
                disabled={!tagsAllowed}
                onClick={() => insert(t.tag)}
                title={
                  t.kind === 'reaction'
                    ? 'Makes sound the transcript has no words for. Its span is marked from the timings rather than aligned.'
                    : t.kind === 'pause'
                      ? 'Inserts silence, which the aligner reads correctly on its own.'
                      : 'Changes how the words are said. No effect on alignment.'
                }
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:border-slate-900 disabled:text-slate-700 ${KIND_STYLE[t.kind]}`}
              >
                {t.tag}
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
      </div>

      <details className="rounded-lg border border-slate-800 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-slate-400">
          Voice parameters
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {([
            ['stability', 'Stability', 'Higher is more consistent, lower more expressive'],
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
          that is a consequence of the audio rather than of the setting.
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
          </div>
          {/* What each tag does is not a preference, so it is shown rather than offered. */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
            {reactions.map((r) => (
              <span key={r.tag} className="font-mono">
                {r.tag}
                <span className="text-slate-700">
                  {' '}
                  {r.perform === 'pulse' ? 'pulses' : r.perform === 'arc' ? 'opens and closes' : 'holds'}
                  {r.eyes === 'closed' ? ', eyes shut' : r.eyes === 'blink' ? ', blinks' : ''}
                </span>
              </span>
            ))}
          </div>
          <p className="text-[11px] leading-snug text-slate-600">
            What each reaction does is anatomy, not preference — a laugh pulses because
            one held shape reads as a scream, a gasp keeps its eyes open because a gasp
            widens them and no kit has wide-eye artwork. The switch is there because
            whether that suits a particular drawing is a different question. A nod is
            carried in the package but not yet wired to the head.
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

      {cost.unknownTags.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {cost.unknownTags.join(' ')} — not a tag this build knows. It will be stripped
          from the transcript either way, but ElevenLabs may well speak it aloud, and you
          are billed for the characters regardless.
        </p>
      )}

      {reactions.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {reactions.length} reaction tag{reactions.length === 1 ? '' : 's'} —{' '}
          {reactions.map((r) => r.tag).join(' ')} — will have their spans marked from the
          timings rather than aligned.
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
          disabled={busy || !script.trim() || !voiceId.trim()}
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
