import { useMemo, useState } from 'react';
import { AlertTriangle, Check, ClipboardCopy, Stethoscope } from 'lucide-react';
import { MIN_QUIET, quietStretches, report } from './diagnose';
import type { LipsyncPackage } from './published';

/**
 * Why the mouth did that.
 *
 * WHAT THIS IS FOR, and it comes from a real complaint rather than a hunch: a generated
 * line played back with the face shut at a moment the voice was plainly speaking, and
 * the only thing the page had to say about it was "1 word were not in the dictionary".
 * That sentence is true, useless, and slightly wrong about grammar. It names no word,
 * points at no moment, and leaves the only available move as rereading the line and
 * guessing.
 *
 * So this panel answers the question that was actually being asked: at this second, why
 * is the mouth closed? There are only three answers, and telling them apart is the whole
 * job:
 *
 *   a pause          the recording really is quiet. Correct, and nothing to fix.
 *   an unknown word  the aligner could not look the word up, gave it the phone `spn`,
 *                    and `spn` draws as rest. The voice is speaking and the face is not.
 *                    This is the bug someone is looking at.
 *   neither          a stretch with words in it, none of them unknown, and the mouth
 *                    shut anyway. Nothing should produce this, which is exactly why it
 *                    is listed rather than filtered out -- if it ever appears it is a
 *                    finding, and a silent one otherwise.
 *
 * Pauses shorter than MIN_QUIET are not listed: below that the mouth is easing between
 * poses rather than sitting still, and every consonant cluster would file a report. That
 * floor does NOT apply to an unknown word, which is reported at any length — a brief one
 * is not a harmless one, and the filter would otherwise hide the whole point.
 *
 * The classification itself lives in diagnose.ts, which also writes the plain-text
 * version behind the copy button: the same findings, in a form that can be pasted into
 * a message by somebody asking why their face shut its mouth.
 */

const secs = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

export default function Diagnostics({ pkg }: { pkg: LipsyncPackage }) {
  const quiet = useMemo(() => quietStretches(pkg), [pkg]);
  const [copied, setCopied] = useState(false);

  async function copy() {
    const text = report(pkg);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access can be refused — an insecure origin, a permission prompt
      // declined. Falling back to a hidden textarea and execCommand is deprecated but
      // still works everywhere, and a copy button that silently does nothing is worse
      // than one leaning on an old API.
      const box = document.createElement('textarea');
      box.value = text;
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      try {
        document.execCommand('copy');
      } finally {
        document.body.removeChild(box);
      }
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const suspect = quiet.filter((q) => q.unknown.length > 0);
  // Quiet where words were spoken but none of them was unknown. Should not happen.
  const unexplained = quiet.filter((q) => q.unknown.length === 0 && q.words.length > 0);
  const pauses = quiet.filter((q) => q.words.length === 0);

  return (
    <details className="rounded-xl border border-slate-800 px-4 py-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-300">
        <Stethoscope size={15} className="text-slate-600" />
        Why the mouth did that
        <span className="ml-2 text-xs font-normal text-slate-600">
          {quiet.length} quiet stretch{quiet.length === 1 ? '' : 'es'}
          {pkg.oovWords.length > 0 && ` · ${pkg.oovWords.length} unknown word${pkg.oovWords.length === 1 ? '' : 's'}`}
        </span>
      </summary>

      <button
        type="button"
        onClick={(event) => {
          // Inside a <details>, a click would otherwise toggle the panel shut.
          event.preventDefault();
          void copy();
        }}
        className="mt-3 inline-flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-600"
      >
        {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
        {copied ? 'Copied — paste it anywhere' : 'Copy this diagnosis'}
      </button>

      <div className="mt-4 flex flex-col gap-4 text-xs">
        {/* First, because it is the only row that can say the audio is shorter than the
            marks — which is what a splice that threw bytes away looks like from outside,
            and which nothing on this page could see until it had happened once. */}
        {pkg.audio && (
          <div className="flex flex-col gap-1.5">
            <div
              className={`flex items-center gap-2 font-medium ${
                Math.abs(pkg.audio.driftMs) > 250 ? 'text-rose-300' : 'text-slate-300'
              }`}
            >
              {Math.abs(pkg.audio.driftMs) > 250 && <AlertTriangle size={14} />}
              Audio as built
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 font-mono text-[11px] text-slate-500">
              <span>format</span>
              <span className="text-slate-400">{pkg.audio.format}</span>
              <span>speech</span>
              <span className="text-slate-400">
                {pkg.audio.speech.frames} frames · {secs(pkg.audio.speech.durationMs)} ·{' '}
                {pkg.audio.speech.bytes.toLocaleString()} bytes
              </span>
              <span>final</span>
              <span className="text-slate-400">
                {pkg.audio.final.frames} frames · {secs(pkg.audio.final.durationMs)} ·{' '}
                {pkg.audio.final.bytes.toLocaleString()} bytes
              </span>
              <span>drift</span>
              <span
                className={
                  Math.abs(pkg.audio.driftMs) > 250 ? 'text-rose-300' : 'text-slate-400'
                }
              >
                {pkg.audio.driftMs}ms
                {Math.abs(pkg.audio.driftMs) > 250 && ' — audio is missing, the marks outlast it'}
              </span>
            </div>
            {pkg.audio.clips.map((clip) => (
              <div
                key={clip.clipId}
                className={`font-mono text-[11px] ${clip.used ? 'text-slate-500' : 'text-amber-400/80'}`}
              >
                {clip.used ? 'used' : 'SKIPPED'} · {secs(clip.durationMs)} · {clip.frames}{' '}
                frames · {clip.format} · &ldquo;{clip.label}&rdquo;
                {clip.skipped ? ` — ${clip.skipped}` : ''}
                {/* The room the clip was cut into, which is the answer to "why does this
                    one sound like it interrupted the sentence". A zero gap is not an
                    error — it is two words the model ran together, and the fix is a comma
                    in the script rather than anything here. Amber rather than red for
                    exactly that reason. */}
                {clip.used && clip.gapMs !== undefined && (
                  <span className={clip.gapMs === 0 ? 'text-amber-400/80' : undefined}>
                    {' '}
                    · cut into a {clip.gapMs}ms gap
                    {clip.padMs ? `, padded ${clip.padMs}ms either side` : ''}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {pkg.oovWords.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 font-medium text-amber-300">
              <AlertTriangle size={14} />
              The aligner could not look these up
            </div>
            <table className="w-full">
              <tbody>
                {pkg.oovWords.map((w) => (
                  <tr key={`${w.word}-${w.startMs}`} className="border-t border-slate-900">
                    <td className="py-1 pr-3 font-mono text-amber-200">{w.word}</td>
                    <td className="py-1 pr-3 font-mono text-slate-500">
                      {secs(w.startMs)} – {secs(w.endMs)}
                    </td>
                    <td className="py-1 text-slate-500">
                      spoken, but the mouth stays shut through it
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="leading-relaxed text-slate-600">
              An unknown word is given the phone <span className="font-mono">spn</span>,
              which draws as rest. Usually a name, a loanword, or a spelling the
              dictionary writes differently — <span className="font-mono">niño</span> is
              known where <span className="font-mono">nino</span> is not. Rewriting it the
              way the dictionary spells it, or replacing it with a word that means the
              same, fixes it; nothing about the voice or the face is wrong.
            </p>
          </div>
        )}

        {unexplained.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 font-medium text-rose-300">
              <AlertTriangle size={14} />
              Shut while words were being spoken, and not because of an unknown word
            </div>
            {unexplained.map((q) => (
              <div key={q.startMs} className="font-mono text-slate-400">
                {secs(q.startMs)} – {secs(q.endMs)}{' '}
                <span className="text-slate-600">over “{q.words.join(' ')}”</span>
              </div>
            ))}
            <p className="leading-relaxed text-slate-600">
              Nothing is expected to produce this. If it is here, the alignment and the
              audio disagree about where the words are — worth checking the script against
              what the voice actually said.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="font-medium text-slate-400">
            Pauses — correct, nothing to fix ({pauses.length})
          </div>
          {pauses.length === 0 ? (
            <p className="text-slate-600">None over {MIN_QUIET}ms.</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-slate-600">
              {pauses.map((q) => (
                <span key={q.startMs}>
                  {secs(q.startMs)}–{secs(q.endMs)}{' '}
                  <span className="text-slate-700">({q.endMs - q.startMs}ms)</span>
                </span>
              ))}
            </div>
          )}
          <p className="leading-relaxed text-slate-600">
            The recording is genuinely quiet here, so a closed mouth is right. MFA leaves
            silence unlabelled rather than marking it, and these are the holes read back
            as rest.
          </p>
        </div>

        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-900 pt-3 font-mono text-[11px] text-slate-600">
          <span>{pkg.marks.length} marks</span>
          <span>{pkg.words.length} words</span>
          <span>{secs(pkg.durationMs)} aligned</span>
          <span>{pkg.model}</span>
          <span>{pkg.language}</span>
          {pkg.reactionCount > 0 && <span>{pkg.reactionCount} reaction spans overlaid</span>}
          {suspect.length > 0 && (
            <span className="text-amber-400/80">{suspect.length} quiet stretches explained by an unknown word</span>
          )}
        </div>
      </div>
    </details>
  );
}
