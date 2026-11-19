import { Icon } from '../icons';
import { lazy, Suspense, useEffect, useState } from 'react';
import type {
  IssueCloseReason,
  IssueDetail as IssueDetailData,
  SubIssueRef,
  IssueSnapshot,
  IssueSummary
} from '../../../shared/issues';
import type { PullDetail } from '../../../shared/issues';
import { CommentThread } from '../comments/CommentThread';
import { classifyLink } from './classify-link';
import { IssueEditor } from './IssueEditor';
import { IssueFields } from './IssueFields';
import { ItemProjects } from '../projects/ItemProjects';
import { PullActionsPanel } from './PullActions';
import { PullCi } from './PullCi';
import { prefetchConflicts } from '../conflicts/conflict-cache';

// The resolver and its editor are only needed once someone resolves conflicts, so they load on demand.
const ConflictResolver = lazy(() =>
  import('../conflicts/ConflictResolver').then((module) => ({ default: module.ConflictResolver }))
);
import { PullDiffView } from './PullDiff';
import { RichBody } from './RichBody';
import { IssueLabelChip } from './IssueLabelChip';
import { IssueLinks } from './IssueLinks';
import { publishItemChange, subscribeItemChanges, subscribeItemsRefresh } from '../shell/list-events';
import { hovercardUrlProps } from '../hovercard/hovercard-model';
import { SectionHead } from './SectionHead';

/** Reader-facing names for a review's state. */
function reviewStateLabel(state: string): string {
  switch (state) {
    case 'APPROVED':
      return 'Approved';
    case 'CHANGES_REQUESTED':
      return 'Changes requested';
    case 'COMMENTED':
      return 'Commented';
    case 'DISMISSED':
      return 'Dismissed';
    case 'PENDING':
      return 'Pending';
    default:
      return state;
  }
}

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
  onActionNotice?: (message: string, failed?: boolean) => void;
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
  kind = 'issue',
  onActionNotice
}: IssueDetailViewProps) {
  const [detail, setDetail] = useState<IssueDetailData | null>(null);
  // Sub-issues can run to dozens, so the list opens on request and the header always shows the progress.
  const [subIssuesOpen, setSubIssuesOpen] = useState(false);
  const [pullDetail, setPullDetail] = useState<PullDetail | null>(null);
  // Every edit updates the detail's summary, so the side list's row follows it: title, state, and comment count.
  useEffect(() => {
    if (detail) publishItemChange({ repoFullName, number, summary: detail.summary });
  }, [detail, repoFullName, number]);
  useEffect(
    () => subscribeItemsRefresh(() => setLoadVersion((version) => version + 1)),
    [repoFullName, number]
  );
  // A child issue opened in another panel can close while its parent remains open. Keep the parent's child rows current.
  useEffect(
    () =>
      subscribeItemChanges((change) => {
        if (change.repoFullName !== repoFullName || change.number === number) return;
        setDetail((current) => {
          if (!current?.subIssues?.some((child) => child.number === change.number)) return current;
          return {
            ...current,
            subIssues: current.subIssues.map((child) =>
              child.number === change.number
                ? { ...child, title: change.summary.title, state: change.summary.state }
                : child
            )
          };
        });
      }),
    [repoFullName, number]
  );
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);
  const editable = kind === 'issue';

  // A different item starts empty. A reload keeps what is shown, so an action's status is not lost.
  useEffect(() => {
    setDetail(null);
    setPullDetail(null);
    setError(null);
    setResolving(false);
  }, [repoFullName, number, kind]);

  useEffect(() => {
    let cancelled = false;
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
          // A conflicted open pull request is likely to be resolved, so its conflicts and editor load now.
          if ((next as PullDetail).mergeable === false && (next as PullDetail).summary.state === 'open') {
            prefetchConflicts(repoFullName, number);
            void import('../conflicts/ConflictResolver');
          }
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
    request.then(
      (summary) => {
        applySummary(summary);
        onActionNotice?.(`Issue #${number} ${state === 'closed' ? 'closed' : 'reopened'}.`);
      },
      () => {
        const message = 'Could not change the state of this issue. Try again.';
        setActionError(message);
        onActionNotice?.(message, true);
      }
    );
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

  if (kind === 'pull' && resolving) {
    return (
      <article className={`issue-detail ${variant}`}>
        <Suspense
          fallback={
            <p className="empty-state loading-line" role="status">
              <span className="ci-spinner" aria-hidden="true" />
              Loading conflicts…
            </p>
          }
        >
          <ConflictResolver
            repoFullName={repoFullName}
            number={number}
            onClose={() => setResolving(false)}
            onResolved={reload}
          />
        </Suspense>
      </article>
    );
  }

  const { summary } = detail;
  return (
    <article className={`issue-detail ${variant}`}>
      <section className="detail-card detail-head" aria-label="Summary">
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
          <div className="issue-labels">
            {summary.labels.map((label) => (
              <IssueLabelChip key={label.name} label={label} />
            ))}
          </div>
        )}
      </section>

      {notice}

      {editable && (
        <div className="detail-actions" role="toolbar" aria-label="Issue actions">
          {!editing && (
            <button
              className="primary-action"
              onClick={() => {
                setActionError(null);
                setEditing(true);
              }}
            >
              Edit issue
            </button>
          )}
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
      )}

      {kind === 'pull' && pullDetail && (
        <section aria-label="Pull request details" className="detail-card pr-summary">
          <SectionHead icon="pull" title="Status" />
          <div className="pr-status-row">
            <span className={`pr-pill ${pullDetail.summary.draft ? 'draft' : 'ready'}`}>
              {pullDetail.summary.draft ? 'Draft' : 'Ready for review'}
            </span>
            <span
              className={`pr-pill ${pullDetail.mergeable === null ? 'checking' : pullDetail.mergeable ? 'ok' : 'bad'}`}
            >
              {pullDetail.mergeable === null
                ? 'Checking mergeability'
                : pullDetail.mergeable
                  ? `Mergeable · ${pullDetail.mergeableState}`
                  : `Has conflicts with ${pullDetail.summary.baseRef}`}
            </span>
          </div>
          <div className="pr-branches">
            <code>{pullDetail.summary.headRef}</code>
            <Icon name="chevronRight" size={14} />
            <code>{pullDetail.summary.baseRef}</code>
          </div>
          {pullDetail.mergeable === false && pullDetail.summary.state === 'open' && (
            <div className="pr-conflicts">
              <p className="detail-muted">
                Both branches changed the same lines. GitHub cannot merge this until they are resolved, and
                checks may not run on this commit.
              </p>
              <button type="button" className="primary-action" onClick={() => setResolving(true)}>
                Resolve conflicts
              </button>
            </div>
          )}
        </section>
      )}
      {kind === 'pull' && pullDetail && (
        <section aria-label="Reviews" className="detail-card">
          <SectionHead icon="check" title="Reviews" count={pullDetail.reviews.length} />
          {pullDetail.reviewsPartial && <p className="detail-muted">Some reviews may not be shown.</p>}
          {pullDetail.reviews.length === 0 ? (
            <p className="detail-muted">No reviews yet.</p>
          ) : (
            <ul className="review-list">
              {pullDetail.reviews.map((review) => (
                <li key={review.id} className="review-item">
                  <span className={`review-state ${review.state.toLowerCase()}`}>
                    {reviewStateLabel(review.state)}
                  </span>
                  <strong>@{review.authorLogin}</strong>
                  {review.body && <p>{review.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {kind === 'pull' && <PullActionsPanel repoFullName={repoFullName} number={number} onChanged={reload} />}
      {kind === 'pull' && (
        <section className="detail-card" aria-label="Continuous integration">
          <PullCi repoFullName={repoFullName} number={number} />
        </section>
      )}

      {editable && editing && (
        <section className="detail-card" aria-label="Edit issue">
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
        </section>
      )}

      <div className="detail-trio">
        {editable && (
          <section className="detail-card" aria-label="Assignees, labels, and milestone">
            <h3 className="detail-card-title">{editing ? 'Edit details' : 'Details'}</h3>
            {editing ? (
              <IssueFields
                repoFullName={repoFullName}
                number={number}
                summary={summary}
                onChange={applySummary}
                onError={setActionError}
              />
            ) : (
              <dl className="detail-facts">
                <div>
                  <dt>Assignees</dt>
                  <dd>
                    {summary.assignees.length
                      ? summary.assignees.map((login) => (
                          <span key={login} className="person-chip">
                            @{login}
                          </span>
                        ))
                      : 'No one assigned'}
                  </dd>
                </div>
                <div>
                  <dt>Milestone</dt>
                  <dd>{summary.milestone ? summary.milestone.title : 'No milestone'}</dd>
                </div>
                {detail.parent && (
                  <div>
                    <dt>Parent</dt>
                    <dd>
                      <SubIssueLink
                        issue={detail.parent}
                        onOpen={(number) => onOpenIssue(repoFullName, number, 'issue')}
                      />
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </section>
        )}

        {kind === 'issue' && detail.subIssues && detail.subIssues.length > 0 && (
          <section className="detail-card" aria-label="Sub-issues">
            <h3 className="sub-issues-head">
              <button
                type="button"
                className="sub-issues-toggle"
                aria-expanded={subIssuesOpen}
                onClick={() => setSubIssuesOpen((open) => !open)}
              >
                <span className="sub-issues-name">Sub-issues</span>
                <span className="sub-progress" aria-hidden="true">
                  <span style={{ width: `${subProgressPercent(detail.subIssues)}%` }} />
                </span>
                <span className="sub-issues-progress">
                  {detail.subIssues.filter((entry) => entry.state === 'closed').length} of{' '}
                  {detail.subIssues.length} done
                </span>
                <span className={`item-project-chevron ${subIssuesOpen ? 'open' : ''}`} aria-hidden="true">
                  <Icon name="chevronDown" size={14} />
                </span>
              </button>
            </h3>
            {subIssuesOpen && (
              <ul className="sub-issues-list">
                {detail.subIssues.map((entry) => (
                  <li key={entry.number} className={`sub-issue-row ${entry.state}`}>
                    <Icon name={entry.state === 'closed' ? 'check' : 'issue'} size={12} />
                    <SubIssueLink
                      issue={entry}
                      onOpen={(number) => onOpenIssue(repoFullName, number, 'issue')}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {kind === 'issue' && (
          <section className="detail-card" aria-label="Projects">
            <ItemProjects repoFullName={repoFullName} number={number} />
          </section>
        )}
      </div>

      <section className="detail-card" aria-label="Description">
        <SectionHead icon="menu" title="Description" />
        <RichBody
          html={detail.bodyHtml}
          viewOnGitHubUrl={summary.htmlUrl}
          onLink={routeLink}
          emptyText="No description provided."
          onTaskToggle={editable ? toggleTask : undefined}
        />
      </section>

      {kind === 'issue' && (
        <section className="detail-card" aria-label="Pull requests and commits">
          <IssueLinks
            repoFullName={repoFullName}
            number={number}
            onOpenPull={(pullNumber) => onOpenIssue(repoFullName, pullNumber, 'pull')}
          />
        </section>
      )}

      {kind === 'pull' && (
        <section className="detail-card" aria-label="Changed files">
          <PullDiffView
            repoFullName={repoFullName}
            number={number}
            variant={variant}
            onLink={routeLink}
            signedInLogin={signedInLogin}
            open={pullDetail ? pullDetail.summary.state === 'open' && !pullDetail.merged : true}
          />
        </section>
      )}

      <div className="detail-card">
        <CommentThread
          repoFullName={repoFullName}
          number={number}
          signedInLogin={signedInLogin}
          commentCount={summary.commentCount}
          initialComments={detail.comments}
          commentsPartial={detail.commentsPartial}
          viewOnGitHubUrl={summary.htmlUrl}
          onLink={routeLink}
          // Conversation comments work the same on issues and pull requests (GitHub keeps both as issue comments).
          canWrite
          issueAuthorLogin={summary.authorLogin}
        />
      </div>

      <a
        className="github-link"
        href={summary.htmlUrl}
        onClick={(event) => {
          event.preventDefault();
          void window.orbit.app.openExternal(summary.htmlUrl);
        }}
      >
        View on GitHub <Icon name="external" size={12} />
      </a>
    </article>
  );
}

/** The share of loaded sub-issues that are done, as a whole percentage. */
function subProgressPercent(children: SubIssueRef[]): number {
  const total = children.length;
  const done = children.filter((entry) => entry.state === 'closed').length;
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function SubIssueLink({ issue, onOpen }: { issue: SubIssueRef; onOpen(number: number): void }) {
  return (
    <button
      type="button"
      className="sub-issue-link"
      {...hovercardUrlProps(issue.htmlUrl)}
      onClick={() => onOpen(issue.number)}
    >
      #{issue.number} {issue.title}
    </button>
  );
}
