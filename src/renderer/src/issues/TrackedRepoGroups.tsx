import { useEffect, useState } from 'react';
import type { PersonalRepo } from '../../../shared/ipc';
import type { IssueStateFilter, IssueSummary } from '../../../shared/issues';
import { Icon } from '../icons';
import { IssueLabelChip } from './IssueLabelChip';
import { hovercardProps } from '../hovercard/hovercard-model';

/** Rows shown per repo. The repo itself opens the full, paged list. */
const ROWS_PER_GROUP = 10;

export type GroupKind = 'issue' | 'pull';

export interface GroupSelection {
  repoFullName: string;
  number: number;
  kind: GroupKind;
}

export interface TrackedRepoGroupsProps {
  kind: GroupKind;
  repos: PersonalRepo[];
  state: IssueStateFilter;
  selected: GroupSelection | null;
  onOpen(repoFullName: string, number: number, kind: GroupKind): void;
  /** Opens one repo's full list, with its own filters and paging. */
  onScope(repo: PersonalRepo): void;
}

type Row = IssueSummary & { draft?: boolean };

/**
 * Issues or pull requests grouped by the repositories the user tracks. Each group loads its first page on
 * its own, so one slow or failing repo does not hide the others.
 */
export function TrackedRepoGroups({ kind, repos, state, selected, onOpen, onScope }: TrackedRepoGroupsProps) {
  return (
    <div
      className="tracked-groups"
      aria-label={kind === 'pull' ? 'Pull requests by repository' : 'Issues by repository'}
    >
      {repos.map((repo) => (
        <RepoGroup
          key={repo.fullName}
          kind={kind}
          repo={repo}
          state={state}
          selected={selected}
          onOpen={onOpen}
          onScope={onScope}
        />
      ))}
    </div>
  );
}

interface RepoGroupProps extends Omit<TrackedRepoGroupsProps, 'repos'> {
  repo: PersonalRepo;
}

function RepoGroup({ kind, repo, state, selected, onOpen, onScope }: RepoGroupProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setError(null);
    const request: Promise<{ items: Row[]; hasNextPage: boolean; partial: boolean }> =
      kind === 'pull'
        ? window.orbit.pulls.list({ repoFullName: repo.fullName, state, page: 1 })
        : window.orbit.issues.list({ repoFullName: repo.fullName, state, page: 1 });
    void request.then(
      (page) => {
        if (cancelled) return;
        setRows(page.items.slice(0, ROWS_PER_GROUP));
        setHasMore(page.items.length > ROWS_PER_GROUP || page.hasNextPage);
        setPartial(page.partial);
      },
      (failure: unknown) => {
        if (cancelled) return;
        setError(failure instanceof Error ? failure.message : 'This repository could not be loaded.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [kind, repo.fullName, state]);

  const noun = kind === 'pull' ? 'pull requests' : 'issues';

  return (
    <section className="tracked-group" aria-label={repo.fullName}>
      <header className="tracked-group-head">
        <button type="button" className="tracked-group-name" onClick={() => onScope(repo)}>
          {repo.fullName}
        </button>
        {repo.isPrivate && <Icon name="lock" size={12} />}
        <span className="tracked-group-count">
          {rows === null && !error
            ? 'Loading…'
            : rows
              ? `${rows.length}${hasMore ? '+' : ''} ${state === 'all' ? '' : `${state} `}${noun}`
              : ''}
        </span>
      </header>
      {error && (
        <p className="issue-error" role="alert">
          {error}
        </p>
      )}
      {rows && rows.length === 0 && (
        <p className="tracked-group-empty">
          No {state === 'all' ? '' : `${state} `}
          {noun} in this repository.
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="issue-rows" aria-label={`${repo.fullName} ${noun}`}>
          {rows.map((row) => {
            const isSelected =
              selected?.repoFullName === repo.fullName &&
              selected.number === row.number &&
              selected.kind === kind;
            return (
              <li key={row.number}>
                <button
                  type="button"
                  {...hovercardProps(repo.fullName, row.number, kind)}
                  className={`issue-row ${isSelected ? 'selected' : ''}`}
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onOpen(repo.fullName, row.number, kind)}
                >
                  <span className={`issue-state ${row.state}`} aria-hidden="true">
                    <Icon name={kind === 'pull' ? 'pull' : 'issue'} size={15} />
                  </span>
                  <span className="issue-copy">
                    <span className="issue-title">
                      #{row.number} {row.title} {row.draft === true && <small>Draft</small>}
                    </span>
                    <span className="issue-meta">
                      @{row.authorLogin} · {row.commentCount} comments
                    </span>
                    {row.labels.length > 0 && (
                      <span className="issue-labels">
                        {row.labels.map((label) => (
                          <IssueLabelChip key={label.name} label={label} />
                        ))}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {rows && hasMore && (
        <p className="tracked-group-more">
          Showing {ROWS_PER_GROUP}.{' '}
          <button type="button" className="link-button" onClick={() => onScope(repo)}>
            Open {repo.name} to see every {noun}
          </button>
        </p>
      )}
      {rows && partial && <p className="tracked-group-more">Some items could not be shown.</p>}
    </section>
  );
}
