import { useEffect, useMemo, useState } from 'react';
import type { InboxItem } from '../../../shared/inbox';
import {
  SEARCH_KINDS,
  SEARCH_STATES,
  activeFilters,
  parseSearchText,
  removeSearchFilter,
  resolveSearch,
  type ActiveFilter,
  type RepoRef,
  type SearchChips,
  type SearchKind,
  type SearchPage,
  type SearchRequest,
  type SearchState
} from '../../../shared/search';
import {
  SegmentedControl,
  SegmentedControlIndicator,
  SegmentedControlItem
} from '@ui-sdk/react/segmented-control';
import { Icon } from '../icons';
import { IssueLabelChip } from '../issues/IssueLabelChip';

/** Typing settles for this long before a search goes to GitHub. */
export const SEARCH_DELAY_MS = 250;

const KIND_LABELS: Record<SearchKind, string> = { all: 'All', issue: 'Issues', pull: 'Pull requests' };
const STATE_LABELS: Record<SearchState, string> = { open: 'Open', closed: 'Closed', all: 'Any' };
const EXAMPLES = ['open pull requests', 'closed issues', 'issues labeled bug'];
const DEFAULT_CHIPS: SearchChips = { kind: 'all', state: 'open', repoFullName: null };

/** A plain message for a failed search. Messages from main about the search itself are plain enough to show. */
function describeFailure(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : '';
  if (/rate limit/i.test(detail))
    return 'GitHub rate limit reached. Search works again after the limit resets.';
  if (/own repositories|GitHub account name|Search text|labels at a time/i.test(detail)) return detail;
  return 'Could not run this search.';
}

export interface SearchSelection {
  repoFullName: string;
  number: number;
}

export interface SearchViewProps {
  /** The text in the title bar search field. Filters are read from it and written back to it. */
  text: string;
  onTextChange(text: string): void;
  /** The personal repos a word such as "in app" can name. */
  repos: RepoRef[];
  selected: SearchSelection | null;
  onOpenItem(item: InboxItem): void;
  /** Closes the search and returns to the section that was open. */
  onClose(): void;
}

/**
 * Search across the signed-in account's personal repos. Plain words are the search. Filter words in the text
 * ("open", "pull requests", "in app", "label bug", "@name") show up as chips and in the controls, and the
 * controls write their choice back into the text, so the two always agree.
 */
export function SearchView({ text, onTextChange, repos, selected, onOpenItem, onClose }: SearchViewProps) {
  const [chips, setChips] = useState<SearchChips>(DEFAULT_CHIPS);
  const [paging, setPaging] = useState({ key: '', page: 1 });
  const [result, setResult] = useState<SearchPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const resolved = useMemo(() => resolveSearch(parseSearchText(text, repos), chips), [text, repos, chips]);
  const filters = activeFilters(resolved);
  // Changing any filter or the words starts again from page one.
  const filterKey = JSON.stringify(resolved);
  const page = paging.key === filterKey ? paging.page : 1;
  const requestKey = JSON.stringify({ ...resolved, page });
  // With no words and no filters there is nothing to search for yet; the examples show instead.
  const hasQuery = resolved.terms !== '' || filters.length > 0;

  useEffect(() => {
    if (!hasQuery) {
      setResult(null);
      setError(null);
      setLoading(false);
      return undefined;
    }
    const request = JSON.parse(requestKey) as SearchRequest;
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      void window.orbit.search
        .query(request)
        .then(
          (value) => {
            if (!cancelled) setResult(value);
          },
          (cause: unknown) => {
            if (cancelled) return;
            setResult(null);
            setError(describeFailure(cause));
          }
        )
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [requestKey, hasQuery, attempt]);

  const setPage = (next: number): void => setPaging({ key: filterKey, page: next });

  // Each control writes its choice to the chips and takes any matching words out of the text, so the text
  // cannot quietly override what was just picked.
  const chooseKind = (kind: SearchKind): void => {
    setChips((current) => ({ ...current, kind }));
    onTextChange(removeSearchFilter(text, { key: 'kind', value: '', label: '' }, repos));
  };
  const chooseState = (state: SearchState): void => {
    setChips((current) => ({ ...current, state }));
    onTextChange(removeSearchFilter(text, { key: 'state', value: '', label: '' }, repos));
  };
  const chooseRepo = (repoFullName: string | null): void => {
    setChips((current) => ({ ...current, repoFullName }));
    onTextChange(removeSearchFilter(text, { key: 'repo', value: '', label: '' }, repos));
  };

  /** Removes one chip: its words leave the text, and a control that held it goes back to its default. */
  const removeFilter = (filter: ActiveFilter): void => {
    onTextChange(removeSearchFilter(text, filter, repos));
    if (filter.key === 'kind') setChips((current) => ({ ...current, kind: 'all' }));
    else if (filter.key === 'state') setChips((current) => ({ ...current, state: 'open' }));
    else if (filter.key === 'repo') setChips((current) => ({ ...current, repoFullName: null }));
  };

  const clearFilters = (): void => {
    onTextChange(parseSearchText(text, repos).terms);
    setChips(DEFAULT_CHIPS);
  };

  const sortedRepos = useMemo(() => [...repos].sort((a, b) => a.name.localeCompare(b.name)), [repos]);

  return (
    <section className="search-view" aria-label="Search results">
      <div className="scope-bar search-controls">
        <div className="scope-field">
          <span>Show</span>
          <SegmentedControl
            className="scope-state"
            aria-label="Show"
            value={resolved.kind}
            onValueChange={(next) => {
              if (next !== null) chooseKind(next as SearchKind);
            }}
          >
            <SegmentedControlIndicator />
            {SEARCH_KINDS.map((option) => (
              <SegmentedControlItem key={option} value={option} className="secondary-action">
                {KIND_LABELS[option]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        <div className="scope-field">
          <span>Status</span>
          <SegmentedControl
            className="scope-state"
            aria-label="Status"
            value={resolved.state}
            onValueChange={(next) => {
              if (next !== null) chooseState(next as SearchState);
            }}
          >
            <SegmentedControlIndicator />
            {SEARCH_STATES.map((option) => (
              <SegmentedControlItem key={option} value={option} className="secondary-action">
                {STATE_LABELS[option]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        <label className="scope-field">
          <span>Repository</span>
          <select
            value={resolved.repoFullName ?? ''}
            onChange={(event) => chooseRepo(event.target.value || null)}
          >
            <option value="">All repositories</option>
            {sortedRepos.map((repo) => (
              <option key={repo.fullName} value={repo.fullName}>
                {repo.fullName}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-action search-close" onClick={onClose}>
          Close search
        </button>
      </div>

      {filters.length > 0 && (
        <ul className="search-chips" aria-label="Active filters">
          {filters.map((filter) => (
            <li key={`${filter.key}:${filter.value}`} className="search-chip">
              <span>{filter.label}</span>
              <button
                type="button"
                className="search-chip-remove"
                aria-label={`Remove ${filter.label}`}
                onClick={() => removeFilter(filter)}
              >
                <Icon name="close" size={11} />
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="secondary-action" onClick={clearFilters}>
              Clear filters
            </button>
          </li>
        </ul>
      )}

      {!hasQuery ? (
        <div className="search-start">
          <p>
            Just type what you are looking for. Words such as <em>open</em>, <em>closed</em>,{' '}
            <em>pull requests</em>, <em>issues</em>, <em>in app</em>, <em>label bug</em> and <em>@name</em>{' '}
            set filters for you.
          </p>
          <p className="search-examples-label">Try one:</p>
          <div className="search-examples">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                className="secondary-action"
                onClick={() => onTextChange(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {loading && !result && <p role="status">Searching…</p>}
          {error && (
            <div role="alert" className="search-error">
              <p>{error}</p>
              <button className="secondary-action" onClick={() => setAttempt((count) => count + 1)}>
                Try again
              </button>
            </div>
          )}
          {result && (
            <p className="search-count" aria-live="polite">
              {result.totalCount.toLocaleString()} {result.totalCount === 1 ? 'match' : 'matches'}
              {result.partial && ' · this list may be incomplete'}
              {resolved.number !== null && ` · #${resolved.number} is listed first, if it exists`}
            </p>
          )}
          {result?.partial && (
            <p role="note">Some matches could not be shown. Narrow the search to see the rest.</p>
          )}
          {result && (
            <ul className="issue-rows" aria-label="Search results">
              {result.items.map((item) => (
                <li key={`${item.repoFullName}#${item.number}`}>
                  <button
                    className={`issue-row ${
                      selected?.repoFullName === item.repoFullName && selected.number === item.number
                        ? 'selected'
                        : ''
                    }`}
                    onClick={() => onOpenItem(item)}
                  >
                    <span className={`issue-state ${item.state}`} aria-hidden="true">
                      <Icon name={item.kind === 'pull' ? 'pull' : 'issue'} size={15} />
                    </span>
                    <span className="issue-copy">
                      <span className="issue-title">
                        {item.title} {item.isDraft && <small>Draft pull request</small>}
                      </span>
                      <span className="issue-meta">
                        {item.repoFullName}#{item.number} · {item.kind === 'pull' ? 'Pull request' : 'Issue'}{' '}
                        · @{item.authorLogin}
                      </span>
                      {item.labels.length > 0 && (
                        <span className="issue-labels">
                          {item.labels.map((label) => (
                            <IssueLabelChip key={label.name} label={label} />
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {result && !loading && !error && result.items.length === 0 && !result.partial && (
            <p className="empty-state">
              {resolved.number !== null && result.items.length === 0
                ? `There is no #${resolved.number} in these repositories`
                : `No matches${resolved.terms ? ` for “${resolved.terms}”` : ''}`}
              .{filters.length > 0 ? ' Try removing a filter.' : ' Try different words.'}
            </p>
          )}
          {result && (
            <nav className="issue-pager" aria-label="Search pages">
              <button disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>Page {page}</span>
              <button disabled={!result.hasNextPage || loading} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
