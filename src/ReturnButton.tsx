/**
 * Back to the front door, from every page that is not the student's.
 *
 * EXTRACTED RATHER THAN COPIED, for the reason BuildBadge.tsx gives: four pages
 * now carry the same control to the same place, and four hand-written links
 * that are supposed to agree about where "back" is are four links that will
 * stop agreeing. It replaced the `start →` links tutorBench, faceKit and studio
 * each wrote for themselves — same destination, three different labels and
 * three different weights, so which page you were on changed how the way out
 * looked.
 *
 * IT POINTS AT `/` AND TAKES NO DESTINATION, because a control that can go
 * anywhere is a link and this is not one. The pages already carry links between
 * themselves — studio names faceKit, teach names the student page — and those
 * stay links. This is the one fixed exit.
 *
 * A PLAIN ANCHOR, NOT A ROUTER PUSH. main.tsx reads the path once at startup,
 * so crossing between pages is a reload by design.
 *
 * NOT ON `/eleve`, and not because it was forgotten. A student is handed a code
 * and a page to use it on; the front door lists the workshop that built the
 * thing, which is not somewhere a lesson should offer to send them. The site's
 * one shared password means they could still type `/` — see Start.tsx on that
 * door already being unlocked — but no lesson holds it open for them.
 */
import { ArrowLeft } from 'lucide-react';
import type { BuildLook } from './BuildBadge';

/**
 * The same two families BuildBadge dresses for, and for the same reason: a
 * workshop page is dark slate, a lingo page is the warm LingoLabo palette, and
 * a control that ignored that would be the one piece of either page that came
 * from somewhere else.
 */
const LOOKS: Record<BuildLook, string> = {
  workshop:
    'inline-flex items-center gap-1.5 rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:border-slate-700 hover:text-slate-200',
  lingo:
    'inline-flex items-center gap-1.5 rounded-lg border-2 border-white/20 bg-white/10 px-2.5 py-1 text-[13px] text-lingo-paper transition-colors hover:border-lingo-accent-light',
};

export default function ReturnButton({ look }: { look: BuildLook }) {
  return (
    <a href="/" className={LOOKS[look]}>
      <ArrowLeft size={look === 'lingo' ? 14 : 13} />
      Return
    </a>
  );
}
