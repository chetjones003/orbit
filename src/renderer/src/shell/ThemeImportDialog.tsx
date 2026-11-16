import { useEffect, useState } from 'react';
import type { ThemeImportDraft, ThemeSearchResult } from '../../../shared/themes';
import { Modal } from '../chrome/Modal';
import { markColor, markLetters } from './repo-mark';
import { RepoMark } from './RepoMark';

const SEARCH_DELAY_MS = 300;

/** The quick tabs. Each one searches Open VSX for its query; Popular lists the most used themes. */
const TABS = [
  { id: 'popular', label: 'Popular', query: '' },
  { id: 'dracula', label: 'Dracula', query: 'dracula' },
  { id: 'catppuccin', label: 'Catppuccin', query: 'catppuccin' },
  { id: 'rose-pine', label: 'Rosé Pine', query: 'rose pine' },
  { id: 'nord', label: 'Nord', query: 'nord' },
  { id: 'tokyo-night', label: 'Tokyo Night', query: 'tokyo night' }
] as const;

type SortKey = 'downloadCount' | 'timestamp';
const SORTS: { id: SortKey; label: string }[] = [
  { id: 'downloadCount', label: 'Most downloaded' },
  { id: 'timestamp', label: 'Recently updated' }
];

export interface ThemeImportDialogProps {
  /** Adds a theme read from an Open VSX extension. */
  onAdd(draft: ThemeImportDraft): void;
  onClose(): void;
}

/**
 * Finds colour themes on Open VSX and adds one. It opens already showing the popular themes. Only colours are read
 * from an extension; nothing from it runs, and nothing is added until Add is pressed.
 */
export function ThemeImportDialog({ onAdd, onClose }: ThemeImportDialogProps) {
  const [tab, setTab] = useState<string | null>('popular');
  const [typed, setTyped] = useState('');
  const [sort, setSort] = useState<SortKey>('downloadCount');
  const [results, setResults] = useState<ThemeSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Bumped by Try again, so a failed search runs once more without the query changing.
  const [attempt, setAttempt] = useState(0);

  // What is searched: whatever was typed, otherwise the chosen tab's query.
  const typedQuery = typed.trim();
  const tabQuery = TABS.find((entry) => entry.id === tab)?.query ?? '';
  const query = typedQuery.length > 0 ? typedQuery : tabQuery;

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    setError(null);
    const timer = setTimeout(
      () => {
        void window.orbit.themes.search({ query, sort }).then(
          (found) => {
            if (!cancelled) setResults(found);
          },
          (failure: unknown) => {
            if (cancelled) return;
            setResults([]);
            setError(messageOf(failure, 'Open VSX could not be searched.'));
          }
        );
      },
      typedQuery.length > 0 ? SEARCH_DELAY_MS : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, sort, typedQuery.length, attempt]);

  const add = (result: ThemeSearchResult): void => {
    const key = `${result.namespace}.${result.name}`;
    setBusy(key);
    setError(null);
    void window.orbit.themes
      .import({ namespace: result.namespace, name: result.name })
      .then(
        (draft) => onAdd(draft),
        (failure: unknown) => setError(messageOf(failure, 'That theme could not be read.'))
      )
      .finally(() => setBusy(null));
  };

  return (
    <Modal
      title="Add theme"
      subtitle="Find colour themes on Open VSX"
      onClose={onClose}
      className="theme-import-modal"
    >
      <div className="theme-import">
        <input
          className="theme-import-search"
          type="search"
          aria-label="Search Open VSX themes"
          placeholder="Search themes, such as Dracula"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />

        <div className="theme-import-toolbar">
          <div className="theme-import-tabs" role="group" aria-label="Quick searches">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={tab === entry.id && typedQuery.length === 0}
                className={`theme-import-tab ${tab === entry.id && typedQuery.length === 0 ? 'active' : ''}`}
                onClick={() => {
                  setTab(entry.id);
                  setTyped('');
                }}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <label className="theme-import-sort">
            <span className="sr-only">Sort by</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
              {SORTS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <p className="issue-error" role="alert">
            {error}
          </p>
        )}
        {results === null && !error && (
          <p className="theme-import-status" role="status">
            Loading themes… This can take up to 8 seconds.
          </p>
        )}
        {results !== null && results.length === 0 && error && (
          <button type="button" className="secondary-action" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </button>
        )}
        {results !== null && results.length === 0 && !error && (
          <p className="theme-import-status">No colour themes found.</p>
        )}

        <ul className="theme-import-grid">
          {(results ?? []).map((result) => {
            const key = `${result.namespace}.${result.name}`;
            return (
              <li key={key} className="theme-import-card">
                {result.icon ? (
                  <img className="theme-import-icon" src={result.icon} alt="" />
                ) : (
                  <RepoMark
                    letters={markLetters(result.displayName)}
                    color={markColor(result.namespace)}
                    size={40}
                  />
                )}
                <div className="theme-import-card-body">
                  <span className="theme-import-name">
                    {result.displayName}
                    {result.verified && <span className="theme-import-verified">Verified</span>}
                  </span>
                  <span className="theme-import-by">
                    {result.namespace} · {result.downloads.toLocaleString()} downloads
                  </span>
                  {result.description && (
                    <span className="theme-import-description">{result.description}</span>
                  )}
                </div>
                <button
                  type="button"
                  className="secondary-action"
                  aria-label={`Add ${result.displayName}`}
                  disabled={busy !== null}
                  onClick={() => add(result)}
                >
                  {busy === key ? 'Adding…' : 'Add'}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Modal>
  );
}

function messageOf(failure: unknown, fallback: string): string {
  return failure instanceof Error && failure.message ? failure.message : fallback;
}
