import { useEffect, useRef, useState } from 'react';
import {
  INBOX_TABS,
  INBOX_TAB_LABELS,
  type InboxItem,
  type InboxPage,
  type InboxTab
} from '../../../shared/inbox';
import type { ConnectionStatus } from '../../../shared/connection';

/** A plain message for a failed tab. The main process's detail is for diagnostics, not for the owner. */
function describeFailure(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : '';
  if (/rate limit/i.test(detail))
    return 'GitHub rate limit reached. This tab loads again after the limit resets.';
  return 'Could not load this inbox tab.';
}

export interface InboxSelection {
  repoFullName: string;
  number: number;
}

/**
 * The cross-repo inbox. The visible tab refetches each time a refresh completes, so it
 * inherits the refresh engine's cadence, backoff, and rate-limit handling.
 */
export function Inbox({
  selected,
  onOpenItem
}: {
  selected: InboxSelection | null;
  onOpenItem: (item: InboxItem) => void;
}) {
  const [tab, setTab] = useState<InboxTab>('my-open-prs');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<InboxPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const lastSuccessAt = useRef<number | null>(null);

  useEffect(() => {
    return window.orbit.refresh.onStatusChanged((status: ConnectionStatus) => {
      // Only a completed refresh moves lastSuccessAt, so failures and waits do not refetch.
      if (status.lastSuccessAt === null || status.lastSuccessAt === lastSuccessAt.current) return;
      lastSuccessAt.current = status.lastSuccessAt;
      setRefreshVersion((version) => version + 1);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.orbit.inbox
      .list({ tab, page })
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
    return () => {
      cancelled = true;
    };
  }, [tab, page, attempt, refreshVersion]);

  const selectTab = (next: InboxTab): void => {
    setResult(null);
    setTab(next);
    setPage(1);
  };

  return (
    <section className="issue-list" aria-label="Inbox">
      <div className="repo-view-switch" role="tablist" aria-label="Inbox tabs">
        {INBOX_TABS.map((candidate) => (
          <button
            key={candidate}
            role="tab"
            className="secondary-action"
            aria-selected={tab === candidate}
            onClick={() => selectTab(candidate)}
          >
            {INBOX_TAB_LABELS[candidate]}
          </button>
        ))}
      </div>
      {loading && !result && <p role="status">Loading…</p>}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button className="secondary-action" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </button>
        </div>
      )}
      {result?.partial && <p role="note">Some items could not be shown; this list may be incomplete.</p>}
      {result && (
        <ul className="issue-rows" aria-label="Inbox items">
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
                <span className={`issue-state ${item.state}`}>{item.state === 'open' ? '●' : '✓'}</span>
                <span className="issue-copy">
                  <span className="issue-title">
                    {item.title} {item.isDraft && <small>Draft</small>}
                  </span>
                  <span className="issue-meta">
                    {item.repoFullName}#{item.number} · {item.kind === 'pull' ? 'Pull request' : 'Issue'} · @
                    {item.authorLogin}
                  </span>
                  {item.labels.length > 0 && (
                    <span className="issue-labels">
                      {item.labels.map((label) => (
                        <span className="issue-label" key={label.name}>
                          {label.name}
                        </span>
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
        <p className="empty-state">Nothing needs your attention in this tab.</p>
      )}
      <nav className="issue-pager" aria-label="Inbox pages">
        <button disabled={page <= 1 || loading} onClick={() => setPage((current) => current - 1)}>
          Previous
        </button>
        <span>Page {page}</span>
        <button disabled={!result?.hasNextPage || loading} onClick={() => setPage((current) => current + 1)}>
          Next
        </button>
      </nav>
    </section>
  );
}
