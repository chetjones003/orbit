import { useEffect, useRef, useState } from 'react';
import { Composer } from '../comments/Composer';
import { drafts, type DraftKey } from '../comments/draft-store';
import type { PullReviewState, ReviewCommentResult, ReviewEvent } from '../../../shared/issues';

export const NEW_COMMITS_MESSAGE =
  'New commits were pushed after you started this review. Refresh, then acknowledge them before commenting or submitting.';
const COMMENT_ERROR = 'Your comment was not saved. Your text is kept; try again.';
const SUBMIT_ERROR = 'Your review was not submitted. Your summary is kept; try again.';

/** Names a comment's place in the diff, for example "src/a.ts, new side, line 4". */
export function describeAnchor(path: string, side: 'LEFT' | 'RIGHT', line: number | null): string {
  return `${path}, ${side === 'RIGHT' ? 'new side' : 'old side'}, line ${line ?? 'unknown'}`;
}

/** Text the user writes into a review: a comment on a line, or a reply to a thread. Text is kept on failure. */
export function ReviewTextBox({
  repoFullName,
  draftKey,
  label,
  submitLabel,
  disabled,
  onSubmit,
  onSaved,
  onStale,
  onCancel,
  failureMessage = COMMENT_ERROR
}: {
  repoFullName: string;
  /** Where unsent text is kept, so it survives leaving the pull request and is dropped only when sent. */
  draftKey: DraftKey;
  label: string;
  submitLabel: string;
  disabled: boolean;
  onSubmit: (text: string) => Promise<ReviewCommentResult>;
  onSaved: () => void;
  /**
   * Reloads the review. Called when GitHub's head moved, and when a save finishes after its box was closed.
   */
  onStale: () => void;
  onCancel?: () => void;
  failureMessage?: string;
}) {
  // False once this box is unmounted. A save that finishes after that must not act on a newer box for the same line.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // The same editor as issue comments: toolbar, Markdown preview, drafts, and uploads. The composer keeps the text
  // when a send is refused, so a stale head or a failure leaves it in place for the user to retry.
  return (
    <Composer
      draftKey={draftKey}
      placeholder="Leave a review comment"
      ariaLabel={label}
      submitLabel={submitLabel}
      submitDisabled={disabled}
      previewText={(text) => window.orbit.markdown.preview(repoFullName, text)}
      onExternalLink={(href) => void window.orbit.app.openExternal(href)}
      viewOnGitHubUrl={`https://github.com/${repoFullName}/pulls`}
      attachTo={{ repoFullName }}
      onSubmit={async (text) => {
        let result: ReviewCommentResult;
        try {
          result = await onSubmit(text);
        } catch {
          throw new Error(failureMessage);
        }
        if (result.kind === 'saved' && alive.current) {
          onSaved();
          return;
        }
        if (result.kind === 'saved') {
          onStale();
          return;
        }
        onStale();
        throw new Error(NEW_COMMITS_MESSAGE);
      }}
      onCancel={onCancel}
    />
  );
}

export interface ReviewPanelProps {
  repoFullName: string;
  signedInLogin: string;
  number: number;
  review: PullReviewState | null;
  reviewError: string | null;
  partialComments: boolean;
  /** True when the pull request's head moved since the user last acknowledged it. */
  newCommits: boolean;
  /** True while the diff is reloading or could not be reloaded, so the new commits are not yet shown. */
  acknowledgeDisabled: boolean;
  reviewedHeadSha: string | null;
  onAcknowledge: () => void;
  onRefresh: () => void;
  onSubmitted: () => void;
  /** False once the pull request is merged or closed. The review controls are hidden then. */
  open?: boolean;
}

/** The user's pending review: its comments, the new-commits pause, and finishing the review. */
export function ReviewPanel({
  open = true,
  repoFullName,
  signedInLogin,
  number,
  review,
  reviewError,
  partialComments,
  newCommits,
  acknowledgeDisabled,
  reviewedHeadSha,
  onAcknowledge,
  onRefresh,
  onSubmitted
}: ReviewPanelProps) {
  const [finishing, setFinishing] = useState(false);
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const summaryKey: DraftKey = {
    login: signedInLogin,
    repoFullName,
    kind: 'pull',
    number,
    target: { reviewSlot: 'summary' }
  };
  const [summary, setSummary] = useState(() => drafts.get(summaryKey) ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const comments = review?.pending?.comments ?? [];
  const canSubmit = review !== null && !newCommits && !busy;

  async function submit() {
    if (!canSubmit || reviewedHeadSha === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.orbit.pulls.submitReview(repoFullName, number, {
        event,
        body: summary,
        reviewedHeadSha
      });
      if (result.kind === 'submitted') {
        setSummary('');
        drafts.set(summaryKey, '');
        setFinishing(false);
        onSubmitted();
      } else {
        setError(NEW_COMMITS_MESSAGE);
        onRefresh();
      }
    } catch {
      setError(SUBMIT_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Your pending review" className="pull-review">
      {reviewError && <p role="alert">{reviewError}</p>}
      {review && (
        <>
          <p role="status">
            {review.pending === null
              ? 'No pending review. Your first comment starts one.'
              : `${comments.length} pending comment${comments.length === 1 ? '' : 's'}`}
          </p>
          {partialComments && <p role="note">Some pending comments may not be shown.</p>}
          <ul>
            {comments.map((comment) => (
              <li key={comment.id}>
                <p>{describeAnchor(comment.path, comment.side, comment.line)}</p>
                <p>{comment.body}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {newCommits && (
        <div>
          <p role="note">{NEW_COMMITS_MESSAGE}</p>
          <button className="secondary-action" onClick={onRefresh}>
            Refresh
          </button>{' '}
          <button className="primary-action" disabled={acknowledgeDisabled} onClick={onAcknowledge}>
            Acknowledge new commits
          </button>
        </div>
      )}
      <div className="pull-review-bar">
        {review && !newCommits && (
          <button className="secondary-action" onClick={onRefresh}>
            Refresh
          </button>
        )}
        {open && (
          <button
            className="secondary-action"
            onClick={() => setFinishing((shown) => !shown)}
            disabled={review === null}
          >
            Finish review
          </button>
        )}
      </div>
      {finishing && review && (
        <div className="pull-review-finish">
          <fieldset>
            <legend>Review outcome</legend>
            <label>
              <input
                type="radio"
                name="review-event"
                value="COMMENT"
                checked={event === 'COMMENT'}
                onChange={() => setEvent('COMMENT')}
              />{' '}
              Comment
            </label>{' '}
            <label>
              <input
                type="radio"
                name="review-event"
                value="APPROVE"
                disabled={review.isOwnPull}
                checked={event === 'APPROVE'}
                onChange={() => setEvent('APPROVE')}
              />{' '}
              Approve
            </label>{' '}
            <label>
              <input
                type="radio"
                name="review-event"
                value="REQUEST_CHANGES"
                disabled={review.isOwnPull}
                checked={event === 'REQUEST_CHANGES'}
                onChange={() => setEvent('REQUEST_CHANGES')}
              />{' '}
              Request changes
            </label>
          </fieldset>
          {review.isOwnPull && (
            <p>You can comment on your own pull request, but not approve or request changes.</p>
          )}
          <textarea
            aria-label="Review summary"
            rows={3}
            value={summary}
            disabled={busy}
            onChange={(e) => {
              setSummary(e.target.value);
              drafts.set(summaryKey, e.target.value);
            }}
          />
          {error && <p role="alert">{error}</p>}
          <button className="primary-action" disabled={!canSubmit} onClick={() => void submit()}>
            Submit review
          </button>
          {reviewedHeadSha === null && <p role="note">Waiting for the reviewed commit.</p>}
        </div>
      )}
    </section>
  );
}
