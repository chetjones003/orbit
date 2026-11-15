import { useEffect, useState } from 'react';
import type { IssueDetail as IssueDetailData } from '../../../shared/issues';
import { CommentThread } from '../comments/CommentThread';
import { classifyLink } from './classify-link';
import { RichBody } from './RichBody';

export interface IssueDetailViewProps {
  repoFullName: string;
  number: number;
  signedInLogin: string;
  /** Opens another issue or pull request in the same Orbit view. */
  onOpenIssue: (repoFullName: string, number: number, kind: ItemKind) => void;
  /** Compact panel or expanded main view. */
  variant?: 'panel' | 'expanded';
  /** Which GitHub item this is. Defaults to an issue. */
  kind?: ItemKind;
}

export type ItemKind = 'issue' | 'pull';

/** View of one issue: metadata, sanitized body, and the comment thread. */
export function IssueDetailView({
  repoFullName,
  number,
  signedInLogin,
  onOpenIssue,
  variant = 'panel',
  kind = 'issue'
}: IssueDetailViewProps) {
  const [detail, setDetail] = useState<IssueDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    const load = kind === 'pull' ? window.orbit.pulls.detail : window.orbit.issues.detail;
    load(repoFullName, number).then(
      (next) => {
        if (!cancelled) setDetail(next);
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this issue.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number, kind]);

  const routeLink = (href: string): void => {
    const target = classifyLink(href, signedInLogin);
    if (target.kind === 'in-app') {
      onOpenIssue(target.repoFullName, target.number, target.target);
    } else if (target.kind === 'external') {
      void window.orbit.app.openExternal(target.url);
    }
  };

  if (error) {
    return (
      <div className="issue-detail" role="alert">
        <p>{error}</p>
      </div>
    );
  }
  if (!detail) {
    return (
      <p className="empty-state" role="status">
        Loading issue…
      </p>
    );
  }

  const { summary } = detail;
  return (
    <article className={`issue-detail ${variant}`}>
      <p className="eyebrow">
        {kind === 'pull' ? 'Pull request' : 'Issue'} · {repoFullName} · #{summary.number}
      </p>
      <h2>{summary.title}</h2>
      <p className="issue-meta">
        <span className={`issue-state-pill ${summary.state}`}>
          {summary.state === 'open' ? 'Open' : 'Closed'}
        </span>{' '}
        @{summary.authorLogin} opened {new Date(summary.createdAt).toLocaleDateString()} · Updated{' '}
        {new Date(summary.updatedAt).toLocaleDateString()}
      </p>
      {summary.labels.length > 0 && (
        <p className="issue-labels">
          {summary.labels.map((label) => (
            <span className="issue-label" key={label.name} style={{ borderColor: `#${label.color}` }}>
              {label.name}
            </span>
          ))}
        </p>
      )}
      <RichBody
        html={detail.bodyHtml}
        viewOnGitHubUrl={summary.htmlUrl}
        onLink={routeLink}
        emptyText="No description provided."
      />

      <CommentThread
        repoFullName={repoFullName}
        number={number}
        signedInLogin={signedInLogin}
        commentCount={summary.commentCount}
        initialComments={detail.comments}
        commentsPartial={detail.commentsPartial}
        viewOnGitHubUrl={summary.htmlUrl}
        onLink={routeLink}
        canWrite={kind === 'issue'}
      />

      <a
        className="github-link"
        href={summary.htmlUrl}
        onClick={(event) => {
          event.preventDefault();
          void window.orbit.app.openExternal(summary.htmlUrl);
        }}
      >
        View on GitHub ↗
      </a>
    </article>
  );
}
