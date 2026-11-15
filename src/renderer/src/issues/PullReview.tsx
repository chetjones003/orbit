import { useState } from 'react';
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
  label,
  submitLabel,
  disabled,
  onSubmit,
  onSaved,
  onStale,
  onCancel,
  failureMessage = COMMENT_ERROR
}: {
  label: string;
  submitLabel: string;
  disabled: boolean;
  onSubmit: (text: string) => Promise<ReviewCommentResult>;
  onSaved: () => void;
  /** GitHub's head moved since the review started; the caller reloads the review. */
  onStale: () => void;
  onCancel?: () => void;
  failureMessage?: string;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = disabled || busy || text.trim() === '';

  async function send() {
    if (blocked) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onSubmit(text);
      if (result.kind === 'saved') {
        setText('');
        onSaved();
      } else {
        setError(NEW_COMMITS_MESSAGE);
        onStale();
      }
    } catch {
      setError(failureMessage);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pull-review-box">
      <textarea
        aria-label={label}
        rows={3}
        value={text}
        disabled={disabled}
        onChange={(event) => setText(event.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      <div className="pull-review-actions">
        <button className="primary-action" disabled={blocked} onClick={() => void send()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button className="secondary-action" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export interface ReviewPanelProps {
  repoFullName: string;
  number: number;
  review: PullReviewState | null;
  reviewError: string | null;
  partialComments: boolean;
  /** True when the pull request's head moved since the user last acknowledged it. */
  newCommits: boolean;
  reviewedHeadSha: string | null;
  onAcknowledge: () => void;
  onRefresh: () => void;
  onSubmitted: () => void;
}

/** The user's pending review: its comments, the new-commits pause, and finishing the review. */
export function ReviewPanel({
  repoFullName,
  number,
  review,
  reviewError,
  partialComments,
  newCommits,
  reviewedHeadSha,
  onAcknowledge,
  onRefresh,
  onSubmitted
}: ReviewPanelProps) {
  const [finishing, setFinishing] = useState(false);
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [summary, setSummary] = useState('');
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
          <button className="primary-action" onClick={onAcknowledge}>
            Acknowledge new commits
          </button>
        </div>
      )}
      {review && !newCommits && (
        <button className="secondary-action" onClick={onRefresh}>
          Refresh
        </button>
      )}
      <button
        className="secondary-action"
        onClick={() => setFinishing((open) => !open)}
        disabled={review === null}
      >
        Finish review
      </button>
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
            onChange={(e) => setSummary(e.target.value)}
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
