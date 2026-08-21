import { useEffect, useState } from 'react';
import { buildDiagnostic, type DiagnosticInput } from './diagnostic';

/**
 * The diagnostic, over the whole page, with one thing to do.
 *
 * IT IS A WORKSHOP OBJECT AND IT LOOKS LIKE ONE. Everything else on /eleve is
 * LingoMondo's cream and terracotta, in French, sized for a student; this is
 * slate and English and monospaced, exactly like faceKit's diagnostics drawer.
 * That is deliberate on both counts. The person reading it is whoever published
 * the lesson, not the person taking it — and a student who finds it by accident
 * should be able to tell at a glance that they have fallen through the floor of
 * their own app, rather than meeting a French panel of numbers they are
 * supposed to understand.
 *
 * THE TEXT IS BUILT WHEN THE PANEL OPENS AND NEVER AGAIN, which is why it is a
 * lazy state initialiser rather than a memo over the input. A call is usually
 * still running while this is up and turns are streaming in underneath it — and
 * a report that rewrote itself under the reader would stop matching the one
 * they just copied. A diagnostic is a photograph. Closing and reopening takes
 * another one.
 *
 * ONE BUTTON THAT MATTERS. The whole point is getting this text into somebody
 * else's hands, so the copy is the primary control and the panel below it is
 * only there to prove there is something to copy — and to be readable on a
 * phone, where there is no other way to see it at all.
 */

/** How long the button says it worked before going back to asking. */
const CONFIRM_MS = 2000;

interface DiagnosticPanelProps {
  input: DiagnosticInput;
  onClose: () => void;
}

export default function DiagnosticPanel({ input, onClose }: DiagnosticPanelProps) {
  const [text] = useState(() => buildDiagnostic(input));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /*
       * Clipboard access is refused outright in some contexts — an insecure
       * origin, an iframe without permission, an older mobile browser — and a
       * silent no-op there would be the worst possible outcome, since handing
       * this text to someone else is the only thing the panel is for. A
       * textarea and execCommand still work where the async API does not.
       * Copied verbatim from faceKit's drawer, which learned it first.
       */
      const holder = document.createElement('textarea');
      holder.value = text;
      holder.style.position = 'fixed';
      holder.style.opacity = '0';
      document.body.appendChild(holder);
      holder.select();
      document.execCommand('copy');
      holder.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), CONFIRM_MS);
  };

  const lines = text.split('\n').length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 font-lingo-mono text-slate-300 backdrop-blur-sm">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-800 px-4 py-3">
        <span className="text-sm text-slate-200">Voco diagnostic</span>
        <span className="text-[11px] text-slate-600">
          {lines} lines · {text.length.toLocaleString()} characters · taken just now
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 hover:border-slate-400"
          >
            {copied ? 'Copied' : 'Copy all'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-800 px-3 py-1.5 text-xs text-slate-500 hover:border-slate-600"
          >
            Close
          </button>
        </div>
      </div>

      {/*
        `whitespace-pre` rather than `pre-wrap`, and it scrolls sideways. The
        timeline is a table held together by padded columns, and wrapping it at
        a phone's width turns every long turn into a ragged block that no longer
        lines up with the stamps beside it — which is the one thing that makes
        the section readable.
      */}
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre px-4 py-3 text-[11px] leading-relaxed">
        {text}
      </pre>
    </div>
  );
}
