import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Diff,
  Hunk,
  getChangeKey,
  isInsert,
  isNormal,
  type ChangeData,
  type HunkData,
  type ViewType
} from 'react-diff-view';
import 'react-diff-view/style/index.css';
import type {
  PullFile,
  PullFilesPage,
  PullReviewState,
  PullReviewThread,
  PullReviewThreadsPage,
  ReviewAnchor,
  ReviewCommentResult
} from '../../../shared/issues';
import { RichBody } from './RichBody';
import { ReviewPanel, ReviewTextBox, describeAnchor } from './PullReview';
import type { DraftKey } from '../comments/draft-store';
import { anchorForChange, findChangeForAnchor, fileNote, isLargePatch, parseFileDiff } from './pull-diff';

export interface PullDiffViewProps {
  repoFullName: string;
  number: number;
  /** Compact panel shows the unified diff. The expanded view can also show a split diff. */
  variant?: 'panel' | 'expanded';
  onLink: (href: string) => void;
  /** The signed-in account, which keys unsent review text. */
  signedInLogin: string;
}

const LOAD_ERROR = 'The changed files could not be loaded. Try again later.';
const THREAD_ERROR = 'The review thread could not be updated. Try again.';
const REVIEW_LOAD_ERROR = 'Your pending review could not be loaded. Refresh to try again.';
const REPLY_FAILURE = 'Your reply was not saved. Your text is kept; try again.';

/** The review actions the file views need. Writes are off until the reviewed commit is current. */
interface ReviewActions {
  enabled: boolean;
  /** Draft key for unsent review text in one slot of this pull request. */
  draftKey: (slot: string) => DraftKey;
  composing: ReviewAnchor | null;
  onStartComment: (anchor: ReviewAnchor) => void;
  onCancelComment: () => void;
  onSaveComment: (anchor: ReviewAnchor, body: string) => Promise<ReviewCommentResult>;
  onSaved: () => void;
  onReplyOpen: (threadId: string | null) => void;
  replyingTo: string | null;
  onReply: (threadId: string, body: string) => Promise<ReviewCommentResult>;
  onResolve: (thread: PullReviewThread, resolved: boolean) => void;
  onChanged: () => void;
}

/** Changed files with a file navigator, and each file's diff with its review threads and pending review. */
export function PullDiffView({
  repoFullName,
  number,
  variant = 'panel',
  onLink,
  signedInLogin
}: PullDiffViewProps) {
  const [filesPage, setFilesPage] = useState<PullFilesPage | null>(null);
  const [threadsPage, setThreadsPage] = useState<PullReviewThreadsPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [viewType, setViewType] = useState<ViewType>('unified');
  const [loadedLarge, setLoadedLarge] = useState<ReadonlySet<string>>(new Set());
  const [review, setReview] = useState<PullReviewState | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  /** The head commit the user has reviewed. A newer head pauses writes until the user acknowledges it. */
  const [reviewedHeadSha, setReviewedHeadSha] = useState<string | null>(null);
  const [composing, setComposing] = useState<ReviewAnchor | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** The diff could not be reloaded after the last refresh, so the new head is not yet shown. */
  const [filesStale, setFilesStale] = useState(false);
  /** The head the loaded files were read after. Only that head can be acknowledged. */
  const [filesHeadSha, setFilesHeadSha] = useState<string | null>(null);

  const loadThreads = useCallback(async () => {
    setThreadsPage(await window.orbit.pulls.threads(repoFullName, number));
  }, [repoFullName, number]);

  /** Reloads the changed files. They are read after the review, and `headSha` records which head that was. */
  const loadFiles = useCallback(
    async (headSha: string) => {
      try {
        setFilesPage(await window.orbit.pulls.files(repoFullName, number));
        setFilesHeadSha(headSha);
        setFilesStale(false);
      } catch {
        setFilesStale(true);
      }
    },
    [repoFullName, number]
  );

  const loadReview = useCallback(async (): Promise<PullReviewState | null> => {
    try {
      const state = await window.orbit.pulls.reviewState(repoFullName, number);
      setReview(state);
      setReviewError(null);
      // The first load reviews the commit the pending comments were written on, so new commits are noticed.
      setReviewedHeadSha((current) => current ?? state.pending?.commitSha ?? state.headSha);
      return state;
    } catch {
      setReviewError(REVIEW_LOAD_ERROR);
      return null;
    }
  }, [repoFullName, number]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setReview(null);
    setReviewedHeadSha(null);
    setFilesHeadSha(null);
    setComposing(null);
    setReplyingTo(null);
    void (async () => {
      // The review is read before the files, so the files are never older than the head they are paired with.
      const state = await loadReview();
      try {
        const [files, threads] = await Promise.all([
          window.orbit.pulls.files(repoFullName, number),
          window.orbit.pulls.threads(repoFullName, number)
        ]);
        if (cancelled) return;
        setFilesPage(files);
        setThreadsPage(threads);
        if (state) setFilesHeadSha(state.headSha);
      } catch {
        if (!cancelled) setError(LOAD_ERROR);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repoFullName, number, loadReview]);

  /** Reloads the review, then the files for its head, then the threads. */
  const refreshReview = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      const state = await loadReview();
      if (state) await loadFiles(state.headSha);
      setRefreshing(false);
      await loadThreads().catch(() => setThreadError(THREAD_ERROR));
    })();
  }, [loadReview, loadFiles, loadThreads]);

  if (error) return <p role="alert">{error}</p>;
  if (!filesPage || !threadsPage) {
    return (
      <p className="empty-state" role="status">
        Loading changed files…
      </p>
    );
  }
  const file = filesPage.files[Math.min(selected, filesPage.files.length - 1)];
  if (!file) return <p>No changed files.</p>;

  const newCommits = review !== null && reviewedHeadSha !== null && review.headSha !== reviewedHeadSha;
  const enabled = review !== null && reviewedHeadSha !== null && !newCommits;

  const requireHead = (): string => {
    if (reviewedHeadSha === null) throw new Error('The reviewed commit is not known yet.');
    return reviewedHeadSha;
  };
  const actions: ReviewActions = {
    enabled,
    draftKey: (slot) => ({
      login: signedInLogin,
      repoFullName,
      kind: 'pull',
      number,
      target: { reviewSlot: slot }
    }),
    composing,
    onStartComment: (anchor) => setComposing(anchor),
    onCancelComment: () => setComposing(null),
    onSaveComment: (anchor, body) =>
      window.orbit.pulls.addReviewComment(repoFullName, number, {
        anchor,
        body,
        reviewedHeadSha: requireHead()
      }),
    onSaved: () => {
      setComposing(null);
      refreshReview();
    },
    onReplyOpen: setReplyingTo,
    replyingTo,
    onReply: (threadId, body) =>
      window.orbit.pulls.replyToReviewThread(repoFullName, number, {
        threadId,
        body,
        reviewedHeadSha: requireHead()
      }),
    onResolve: (thread, resolved) => {
      setThreadError(null);
      window.orbit.pulls
        .setReviewThreadResolved(repoFullName, number, thread.id, resolved)
        .then(() => loadThreads())
        .catch(() => setThreadError(THREAD_ERROR));
    },
    onChanged: refreshReview
  };

  const note = fileNote(file);
  const threadsForFile = threadsPage.threads.filter((thread) => thread.path === file.filename);

  return (
    <section aria-label="Changed files" className={`pull-diff ${variant}`}>
      {filesPage.partial && <p role="note">Some changed files may not be shown.</p>}
      {threadsPage.partial && <p role="note">Some review threads may not be shown.</p>}
      {threadError && <p role="alert">{threadError}</p>}
      {filesStale && (
        <p role="alert">
          The changed files could not be reloaded. Refresh again before acknowledging new commits.
        </p>
      )}
      <ReviewPanel
        repoFullName={repoFullName}
        signedInLogin={signedInLogin}
        number={number}
        review={review}
        reviewError={reviewError}
        partialComments={review?.pending?.commentsPartial ?? false}
        newCommits={newCommits}
        reviewedHeadSha={reviewedHeadSha}
        acknowledgeDisabled={refreshing || filesStale || filesHeadSha !== (review?.headSha ?? null)}
        onAcknowledge={() => setReviewedHeadSha(review?.headSha ?? null)}
        onRefresh={refreshReview}
        onSubmitted={refreshReview}
      />
      <div className="pull-diff-layout">
        <nav aria-label="File navigator">
          <ul>
            {filesPage.files.map((candidate, index) => (
              <li key={candidate.filename}>
                <button
                  className="secondary-action"
                  aria-current={index === selected ? 'true' : undefined}
                  onClick={() => setSelected(index)}
                >
                  {candidate.filename} <span aria-label="additions">+{candidate.additions}</span>{' '}
                  <span aria-label="deletions">−{candidate.deletions}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="pull-diff-file">
          <div className="pull-diff-toolbar">
            <h3>{file.filename}</h3>
            {variant === 'expanded' && (
              <button
                className="secondary-action"
                onClick={() => setViewType((current) => (current === 'unified' ? 'split' : 'unified'))}
              >
                {viewType === 'unified' ? 'Split view' : 'Unified view'}
              </button>
            )}
          </div>
          {note && <p className="pull-diff-note">{note}</p>}
          <FileBody
            file={file}
            viewType={viewType}
            loaded={loadedLarge.has(file.filename)}
            onLoad={() => setLoadedLarge((current) => new Set(current).add(file.filename))}
            threads={threadsForFile}
            repoFullName={repoFullName}
            number={number}
            onLink={onLink}
            actions={{
              ...actions,
              composing: composing?.path === file.filename ? composing : null
            }}
          />
        </div>
      </div>
    </section>
  );
}

interface FileBodyProps {
  file: PullFile;
  viewType: ViewType;
  loaded: boolean;
  onLoad: () => void;
  threads: PullReviewThread[];
  repoFullName: string;
  number: number;
  onLink: (href: string) => void;
  actions: ReviewActions;
}

function FileBody({
  file,
  viewType,
  loaded,
  onLoad,
  threads,
  repoFullName,
  number,
  onLink,
  actions
}: FileBodyProps) {
  const large = file.patch !== null && isLargePatch(file.patch);
  const parsed = useMemo(
    () => (file.patch !== null && (!large || loaded) ? parseFileDiff(file) : null),
    [file, large, loaded]
  );

  const filesUrl = `https://github.com/${repoFullName}/pull/${number}/files`;
  if (file.patch === null || (large && !loaded)) {
    const lines = file.patch === null ? null : file.patch.split('\n').length;
    return (
      <>
        {file.patch !== null && (
          <button className="secondary-action" onClick={onLoad}>
            Load diff ({lines} lines)
          </button>
        )}
        {file.noPatchReason === 'too-large' && (
          <a
            href={filesUrl}
            onClick={(event) => {
              event.preventDefault();
              void window.orbit.app.openExternal(filesUrl);
            }}
          >
            View the diff on GitHub ↗
          </a>
        )}
        <ThreadList threads={threads} onLink={onLink} actions={actions} />
      </>
    );
  }

  if (!parsed) return null;
  const widgets = threadWidgets(parsed.hunks, threads, onLink, actions);
  const unplaced = threads.filter((thread) => !widgets.placed.has(thread.id));

  return (
    <>
      <Diff
        viewType={viewType}
        diffType={parsed.type}
        hunks={parsed.hunks}
        widgets={widgets.map}
        gutterEvents={
          actions.enabled
            ? {
                onClick: ({ change, side }) => {
                  if (!change) return;
                  const anchor = anchorForChange(file.filename, change, side);
                  if (anchor) actions.onStartComment(anchor);
                }
              }
            : undefined
        }
      >
        {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
      </Diff>
      {widgets.composerUnplaced}
      {unplaced.length > 0 && <h4>Other threads on this file</h4>}
      <ThreadList threads={unplaced} onLink={onLink} actions={actions} />
    </>
  );
}

/**
 * Pins each current thread under the diff line it refers to, and the comment box under the line it is
 * written on. A thread whose line is gone (outdated, or not in the diff) is left unplaced and shown with
 * its original context instead.
 */
function threadWidgets(
  hunks: HunkData[],
  threads: PullReviewThread[],
  onLink: (href: string) => void,
  actions: ReviewActions
) {
  const map: Record<string, ReactNode> = {};
  const placed = new Set<string>();
  for (const thread of threads) {
    if (thread.line === null || thread.isOutdated) continue;
    const change = findChangeAtNewLine(hunks, thread.line);
    if (!change) continue;
    const key = getChangeKey(change);
    placed.add(thread.id);
    map[key] = (
      <>
        {map[key]}
        <ThreadCard thread={thread} onLink={onLink} actions={actions} />
      </>
    );
  }

  let composerUnplaced: ReactNode = null;
  if (actions.composing) {
    const anchor = actions.composing;
    const composer = (
      <ReviewTextBox
        draftKey={actions.draftKey(`comment:${anchor.path}:${anchor.side}:${anchor.line}`)}
        label={`Comment on ${describeAnchor(anchor.path, anchor.side, anchor.line)}`}
        submitLabel="Add comment"
        disabled={!actions.enabled}
        onSubmit={(body) => actions.onSaveComment(anchor, body)}
        onSaved={actions.onSaved}
        onStale={actions.onChanged}
        onCancel={actions.onCancelComment}
      />
    );
    const change = findChangeForAnchor(hunks, anchor);
    if (change) {
      const key = getChangeKey(change);
      map[key] = (
        <>
          {map[key]}
          {composer}
        </>
      );
    } else {
      composerUnplaced = composer;
    }
  }
  return { map, placed, composerUnplaced };
}

function findChangeAtNewLine(hunks: HunkData[], line: number): ChangeData | null {
  for (const hunk of hunks) {
    for (const change of hunk.changes) {
      if (isInsert(change) && change.lineNumber === line) return change;
      if (isNormal(change) && change.newLineNumber === line) return change;
    }
  }
  return null;
}

function ThreadList({
  threads,
  onLink,
  actions
}: {
  threads: PullReviewThread[];
  onLink: (href: string) => void;
  actions: ReviewActions;
}) {
  return (
    <>
      {threads.map((thread) => (
        <ThreadCard key={thread.id} thread={thread} onLink={onLink} actions={actions} />
      ))}
    </>
  );
}

function ThreadCard({
  thread,
  onLink,
  actions
}: {
  thread: PullReviewThread;
  onLink: (href: string) => void;
  actions: ReviewActions;
}) {
  const status = thread.isOutdated ? 'Outdated' : thread.isResolved ? 'Resolved' : 'Open';
  const replying = actions.replyingTo === thread.id;
  return (
    <section aria-label={`Review thread on ${thread.path}`} className="pull-thread">
      <p>
        <strong>{status}</strong>
        {thread.line !== null ? ` · line ${thread.line}` : ` · was line ${thread.originalLine ?? 'unknown'}`}
      </p>
      {thread.isOutdated && thread.diffHunk && (
        <>
          <p>The code changed after this comment. Its original context:</p>
          <pre>{thread.diffHunk}</pre>
        </>
      )}
      {thread.comments.map((comment) => (
        <article key={comment.id}>
          <p>
            @{comment.authorLogin} · {new Date(comment.createdAt).toLocaleDateString()}
          </p>
          <RichBody
            html={comment.bodyHtml}
            viewOnGitHubUrl={comment.htmlUrl}
            onLink={onLink}
            emptyText="No comment text."
          />
        </article>
      ))}
      {thread.commentsPartial && <p role="note">Some replies may not be shown.</p>}
      <div className="pull-review-actions">
        <button className="secondary-action" onClick={() => actions.onResolve(thread, !thread.isResolved)}>
          {thread.isResolved ? 'Reopen thread' : 'Resolve thread'}
        </button>
        {actions.enabled && !replying && (
          <button className="secondary-action" onClick={() => actions.onReplyOpen(thread.id)}>
            Reply
          </button>
        )}
      </div>
      {actions.enabled && replying && (
        <ReviewTextBox
          draftKey={actions.draftKey(`reply:${thread.id}`)}
          label={`Reply to thread on ${thread.path}`}
          submitLabel="Send reply"
          disabled={!actions.enabled}
          onSubmit={(body) => actions.onReply(thread.id, body)}
          onSaved={() => {
            actions.onReplyOpen(null);
            actions.onChanged();
          }}
          onStale={actions.onChanged}
          onCancel={() => actions.onReplyOpen(null)}
          failureMessage={REPLY_FAILURE}
        />
      )}
    </section>
  );
}
