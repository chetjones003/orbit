import { useEffect, useState } from 'react';
import type { IssueLinks as IssueLinksData, LinkedPull } from '../../../shared/issues';
import { Icon } from '../icons';
import { hovercardProps } from '../hovercard/hovercard-model';
import { SectionHead } from './SectionHead';

export interface IssueLinksProps {
  repoFullName: string;
  number: number;
  /** Opens a linked pull request in Orbit. */
  onOpenPull: (number: number) => void;
}

/** Reader-facing state of a linked pull request. */
function pullStateLabel(pull: LinkedPull): string {
  if (pull.merged) return 'Merged';
  return pull.state === 'open' ? 'Open' : 'Closed';
}

/**
 * The pull requests and commits linked to an issue, read from its timeline. Each pull request opens in
 * Orbit; each commit opens on GitHub. The section loads on its own, so the issue never waits for it.
 */
export function IssueLinks({ repoFullName, number, onOpenPull }: IssueLinksProps) {
  const [links, setLinks] = useState<IssueLinksData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLinks(null);
    setError(null);
    window.orbit.issues.links(repoFullName, number).then(
      (next) => {
        if (!cancelled) setLinks(next);
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load linked work.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number]);

  return (
    <>
      <SectionHead
        icon="pull"
        title="Pull requests and commits"
        count={links ? links.pulls.length + links.commits.length : null}
      />
      {error && (
        <p className="detail-muted" role="alert">
          {error}
        </p>
      )}
      {!error && !links && (
        <p className="detail-muted" role="status">
          Loading linked work…
        </p>
      )}
      {links && links.pulls.length === 0 && links.commits.length === 0 && (
        <p className="detail-muted">Nothing links to this issue yet.</p>
      )}
      {links && links.pulls.length > 0 && (
        <ul className="linked-list" aria-label="Linked pull requests">
          {links.pulls.map((pull) => (
            <li key={pull.number} className="linked-row">
              <span className={`linked-icon ${pull.state === 'open' && !pull.merged ? 'open' : 'closed'}`}>
                <Icon name="pull" size={14} />
              </span>
              <div className="linked-body">
                <div className="linked-line">
                  <span className={`linked-state ${pull.merged ? 'merged' : pull.state}`}>
                    {pullStateLabel(pull)}
                  </span>
                  <button
                    type="button"
                    className="linked-title"
                    {...hovercardProps(repoFullName, pull.number, 'pull')}
                    onClick={() => onOpenPull(pull.number)}
                  >
                    #{pull.number} {pull.title}
                  </button>
                </div>
                <span className="detail-muted">@{pull.authorLogin}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {links && links.commits.length > 0 && (
        <ul className="linked-list" aria-label="Linked commits">
          {links.commits.map((commit) => (
            <li key={commit.sha} className="linked-row">
              <span className="linked-icon commit">
                <Icon name="commit" size={14} />
              </span>
              <div className="linked-body">
                <div className="linked-line">
                  <code className="linked-sha">{commit.sha.slice(0, 7)}</code>
                  <a
                    className="linked-title"
                    href={commit.htmlUrl}
                    onClick={(event) => {
                      event.preventDefault();
                      void window.orbit.app.openExternal(commit.htmlUrl);
                    }}
                  >
                    {commit.message}
                  </a>
                </div>
                <span className="detail-muted">
                  {commit.authorLogin ? `@${commit.authorLogin}` : commit.authorName} ·{' '}
                  <time dateTime={commit.committedAt}>
                    {new Date(commit.committedAt).toLocaleDateString()}
                  </time>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {links?.partial && (
        <p className="detail-muted">Some links could not be read, so this list may be incomplete.</p>
      )}
    </>
  );
}
