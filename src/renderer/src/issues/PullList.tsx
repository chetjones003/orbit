import { useEffect, useState } from 'react';
import type { PullListPage, PullListQuery, PullStateFilter, PullSummary } from '../../../shared/issues';
import { NewPullForm } from './NewPullForm';
import { publishItemCreated } from '../shell/list-events';
import { Icon } from '../icons';
import { IssueLabelChip } from './IssueLabelChip';
import { hovercardProps } from '../hovercard/hovercard-model';

export function PullList({
  repoFullName,
  selectedNumber,
  onOpenPull,
  startCreating = false,
  onStartHandled
}: {
  repoFullName: string;
  selectedNumber: number | null;
  onOpenPull: (number: number) => void;
  /** Opens the new pull request form, for a command run from outside the list. */
  startCreating?: boolean;
  onStartHandled?: () => void;
}) {
  const [state, setState] = useState<PullStateFilter>('open');
  const [label, setLabel] = useState('');
  const [author, setAuthor] = useState('');
  const [result, setResult] = useState<PullListPage | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  useEffect(() => {
    if (!startCreating) return;
    setCreating(true);
    onStartHandled?.();
  }, [startCreating, onStartHandled]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const query: PullListQuery = {
      repoFullName,
      state,
      page,
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(author.trim() ? { author: author.trim() } : {})
    };
    void window.orbit.pulls
      .list(query)
      .then(
        (value) => {
          if (!cancelled) setResult(value);
        },
        (cause) => {
          if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load pull requests.');
        }
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repoFullName, state, page, label, author, refreshVersion]);
  if (creating) {
    return (
      <NewPullForm
        repoFullName={repoFullName}
        onCancel={() => setCreating(false)}
        onCreated={(number) => {
          setCreating(false);
          setRefreshVersion((version) => version + 1);
          publishItemCreated(repoFullName);
          onOpenPull(number);
        }}
      />
    );
  }
  return (
    <section className="issue-list" aria-label="Pull requests">
      <button className="primary-action" onClick={() => setCreating(true)}>
        New pull request
      </button>
      <form
        className="issue-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
        }}
      >
        <label>
          State
          <select
            value={state}
            onChange={(e) => {
              setState(e.target.value as PullStateFilter);
              setPage(1);
            }}
          >
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
        </label>
        <label>
          Label
          <input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Author
          <input
            value={author}
            onChange={(e) => {
              setAuthor(e.target.value);
              setPage(1);
            }}
          />
        </label>
      </form>
      {loading && <p role="status">Loading pull requests…</p>}
      {error && <p role="alert">{error}</p>}
      {result?.partial && (
        <p role="note">Some pull requests could not be shown; this list may be incomplete.</p>
      )}
      <ul className="issue-rows" aria-label="Pull requests in this repository">
        {result?.items.map((pull: PullSummary) => (
          <li key={pull.id}>
            <button
              {...hovercardProps(repoFullName, pull.number, 'pull')}
              className={`issue-row ${selectedNumber === pull.number ? 'selected' : ''}`}
              onClick={() => onOpenPull(pull.number)}
            >
              <span
                className={`issue-state ${pull.merged ? 'merged' : pull.state}`}
                title={pull.merged ? 'Merged' : pull.state === 'open' ? 'Open' : 'Closed'}
              >
                <Icon name={pull.merged ? 'merge' : pull.state === 'open' ? 'pull' : 'close'} size={15} />
                <span className="sr-only">
                  {pull.merged ? 'Merged' : pull.state === 'open' ? 'Open' : 'Closed'}
                </span>
              </span>
              <span className="issue-copy">
                <span className="issue-title">
                  #{pull.number} {pull.title} {pull.draft && <small>Draft</small>}
                </span>
                <span className="issue-meta">
                  @{pull.authorLogin} · {pull.headRef} → {pull.baseRef}
                </span>
                {pull.labels.length > 0 && (
                  <span className="issue-labels">
                    {pull.labels.map((l) => (
                      <IssueLabelChip key={l.name} label={l} />
                    ))}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!loading && result?.items.length === 0 && (
        <p className="empty-state">No pull requests match these filters.</p>
      )}
      <nav className="issue-pager" aria-label="Pull request pages">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </button>
        <span>Page {page}</span>
        <button disabled={!result?.hasNextPage} onClick={() => setPage((p) => p + 1)}>
          Next
        </button>
      </nav>
    </section>
  );
}
