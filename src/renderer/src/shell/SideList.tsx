import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { PersonalRepo } from '../../../shared/ipc';
import type { IssueStateFilter, IssueSummary } from '../../../shared/issues';
import { Icon } from '../icons';
import { markColor, markLetters } from './repo-mark';
import { RepoMark } from './RepoMark';
import { subscribeItemChanges, subscribeItemCreated } from './list-events';

/**
 * How long a single click waits for a second one. A double click then opens full screen, and does not open a side
 * panel first. Keep it near Windows' double-click time, so a deliberate double click lands inside it.
 */
const DOUBLE_CLICK_WAIT_MS = 350;

export interface ItemRef {
  repoFullName: string;
  number: number;
  kind: 'issue' | 'pull';
}

export interface SideListProps {
  kind: 'issue' | 'pull';
  repos: PersonalRepo[];
  selected: ItemRef | null;
  /** A single click: opens the item with the default behaviour (see settings). */
  onOpen(item: ItemRef): void;
  /** A double click: opens the item full screen. */
  onOpenFull(item: ItemRef): void;
  /** Opens the menu for an item, at the pointer. */
  onContextMenu(item: ItemRef, x: number, y: number): void;
  /** Asks GitHub for the latest repositories. */
  onRefreshRepos(): void;
  /** Opens the search dialog (also Ctrl+K). */
  onSearch?(): void;
  /** The state filter chosen in the scope bar. The side list and the scope bar always agree. */
  state: IssueStateFilter;
}

/**
 * The left panel's list: the issues or pull requests of every tracked repository, grouped by repository. Each
 * group loads on its own, so one slow repo does not hold up the rest.
 */
export function SideList({
  kind,
  repos,
  selected,
  onOpen,
  onOpenFull,
  onContextMenu,
  onRefreshRepos,
  onSearch,
  state
}: SideListProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const pendingPick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noun = kind === 'pull' ? 'Pull requests' : 'Issues';

  const cancelPick = (): void => {
    if (pendingPick.current !== null) clearTimeout(pendingPick.current);
    pendingPick.current = null;
  };
  useEffect(() => cancelPick, []);

  // A single click waits; a second click or a double click cancels the wait. A double click opens full screen.
  const pick = (item: ItemRef): void => {
    cancelPick();
    pendingPick.current = setTimeout(() => {
      pendingPick.current = null;
      onOpen(item);
    }, DOUBLE_CLICK_WAIT_MS);
  };
  const openFull = (item: ItemRef): void => {
    cancelPick();
    onOpenFull(item);
  };

  return (
    <section className="side-list-body" aria-label={noun}>
      <header className="side-list-head">
        <h2>{noun}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={`Refresh ${noun.toLowerCase()}`}
          title="Refresh"
          onClick={() => setRefreshKey((key) => key + 1)}
        >
          <Icon name="refresh" size={14} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Refresh repositories"
          title="Refresh repositories"
          onClick={onRefreshRepos}
        >
          <Icon name="refresh" size={14} />
        </button>
        {onSearch && (
          <button
            type="button"
            className="icon-button"
            aria-label="Search (Ctrl+K)"
            title="Search (Ctrl+K)"
            onClick={onSearch}
          >
            <Icon name="search" size={14} />
          </button>
        )}
      </header>
      {repos.length === 0 && (
        <p className="side-list-empty">Track repositories in Repositories to see them here.</p>
      )}
      <div className="side-list-groups">
        {repos.map((repo) => (
          <RepoGroup
            key={repo.fullName}
            kind={kind}
            repo={repo}
            state={state}
            refreshKey={refreshKey}
            selected={selected}
            onPick={pick}
            onOpenFull={openFull}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </section>
  );
}

interface RepoGroupProps {
  kind: 'issue' | 'pull';
  repo: PersonalRepo;
  state: IssueStateFilter;
  refreshKey: number;
  selected: ItemRef | null;
  onPick(item: ItemRef): void;
  onOpenFull(item: ItemRef): void;
  onContextMenu(item: ItemRef, x: number, y: number): void;
}

type Row = IssueSummary & { draft?: boolean };

interface ListPage {
  items: Row[];
  hasNextPage: boolean;
  partial: boolean;
}

/** One page of a repository's issues or pull requests. */
function listPage(
  kind: 'issue' | 'pull',
  repoFullName: string,
  state: IssueStateFilter,
  page: number
): Promise<ListPage> {
  return kind === 'pull'
    ? window.orbit.pulls.list({ repoFullName, state, page })
    : window.orbit.issues.list({ repoFullName, state, page });
}

/**
 * One repository's rows. The first page loads at once; Load more fetches the next page, so a repository with
 * hundreds of items can be read all the way through.
 */
function RepoGroup({
  kind,
  repo,
  state,
  refreshKey,
  selected,
  onPick,
  onOpenFull,
  onContextMenu
}: RepoGroupProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [partial, setPartial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped when an item is created here, so this repository reads its first page again.
  const [createdCount, setCreatedCount] = useState(0);

  // Edits made elsewhere patch the row in place. A row the state filter no longer matches leaves the list.
  useEffect(() => {
    const stopChanges = subscribeItemChanges((change) => {
      if (change.repoFullName !== repo.fullName) return;
      setRows((current) => {
        if (!current) return current;
        const index = current.findIndex((row) => row.number === change.number);
        if (index === -1) return current;
        const patched: Row = { ...current[index], ...change.summary };
        if (state !== 'all' && patched.state !== state)
          return current.filter((_, position) => position !== index);
        return current.map((row, position) => (position === index ? patched : row));
      });
    });
    const stopCreated = subscribeItemCreated((name) => {
      if (name === repo.fullName) setCreatedCount((count) => count + 1);
    });
    return () => {
      stopChanges();
      stopCreated();
    };
  }, [repo.fullName, state]);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setPage(1);
    setError(null);
    void listPage(kind, repo.fullName, state, 1).then(
      (result) => {
        if (cancelled) return;
        setRows(result.items);
        setHasNext(result.hasNextPage);
        setPartial(result.partial);
      },
      (failure: unknown) => {
        if (!cancelled)
          setError(failure instanceof Error ? failure.message : 'This repository could not be loaded.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [kind, repo.fullName, state, refreshKey, createdCount]);

  const loadMore = (): void => {
    const next = page + 1;
    setLoadingMore(true);
    void listPage(kind, repo.fullName, state, next)
      .then(
        (result) => {
          setRows((current) => [...(current ?? []), ...result.items]);
          setPage(next);
          setHasNext(result.hasNextPage);
          setPartial(result.partial);
        },
        (failure: unknown) => {
          setError(failure instanceof Error ? failure.message : 'More items could not be loaded.');
        }
      )
      .finally(() => setLoadingMore(false));
  };

  return (
    <section className="side-group" aria-label={repo.fullName}>
      <header className="side-group-head">
        <RepoMark letters={markLetters(repo.name)} color={markColor(repo.fullName)} size={18} />
        <span className="side-group-name">{repo.fullName}</span>
        {rows && (
          <span className="side-group-count">
            {rows.length}
            {hasNext ? '+' : ''}
          </span>
        )}
      </header>
      {error && (
        <p className="issue-error" role="alert">
          {error}
        </p>
      )}
      {rows === null && !error && <p className="side-group-loading">Loading…</p>}
      {rows && rows.length === 0 && <p className="side-group-empty">Nothing here.</p>}
      {rows && rows.length > 0 && (
        <ul className="side-rows">
          {rows.map((row) => {
            const item: ItemRef = { repoFullName: repo.fullName, number: row.number, kind };
            const isSelected =
              selected?.repoFullName === item.repoFullName &&
              selected.number === item.number &&
              selected.kind === item.kind;
            return (
              <li key={row.number}>
                <button
                  type="button"
                  className={`side-row ${isSelected ? 'selected' : ''}`}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onPick(item)}
                  onDoubleClick={() => onOpenFull(item)}
                  onContextMenu={(event: MouseEvent<HTMLButtonElement>) => {
                    event.preventDefault();
                    onContextMenu(item, event.clientX, event.clientY);
                  }}
                >
                  <span className="side-row-title">{row.title}</span>
                  <span className="side-row-meta">
                    <span className="side-row-ref">#{row.number}</span>
                    <span className="side-row-stat" title="Comments">
                      <Icon name="comment" size={12} />
                      {row.commentCount}
                    </span>
                    {row.subIssues && row.subIssues.total > 0 && (
                      <span
                        className={`side-row-stat side-row-subs ${row.subIssues.completed === row.subIssues.total ? 'complete' : ''}`}
                        title="Sub-issues done"
                      >
                        <Icon name="check" size={12} />
                        {row.subIssues.completed}/{row.subIssues.total}
                      </span>
                    )}
                    {row.draft === true && <span className="side-row-draft">Draft</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows && hasNext && (
        <button
          type="button"
          className="side-load-more"
          disabled={loadingMore}
          aria-label={`Load more from ${repo.fullName}`}
          onClick={loadMore}
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
      {partial && <p className="side-group-partial">Some items could not be loaded.</p>}
    </section>
  );
}
