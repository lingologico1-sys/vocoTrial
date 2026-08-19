import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { FR } from './strings';
import * as vocab from './vocab';
import type { VocabCategory, VocabItem, VocabSort } from './vocab';

/**
 * The words this learner decided were worth keeping.
 *
 * Ported from LingoLecto, sort and filters and all. The one thing worth saying
 * about it is what happens on a click: the whole lookup was stored with the
 * word, so opening one is instant and costs nothing — no model call, and it
 * works with the network down. That is the payoff for the storage, and the
 * reason a bare list of words would have been the cheaper, worse design.
 */

const CATEGORIES: Array<VocabCategory | 'all'> = [
  'all',
  'verb',
  'noun',
  'adjective',
  'adverb',
  'expression',
  'other',
];

interface VocabPanelProps {
  items: VocabItem[];
  /** Reopening a saved word shows it in the dictionary tab. */
  onOpen: (item: VocabItem) => void;
  onChange: () => void;
}

export default function VocabPanel({ items, onOpen, onChange }: VocabPanelProps) {
  const [sort, setSort] = useState<VocabSort>('alpha');
  const [category, setCategory] = useState<VocabCategory | 'all'>('all');

  const shown = useMemo(() => vocab.arrange(items, sort, category), [items, sort, category]);

  const drop = (term: string) => {
    vocab.remove(term);
    onChange();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-lingo-border px-4 py-2.5">
        <div className="flex gap-1">
          {(['alpha', 'recent'] as VocabSort[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSort(option)}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                sort === option
                  ? 'bg-lingo-accent-glow text-lingo-accent-deep'
                  : 'text-lingo-muted hover:text-lingo-ink'
              }`}
            >
              {option === 'alpha' ? FR.vocabSortAlpha : FR.vocabSortRecent}
            </button>
          ))}
        </div>
        <span className="text-xs text-lingo-muted">{FR.vocabCount(items.length)}</span>
      </div>

      <div className="flex shrink-0 flex-wrap gap-1 border-b border-lingo-border px-4 py-2">
        {CATEGORIES.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setCategory(option)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
              category === option
                ? 'border-lingo-accent bg-lingo-accent text-white'
                : 'border-lingo-border text-lingo-muted hover:border-lingo-accent-light'
            }`}
          >
            {FR.vocabCats[option]}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm leading-relaxed text-lingo-muted">
            {FR.vocabEmpty}
          </p>
        ) : shown.length === 0 ? (
          <p className="py-8 text-center text-sm text-lingo-muted">{FR.vocabEmptyCategory}</p>
        ) : (
          <ul className="space-y-1.5">
            {shown.map((item) => (
              <li key={item.term}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpen(item);
                    }
                  }}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-lingo-border-light bg-lingo-surface px-3 py-2 transition-colors hover:border-lingo-accent-light"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-lingo-ink">
                        {item.term}
                      </span>
                      <span className="shrink-0 rounded-full bg-lingo-paper px-1.5 py-0.5 text-[10px] font-medium text-lingo-muted">
                        {FR.vocabCats[item.category ?? 'other']}
                      </span>
                    </div>
                    <p className="truncate text-xs text-lingo-muted">
                      {item.data.entries?.[0]?.definitions?.[0]?.translation ?? ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={FR.vocabRemove}
                    title={FR.vocabRemove}
                    onClick={(event) => {
                      event.stopPropagation();
                      drop(item.term);
                    }}
                    className="shrink-0 rounded p-1 text-lingo-muted transition-colors hover:bg-lingo-error-bg hover:text-lingo-error"
                  >
                    <X size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
