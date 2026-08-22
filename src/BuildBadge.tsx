/**
 * Which build of the app you are looking at, in a corner.
 *
 * EXTRACTED RATHER THAN COPIED, because a second page now wears it. tutorBench
 * had it inline; /teach needs the same answer to the same question, and two
 * badges in two files that are supposed to agree about what a deployment id
 * means are two badges that will stop agreeing.
 *
 * WHAT IT SHOWS, AND WHY BOTH. The commit answers "am I looking at what I
 * pushed"; the deployment answers "is this a *different* build of it", which
 * retrying a build or changing a dashboard secret both produce from an
 * unchanged commit. The deployment id trails the commit rather than replacing
 * it, and dimmer, because it is the answer to the rarer question. It is dropped
 * entirely when there is no commit beside it — on a local build the label is
 * already standing in for something (see vite.config.ts), and a lone id in a
 * paler grey would read as a second fact rather than the same one.
 */

/**
 * Which family of page is asking, which settles both the palette and the
 * corner.
 *
 * The two travel together rather than being separate props because they are
 * decided by the same thing: the chrome the page already has. A workshop page
 * is dark slate with nothing in its top right, so the badge goes there, where
 * the eye looks for a build stamp. A lingo page wears BrandBar — full-bleed,
 * with the page's own link at the right end of it — so a badge at the top right
 * lands on that link on any viewport narrow enough for the 1152px column to
 * reach the edge. It goes to the bottom instead, in the family's warm palette,
 * because a maintainer's stamp is not worth putting a hole in a teacher's
 * header for.
 */
export type BuildLook = 'workshop' | 'lingo';

const LOOKS: Record<BuildLook, { box: string; deploy: string }> = {
  workshop: {
    box: 'fixed right-3 top-3 rounded-md border border-slate-800 bg-slate-900/80 px-2 py-1 font-mono text-[11px] leading-none text-slate-500 backdrop-blur',
    deploy: 'text-slate-600',
  },
  lingo: {
    box: 'fixed bottom-3 right-3 rounded-lg border-2 border-lingo-border-strong bg-lingo-cream/85 px-2 py-1 font-lingo-mono text-[11px] leading-none text-lingo-muted shadow-lingo-pop-sm backdrop-blur',
    deploy: 'text-lingo-muted/60',
  },
};

export default function BuildBadge({ look }: { look: BuildLook }) {
  const skin = LOOKS[look];

  // Both facts, spelled out, in the order they get asked about.
  const title = [
    __BUILD_INFO__.deploy && `deployment ${__BUILD_INFO__.deploy}`,
    __BUILD_INFO__.commit && `commit ${__BUILD_INFO__.commit}`,
    __BUILD_INFO__.branch,
    `built ${__BUILD_INFO__.builtAt}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span title={title} className={`z-50 ${skin.box}`}>
      {__BUILD_INFO__.label}
      {__BUILD_INFO__.commit && __BUILD_INFO__.deploy && (
        <span className={`ml-1.5 ${skin.deploy}`}>{__BUILD_INFO__.deploy}</span>
      )}
    </span>
  );
}
