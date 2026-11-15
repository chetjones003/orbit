import { useEffect, useState } from 'react';
import type {
  IssueCloseReason,
  IssueDetail as IssueDetailData,
  IssueSnapshot,
  IssueSummary
} from '../../../shared/issues';
import type { PullDetail } from '../../../shared/issues';
import { CommentThread } from '../comments/CommentThread';
import { classifyLink } from './classify-link';
import { IssueEditor } from './IssueEditor';
import { IssueFields } from './IssueFields';
import { PullDiffView } from './PullDiff';
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

const STALE_MESSAGE =
  'This issue changed on GitHub since you opened it. Its latest version is loaded; try the change again.';

/**
 * View of one issue: metadata, sanitized body, and the comment thread. Issues can also be edited here;
 * pull requests are read-only in this view.
 */
export function IssueDetailView({
  repoFullName,
  number,
  signedInLogin,
  onOpenIssue,
  variant = 'panel',
  kind = 'issue'
}: IssueDetailViewProps) {
  const [detail, setDetail] = useState<IssueDetailData | null>(null);
  const [pullDetail, setPullDetail] = useState<PullDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const editable = kind === 'issue';

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    const load = kind === 'pull' ? window.orbit.pulls.detail : window.orbit.issues.detail;
    load(repoFullName, number).then(
      (next) => {
        if (!cancelled) {
          setDetail(next);
          if (kind === 'pull')
            setPullDetail({
              ...(next as PullDetail),
              reviews: (next as PullDetail).reviews ?? [],
              reviewsPartial: (next as PullDetail).reviewsPartial ?? false,
              checks: (next as PullDetail).checks ?? [],
              checksPartial: (next as PullDetail).checksPartial ?? false,
              mergeable: (next as PullDetail).mergeable ?? null,
              mergeableState: (next as PullDetail).mergeableState ?? 'unknown',
              merged: (next as PullDetail).merged ?? false
            });
        }
      },
      (cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this issue.');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number, kind, loadVersion]);

  const reload = (): void => setLoadVersion((version) => version + 1);

  const routeLink = (href: string): void => {
    const target = classifyLink(href, signedInLogin);
    if (target.kind === 'in-app') {
      onOpenIssue(target.repoFullName, target.number, target.target);
    } else if (target.kind === 'external') {
      void window.orbit.app.openExternal(target.url);
    }
  };

  const applySnapshot = (issue: IssueSnapshot): void =>
    setDetail((current) =>
      current ? { ...current, summary: issue.summary, body: issue.body, bodyHtml: issue.bodyHtml } : current
    );

  const applySummary = (summary: IssueSummary): void =>
    setDetail((current) => (current ? { ...current, summary } : current));

  const changeState = (state: 'open' | 'closed', reason?: IssueCloseReason): void => {
    setActionError(null);
    const request =
      reason === undefined
        ? window.orbit.issues.setState(repoFullName, number, state)
        : window.orbit.issues.setState(repoFullName, number, state, reason);
    request.then(applySummary, () => setActionError('Could not change the state of this issue. Try again.'));
  };

  /** Ticks one checkbox. The body is checked on GitHub first; a body that changed upstream is reloaded instead. */
  const toggleTask = (index: number, checked: boolean): void => {
    if (!detail) return;
    setActionError(null);
    window.orbit.issues.setTask(repoFullName, number, { index, checked, expectedBody: detail.body }).then(
      (result) => {
        if (result.kind === 'saved') {
          applySnapshot(result.issue);
        } else {
          setActionError(STALE_MESSAGE);
          reload();
        }
      },
      (cause: unknown) =>
        setActionError(cause instanceof Error ? cause.message : 'That checkbox could not be saved.')
    );
  };

  if (error) {
    return (
      <div className="issue-detail" role="alert">
        <p>{error}</p>
      </div>
    );
  }
  const notice = actionError ? (
    <p className="session-notice" role="alert">
      {actionError}
    </p>
  ) : null;
  if (!detail) {
    return (
      <>
        {notice}
        <p className="empty-state" role="status">
          Loading issue…
        </p>
      </>
    );
  }

  const { summary } = detail;
  return (
    <article className={`issue-detail ${variant}`}>
      <p className="eyebrow">
        {kind === 'pull' ? 'Pull request' : 'Issue'} · {repoFullName} · #{summary.number}
      </p>
      <h2>{summary.title}</h2>
      {kind === 'pull' && pullDetail && (
        <section aria-label="Pull request details" className="pull-detail-metadata">
          <p>
            {pullDetail.summary.draft ? 'Draft' : 'Ready for review'} ·{' '}
            <code>{pullDetail.summary.headRef}</code> → <code>{pullDetail.summary.baseRef}</code>
          </p>
          <p>
            Mergeability:{' '}
            {pullDetail.mergeable === null ? 'Checking' : pullDetail.mergeable ? 'Mergeable' : 'Conflicts'} (
            {pullDetail.mergeableState})
          </p>
          <h3>Checks</h3>
          {pullDetail.checksPartial && <p role="note">Some check runs may not be shown.</p>}
          {pullDetail.checks.length ? (
            <ul>
              {pullDetail.checks.map((check, i) => (
                <li key={check.name + i}>
                  {check.name}: {check.conclusion ?? check.status}{' '}
                  {check.detailsUrl && (
                    <a
                      href={check.detailsUrl}
                      onClick={(e) => {
                        e.preventDefault();
                        void window.orbit.app.openExternal(check.detailsUrl!);
                      }}
                    >
                      View run ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No check runs.</p>
          )}
          <h3>Reviews</h3>
          {pullDetail.reviewsPartial && <p role="note">Some reviews may not be shown.</p>}
          {pullDetail.reviews.map((review) => (
            <div key={review.id}>
              <strong>@{review.authorLogin}</strong> · {review.state}
              {review.body && <p>{review.body}</p>}
            </div>
          ))}
        </section>
      )}
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

      {notice}

      {editable && (
        <div className="issue-actions">
          {editing ? (
            <IssueEditor
              repoFullName={repoFullName}
              number={number}
              signedInLogin={signedInLogin}
              snapshot={{ summary, body: detail.body, bodyHtml: detail.bodyHtml }}
              onSaved={(issue) => {
                applySnapshot(issue);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
              onReload={() => {
                setEditing(false);
                reload();
              }}
              onLink={routeLink}
              viewOnGitHubUrl={summary.htmlUrl}
            />
          ) : (
            <button
              className="secondary-action"
              onClick={() => {
                setActionError(null);
                setEditing(true);
              }}
            >
              Edit issue
            </button>
          )}
          <div className="state-actions">
            {summary.state === 'open' ? (
              <>
                <button className="secondary-action" onClick={() => changeState('closed', 'completed')}>
                  Close as completed
                </button>
                <button className="secondary-action" onClick={() => changeState('closed', 'not_planned')}>
                  Close as not planned
                </button>
              </>
            ) : (
              <button className="secondary-action" onClick={() => changeState('open')}>
                Reopen
              </button>
            )}
          </div>
          <IssueFields
            repoFullName={repoFullName}
            number={number}
            summary={summary}
            onChange={applySummary}
            onError={setActionError}
          />
        </div>
      )}

      <RichBody
        html={detail.bodyHtml}
        viewOnGitHubUrl={summary.htmlUrl}
        onLink={routeLink}
        emptyText="No description provided."
        onTaskToggle={editable ? toggleTask : undefined}
      />

      {kind === 'pull' && (
        <PullDiffView
          repoFullName={repoFullName}
          number={number}
          variant={variant}
          onLink={routeLink}
          signedInLogin={signedInLogin}
        />
      )}

      <CommentThread
        repoFullName={repoFullName}
        number={number}
        signedInLogin={signedInLogin}
        commentCount={summary.commentCount}
        initialComments={detail.comments}
        commentsPartial={detail.commentsPartial}
        viewOnGitHubUrl={summary.htmlUrl}
        onLink={routeLink}
        canWrite={editable}
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
