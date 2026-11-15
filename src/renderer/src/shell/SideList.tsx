import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { PersonalRepo } from '../../../shared/ipc';
import type { IssueStateFilter, IssueSummary } from '../../../shared/issues';
import { Icon } from '../icons';
import { markColor, markLetters } from './repo-mark';
import { RepoMark } from './RepoMark';

/** Rows loaded per repo in the list. The full list of a repo opens from the Repositories section. */
const ROWS_PER_REPO = 25;

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
}

const STATE_LABEL: Record<IssueStateFilter, string> = { open: 'Open', closed: 'Closed', all: 'All' };

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
  onRefreshRepos
}: SideListProps) {
  const [state, setState] = useState<IssueStateFilter>('open');
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
        <select
          aria-label={`${noun} state`}
          value={state}
          onChange={(event) => setState(event.target.value as IssueStateFilter)}
        >
          {(Object.keys(STATE_LABEL) as IssueStateFilter[]).map((value) => (
            <option key={value} value={value}>
              {STATE_LABEL[value]}
            </option>
          ))}
        </select>
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
          <Icon name="repos" size={14} />
        </button>
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    const request: Promise<{ items: Row[] }> =
      kind === 'pull'
        ? window.orbit.pulls.list({ repoFullName: repo.fullName, state, page: 1 })
        : window.orbit.issues.list({ repoFullName: repo.fullName, state, page: 1 });
    void request.then(
      (page) => {
        if (!cancelled) setRows(page.items.slice(0, ROWS_PER_REPO));
      },
      (failure: unknown) => {
        if (!cancelled)
          setError(failure instanceof Error ? failure.message : 'This repository could not be loaded.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [kind, repo.fullName, state, refreshKey]);

  return (
    <section className="side-group" aria-label={repo.fullName}>
      <header className="side-group-head">
        <RepoMark letters={markLetters(repo.name)} color={markColor(repo.fullName)} size={18} />
        <span className="side-group-name">{repo.fullName}</span>
        {rows && <span className="side-group-count">{rows.length}</span>}
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
                    {row.draft === true && <span className="side-row-draft">Draft</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
