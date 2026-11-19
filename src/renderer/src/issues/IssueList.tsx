import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { IssueListPage, IssueListQuery, IssueStateFilter, IssueSummary } from '../../../shared/issues';
import { Icon } from '../icons';
import { IssueLabelChip } from './IssueLabelChip';
import { hovercardUrlProps } from '../hovercard/hovercard-model';
import { subscribeItemsRefresh } from '../shell/list-events';

export interface IssueListProps {
  repoFullName: string;
  selectedNumber: number | null;
  onOpenIssue: (number: number) => void;
}

interface Filters {
  state: IssueStateFilter;
  label: string;
  author: string;
}

const EMPTY_FILTERS: Filters = { state: 'open', label: '', author: '' };

/** Issues for one repo with state, label, and author filters and paging. Partial pages are flagged. */
export function IssueList({ repoFullName, selectedNumber, onOpenIssue }: IssueListProps) {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<Filters>(EMPTY_FILTERS);
  const [pageNumber, setPageNumber] = useState(1);
  const [result, setResult] = useState<IssueListPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only the latest request may write results, so a slow old page cannot overwrite a newer one.
  const latestRequest = useRef(0);

  const load = useCallback(
    async (filters: Filters, page: number) => {
      const request = ++latestRequest.current;
      setLoading(true);
      setError(null);
      const query: IssueListQuery = {
        repoFullName,
        state: filters.state,
        page,
        ...(filters.label.trim() ? { label: filters.label.trim() } : {}),
        ...(filters.author.trim() ? { author: filters.author.trim() } : {})
      };
      try {
        const next = await window.orbit.issues.list(query);
        if (request === latestRequest.current) setResult(next);
      } catch (cause) {
        if (request === latestRequest.current) {
          setResult(null);
          setError(cause instanceof Error ? cause.message : 'Could not load issues.');
        }
      } finally {
        if (request === latestRequest.current) setLoading(false);
      }
    },
    [repoFullName]
  );

  useEffect(() => {
    setApplied(EMPTY_FILTERS);
    setDraft(EMPTY_FILTERS);
    setPageNumber(1);
    void load(EMPTY_FILTERS, 1);
  }, [repoFullName, load]);

  useEffect(() => subscribeItemsRefresh(() => void load(applied, pageNumber)), [load, applied, pageNumber]);

  const apply = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setApplied(draft);
    setPageNumber(1);
    void load(draft, 1);
  };

  const goToPage = (page: number): void => {
    setPageNumber(page);
    void load(applied, page);
  };

  return (
    <section className="issue-list" aria-label="Issues">
      <form className="issue-filters" onSubmit={apply}>
        <label>
          <span>State</span>
          <select
            aria-label="State"
            value={draft.state}
            onChange={(event) => setDraft({ ...draft, state: event.target.value as IssueStateFilter })}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          <span>Label</span>
          <input
            aria-label="Label"
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </label>
        <label>
          <span>Author</span>
          <input
            aria-label="Author"
            value={draft.author}
            onChange={(event) => setDraft({ ...draft, author: event.target.value })}
          />
        </label>
        <button type="submit" className="secondary-action">
          Apply filters
        </button>
      </form>

      {loading && (
        <p className="empty-state" role="status">
          Loading issues…
        </p>
      )}
      {error && (
        <div className="issue-error" role="alert">
          <p>{error}</p>
          <button className="secondary-action" onClick={() => void load(applied, pageNumber)}>
            Try again
          </button>
        </div>
      )}
      {result?.partial && (
        <p className="session-notice" role="status">
          Some issues could not be shown, so this list may be incomplete.
        </p>
      )}

      <ul className="issue-rows" aria-label="Issues in this repository">
        {result?.items.map((item) => (
          <li key={item.id}>
            <IssueRow
              issue={item}
              selected={selectedNumber === item.number}
              onOpen={() => onOpenIssue(item.number)}
            />
          </li>
        ))}
      </ul>
      {result && !loading && result.items.length === 0 && !result.partial && !error && (
        <p className="empty-state">No issues match these filters.</p>
      )}

      {result && (
        <nav className="issue-pager" aria-label="Issue pages">
          <button
            className="secondary-action"
            disabled={pageNumber <= 1 || loading}
            onClick={() => goToPage(pageNumber - 1)}
            aria-label="Previous page"
          >
            Previous
          </button>
          <span>Page {pageNumber}</span>
          <button
            className="secondary-action"
            disabled={!result.hasNextPage || loading}
            onClick={() => goToPage(pageNumber + 1)}
            aria-label="Next page"
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}

function IssueRow({
  issue,
  selected,
  onOpen
}: {
  issue: IssueSummary;
  selected: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      {...hovercardUrlProps(issue.htmlUrl)}
      className={`issue-row ${selected ? 'selected' : ''}`}
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
    >
      <span className={`issue-state ${issue.state}`} aria-label={issue.state === 'open' ? 'Open' : 'Closed'}>
        <Icon name={issue.state === 'open' ? 'issue' : 'check'} size={15} />
      </span>
      <span className="issue-copy">
        <span className="issue-title">
          #{issue.number} {issue.title}
        </span>
        <span className="issue-meta">
          @{issue.authorLogin} · {issue.commentCount} comments
        </span>
        {issue.labels.length > 0 && (
          <span className="issue-labels">
            {issue.labels.map((label) => (
              <IssueLabelChip key={label.name} label={label} />
            ))}
          </span>
        )}
      </span>
    </button>
  );
}
