import { useState } from 'react';
import { confirm } from '@ui-sdk/react/alert-dialog';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@ui-sdk/react/menu';
import type { CommentUpdateResult, IssueComment } from '../../../shared/issues';
import { RichBody } from '../issues/RichBody';
import { Icon } from '../icons';
import { RepoMark } from '../shell/RepoMark';
import { markColor, markLetters } from '../shell/repo-mark';
import { Composer } from './Composer';
import { appToaster, TOAST_MS } from '../toasts/app-toaster';
import { drafts, type DraftKey } from './draft-store';

export interface CommentThreadProps {
  repoFullName: string;
  number: number;
  signedInLogin: string;
  /** GitHub's count for the issue. Adjusted locally as comments are added or deleted. */
  commentCount: number;
  initialComments: IssueComment[];
  /** True when more comments exist than the first page returned. */
  commentsPartial: boolean;
  viewOnGitHubUrl: string;
  /** Links inside comments and previews go through the same routing as the issue body. */
  onLink: (href: string) => void;
  /** Writes are offered only where comment support exists (issues in this slice). */
  canWrite: boolean;
  /** The login of the issue's author, shown as an Author badge on their comments. */
  issueAuthorLogin?: string;
}

interface Conflict {
  commentId: number;
  /** The text the user wrote, kept so nothing is lost while they choose. */
  mine: string;
  current: IssueComment;
  showTheirs: boolean;
}

/**
 * The comment timeline with a composer for new comments and, on the user's own comments, edit and
 * delete. Edits are checked against GitHub's version so a teammate's change is never overwritten silently.
 */
export function CommentThread({
  repoFullName,
  issueAuthorLogin,
  number,
  signedInLogin,
  commentCount,
  initialComments,
  commentsPartial,
  viewOnGitHubUrl,
  onLink,
  canWrite
}: CommentThreadProps) {
  const [comments, setComments] = useState(initialComments);
  const [count, setCount] = useState(commentCount);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const newKey: DraftKey = { login: signedInLogin, repoFullName, kind: 'issue', number, target: 'new' };
  const editKey = (commentId: number): DraftKey => ({ ...newKey, target: { commentId } });
  const previewText = (text: string): Promise<string> => window.orbit.markdown.preview(repoFullName, text);

  const replace = (next: IssueComment): void =>
    setComments((list) => list.map((item) => (item.id === next.id ? next : item)));

  const postNew = async (text: string): Promise<void> => {
    const saved = await window.orbit.comments.create(repoFullName, number, text);
    setComments((list) => [...list, saved]);
    setCount((n) => n + 1);
    setAnnouncement('Comment posted.');
    appToaster('Comment posted.', { type: 'success', duration: TOAST_MS });
  };

  const saveEdit = async (comment: IssueComment, text: string): Promise<'keep' | void> => {
    const result: CommentUpdateResult = await window.orbit.comments.update(
      repoFullName,
      comment.id,
      text,
      comment.updatedAt
    );
    if (result.kind === 'saved') {
      finishEdit(comment.id, result.comment, 'Comment updated.');
      return;
    }
    // GitHub has a newer version. Keep the editor and the user's text, and let them choose.
    setConflict({ commentId: comment.id, mine: text, current: result.current, showTheirs: false });
    return 'keep';
  };

  const overwrite = async (): Promise<void> => {
    if (!conflict) return;
    try {
      const result = await window.orbit.comments.update(
        repoFullName,
        conflict.commentId,
        conflict.mine,
        conflict.current.updatedAt
      );
      if (result.kind === 'saved') {
        finishEdit(conflict.commentId, result.comment, 'Comment updated.');
      } else {
        setConflict({ ...conflict, current: result.current, showTheirs: true });
      }
    } catch (cause: unknown) {
      setActionError(
        cause instanceof Error ? cause.message : 'Your edit could not be saved. It is still here.'
      );
    }
  };

  const copyMine = async (): Promise<void> => {
    if (!conflict) return;
    try {
      await navigator.clipboard.writeText(conflict.mine);
    } catch {
      setActionError('Could not copy your version. It is still in the editor.');
      return;
    }
    // Their version stays on the page; the user's text is on the clipboard.
    finishEdit(conflict.commentId, conflict.current, 'Your version was copied to the clipboard.');
  };

  /** Shows the comment's new version and leaves edit mode. The draft is dropped because its text is now saved or abandoned. */
  const finishEdit = (commentId: number, next: IssueComment, message: string): void => {
    replace(next);
    drafts.set(editKey(commentId), '');
    setEditingId(null);
    setConflict(null);
    setAnnouncement(message);
    appToaster(message, { type: 'success', duration: TOAST_MS });
  };

  const cancelEdit = async (comment: IssueComment): Promise<void> => {
    const pending = drafts.get(editKey(comment.id));
    if (
      pending !== undefined &&
      pending !== comment.body &&
      !(await confirm({
        title: 'Discard your edit?',
        description: 'Your changes will be lost.',
        confirmLabel: 'Discard'
      }))
    ) {
      return;
    }
    drafts.set(editKey(comment.id), '');
    setEditingId(null);
    setConflict(null);
  };

  const remove = async (comment: IssueComment): Promise<void> => {
    const agreed = await confirm({
      title: 'Delete this comment?',
      description: 'This cannot be undone.',
      confirmLabel: 'Delete'
    });
    if (!agreed) return;
    setActionError(null);
    try {
      await window.orbit.comments.delete(repoFullName, comment.id);
    } catch (cause: unknown) {
      setActionError(cause instanceof Error ? cause.message : 'The comment could not be deleted.');
      return;
    }
    setComments((list) => list.filter((item) => item.id !== comment.id));
    setCount((n) => Math.max(0, n - 1));
    drafts.set(editKey(comment.id), '');
    setAnnouncement('Comment deleted.');
    appToaster('Comment deleted.', { type: 'success', duration: TOAST_MS });
  };

  return (
    <section aria-label="Comments" className="issue-comments">
      <h3>{count === 1 ? '1 comment' : `${count} comments`}</h3>
      {commentsPartial && (
        <p className="session-notice" role="note">
          Only the first 100 comments are shown. Open the issue on GitHub to read the rest.
        </p>
      )}
      {comments.map((comment) => {
        const mine = canWrite && comment.authorLogin === signedInLogin;
        const editing = editingId === comment.id;
        // GitHub marks the repo owner's comments Owner, and the issue author's comments Author.
        const isOwner = comment.authorLogin === repoFullName.split('/')[0];
        const isAuthor = issueAuthorLogin !== undefined && comment.authorLogin === issueAuthorLogin;
        return (
          <div className="issue-comment" key={comment.id}>
            <div className="comment-head">
              <div className="comment-byline">
                <RepoMark
                  letters={markLetters(comment.authorLogin)}
                  color={markColor(comment.authorLogin)}
                  size={24}
                />
                <strong className="comment-author">@{comment.authorLogin}</strong>
                {isOwner && <span className="comment-role">Owner</span>}
                {isAuthor && <span className="comment-role">Author</span>}
                <span className="comment-action">commented</span>
                <time
                  className="comment-time"
                  dateTime={comment.createdAt}
                  title={new Date(comment.createdAt).toLocaleString()}
                >
                  {relativeTime(comment.createdAt)}
                </time>
              </div>
              {mine && (
                <CommentMenu
                  onEdit={() => {
                    setActionError(null);
                    setConflict(null);
                    setEditingId(comment.id);
                  }}
                  onDelete={() => void remove(comment)}
                />
              )}
            </div>
            {editing ? (
              <div className="comment-edit">
                <Composer
                  draftKey={editKey(comment.id)}
                  initialText={comment.body}
                  placeholder="Edit this comment"
                  ariaLabel="Edit comment"
                  submitLabel="Save edit"
                  previewText={previewText}
                  onSubmit={(text) => saveEdit(comment, text)}
                  onCancel={() => void cancelEdit(comment)}
                  onExternalLink={onLink}
                  viewOnGitHubUrl={viewOnGitHubUrl}
                  attachTo={{ repoFullName }}
                />
                {conflict?.commentId === comment.id && (
                  <ConflictPanel
                    conflict={conflict}
                    viewOnGitHubUrl={viewOnGitHubUrl}
                    onLink={onLink}
                    onViewTheirs={() => setConflict({ ...conflict, showTheirs: true })}
                    onOverwrite={() => void overwrite()}
                    onCopyMine={() => void copyMine()}
                  />
                )}
              </div>
            ) : (
              <>
                <RichBody
                  html={comment.bodyHtml}
                  viewOnGitHubUrl={comment.htmlUrl || viewOnGitHubUrl}
                  onLink={onLink}
                  emptyText=""
                />
              </>
            )}
          </div>
        );
      })}
      {actionError && (
        <p role="alert" className="session-notice">
          {actionError}
        </p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {canWrite && (
        <div className="new-comment">
          <h4>Add a comment</h4>
          <Composer
            draftKey={newKey}
            placeholder="Write a comment"
            ariaLabel="Write a comment"
            submitLabel="Comment"
            previewText={previewText}
            onSubmit={postNew}
            onExternalLink={onLink}
            viewOnGitHubUrl={viewOnGitHubUrl}
            attachTo={{ repoFullName }}
          />
        </div>
      )}
    </section>
  );
}

function ConflictPanel({
  conflict,
  viewOnGitHubUrl,
  onLink,
  onViewTheirs,
  onOverwrite,
  onCopyMine
}: {
  conflict: Conflict;
  viewOnGitHubUrl: string;
  onLink: (href: string) => void;
  onViewTheirs: () => void;
  onOverwrite: () => void;
  onCopyMine: () => void;
}) {
  return (
    <div role="alert" className="comment-conflict">
      <p>This comment changed on GitHub since you started editing. Your text is still here.</p>
      <div className="comment-actions">
        <button type="button" className="secondary-action" onClick={onViewTheirs}>
          View theirs
        </button>
        <button type="button" className="secondary-action" onClick={onOverwrite}>
          Overwrite with mine
        </button>
        <button type="button" className="secondary-action" onClick={onCopyMine}>
          Copy mine
        </button>
      </div>
      {conflict.showTheirs && (
        <div className="comment-theirs" aria-label="GitHub's version">
          <RichBody
            html={conflict.current.bodyHtml}
            viewOnGitHubUrl={conflict.current.htmlUrl || viewOnGitHubUrl}
            onLink={onLink}
            emptyText=""
          />
        </div>
      )}
    </div>
  );
}

/** The comment's options, behind a menu at its top right. Closes on an outside click or Escape. */
function CommentMenu({ onEdit, onDelete }: { onEdit(): void; onDelete(): void }) {
  return (
    <div className="comment-menu">
      <Menu onAction={(value) => (value === 'edit' ? onEdit() : onDelete())}>
        <MenuTrigger className="comment-menu-trigger" aria-label="Comment options">
          <Icon name="kebab" size={16} />
        </MenuTrigger>
        <MenuContent className="comment-menu-popup" aria-label="Comment options">
          <MenuItem value="edit">Edit</MenuItem>
          <MenuItem value="delete" className="danger">
            Delete
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}

/** How long ago a comment was written, in the words a person would use. Older than a month, the date. */
function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
