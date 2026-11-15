import { useEffect, useRef, useState } from 'react';
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
  const [text, setText] = useState(() => drafts.get(draftKey) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blocked = disabled || busy || text.trim() === '';
  // False once the box is unmounted, so a save that finishes later does not act on a newer box for the same slot.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function send() {
    if (blocked) return;
    const sent = text;
    setBusy(true);
    setError(null);
    try {
      const result = await onSubmit(sent);
      if (result.kind === 'saved') {
        // The draft is cleared only while it still holds what was sent; newer text in it is kept.
        if (drafts.get(draftKey) === sent) drafts.set(draftKey, '');
        if (alive.current) {
          setText('');
          onSaved();
        } else {
          onStale();
        }
      } else {
        if (alive.current) setError(NEW_COMMITS_MESSAGE);
        onStale();
      }
    } catch {
      if (alive.current) setError(failureMessage);
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="pull-review-box">
      <textarea
        aria-label={label}
        rows={3}
        value={text}
        // Read-only while a save is in flight, so text typed then is never cleared unsent.
        disabled={disabled || busy}
        onChange={(event) => {
          setText(event.target.value);
          drafts.set(draftKey, event.target.value);
        }}
      />
      {error && <p role="alert">{error}</p>}
      <div className="pull-review-actions">
        <button className="primary-action" disabled={blocked} onClick={() => void send()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button className="secondary-action" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
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
}

/** The user's pending review: its comments, the new-commits pause, and finishing the review. */
export function ReviewPanel({
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
