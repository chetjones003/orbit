import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { IssueComment, IssueDetail as IssueDetailData } from '../../../shared/issues';
import { classifyLink } from './classify-link';
import { sanitizeIssueHtml } from './sanitize-issue-html';

export interface IssueDetailViewProps {
  repoFullName: string;
  number: number;
  signedInLogin: string;
  /** Opens another issue in the same Orbit view. */
  onOpenIssue: (repoFullName: string, number: number) => void;
  /** Compact panel or expanded main view. */
  variant?: 'panel' | 'expanded';
}

/** Bodies longer than this (in text characters) start collapsed behind Show full. */
const COLLAPSE_AFTER_CHARS = 800;

/** Read-only view of one issue: metadata, sanitized body, and timeline comments. */
export function IssueDetailView({
  repoFullName,
  number,
  signedInLogin,
  onOpenIssue,
  variant = 'panel'
}: IssueDetailViewProps) {
  const [detail, setDetail] = useState<IssueDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    setNotice(null);
    window.orbit.issues.detail(repoFullName, number).then(
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
  }, [repoFullName, number]);

  const routeLink = (href: string): void => {
    const target = classifyLink(href, signedInLogin);
    if (target.kind === 'in-app') {
      if (target.target === 'pull') {
        setNotice('Pull requests are not in Orbit yet. Open them on GitHub for now.');
        return;
      }
      onOpenIssue(target.repoFullName, target.number);
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
        {repoFullName} · #{summary.number}
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
      {notice && (
        <p className="session-notice" role="status">
          {notice}
        </p>
      )}

      <RichBody
        html={detail.bodyHtml}
        viewOnGitHubUrl={summary.htmlUrl}
        onLink={routeLink}
        emptyText="No description provided."
      />

      <section aria-label="Comments" className="issue-comments">
        <h3>{summary.commentCount === 1 ? '1 comment' : `${summary.commentCount} comments`}</h3>
        {detail.commentsPartial && (
          <p className="session-notice" role="status">
            Only the first 100 comments are shown. Open the issue on GitHub to read the rest.
          </p>
        )}
        {detail.comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            viewOnGitHubUrl={summary.htmlUrl}
            onLink={routeLink}
          />
        ))}
      </section>

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

function CommentItem({
  comment,
  viewOnGitHubUrl,
  onLink
}: {
  comment: IssueComment;
  viewOnGitHubUrl: string;
  onLink: (href: string) => void;
}) {
  return (
    <div className="issue-comment">
      <p className="issue-meta">
        @{comment.authorLogin} · {new Date(comment.createdAt).toLocaleString()}
      </p>
      <RichBody
        html={comment.bodyHtml}
        viewOnGitHubUrl={comment.htmlUrl || viewOnGitHubUrl}
        onLink={onLink}
        emptyText=""
      />
    </div>
  );
}

/**
 * Sanitized GitHub HTML. Links are routed through `onLink`; long bodies collapse behind Show full.
 * This is the only place GitHub HTML is inserted into the DOM.
 */
export function RichBody({
  html,
  viewOnGitHubUrl,
  onLink,
  emptyText
}: {
  html: string;
  viewOnGitHubUrl: string;
  onLink: (href: string) => void;
  emptyText: string;
}) {
  const clean = useMemo(() => sanitizeIssueHtml(html, { viewOnGitHubUrl }), [html, viewOnGitHubUrl]);
  const textLength = useMemo(() => textOf(clean).length, [clean]);
  const collapsible = textLength > COLLAPSE_AFTER_CHARS;
  const [expanded, setExpanded] = useState(false);

  if (clean.trim() === '') {
    return emptyText ? <p className="empty-state">{emptyText}</p> : null;
  }

  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const anchor = (event.target as Element).closest('a');
    if (!anchor) return;
    event.preventDefault();
    const href = anchor.getAttribute('href');
    if (!href) return;
    // Notice links (View on GitHub for diagrams and math) always leave for GitHub.
    if (anchor.getAttribute('data-external') === 'true') void window.orbit.app.openExternal(href);
    else onLink(href);
  };

  return (
    <div className="issue-body-wrap">
      <div
        className={`issue-body ${collapsible && !expanded ? 'collapsed' : ''}`}
        onClick={onClick}
        // Sanitized by sanitizeIssueHtml: scripts, handlers, and unsafe URLs are removed.
        dangerouslySetInnerHTML={{ __html: clean }}
      />
      {collapsible && !expanded && (
        <button className="secondary-action" onClick={() => setExpanded(true)}>
          Show full
        </button>
      )}
    </div>
  );
}

function textOf(html: string): string {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';
}
