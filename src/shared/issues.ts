/**
 * Issue shapes shared by main, preload, and renderer. No Node or DOM APIs.
 * Bodies are GitHub's own rendered HTML; the renderer sanitizes them before display.
 */
export type IssueStateFilter = 'open' | 'closed' | 'all';
export type PullStateFilter = 'open' | 'closed' | 'all';

export interface PullListQuery {
  repoFullName: string;
  state: PullStateFilter;
  label?: string;
  author?: string;
  page: number;
}

export interface PullSummary extends IssueSummary {
  draft: boolean;
  headRef: string;
  baseRef: string;
}

export interface PullListPage {
  items: PullSummary[];
  page: number;
  hasNextPage: boolean;
  partial: boolean;
}

export interface PullReview {
  id: number;
  authorLogin: string;
  state: string;
  submittedAt: string | null;
  body: string;
  htmlUrl: string;
}
export interface PullCheck {
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
}
export interface PullDetail {
  summary: PullSummary;
  body: string;
  bodyHtml: string;
  comments: IssueComment[];
  commentsPartial: boolean;
  reviews: PullReview[];
  reviewsPartial: boolean;
  checks: PullCheck[];
  checksPartial: boolean;
  mergeable: boolean | null;
  mergeableState: string;
  merged: boolean;
}

export type PullFileStatus =
  'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';

/**
 * Why a file has no text diff. `binary`: no changed lines to show. `too-large`: GitHub has changes
 * but omitted the patch, so the diff is shown only on GitHub.
 */
export type PullFileNoPatchReason = 'binary' | 'too-large';

export interface PullFile {
  filename: string;
  /** The name before a rename or copy. */
  previousFilename: string | null;
  status: PullFileStatus;
  additions: number;
  deletions: number;
  /** Unified diff text for the file, or null when GitHub did not return one. */
  patch: string | null;
  noPatchReason: PullFileNoPatchReason | null;
}

export interface PullFilesPage {
  files: PullFile[];
  /** True when the pull request has more files than Orbit read. Never shown as the full list. */
  partial: boolean;
}

export interface PullReviewComment {
  id: number;
  /** `ghost` when the author account no longer exists. */
  authorLogin: string;
  createdAt: string;
  htmlUrl: string;
  /** Raw Markdown source. */
  body: string;
  /** GitHub-rendered HTML. Sanitize before display. */
  bodyHtml: string;
}

export interface PullReviewThread {
  /** GitHub's node id for the thread. */
  id: string;
  path: string;
  /** Current line in the diff, or null when the code has changed since the comment. */
  line: number | null;
  originalLine: number | null;
  isResolved: boolean;
  /** True when the code the thread was written against has since changed. */
  isOutdated: boolean;
  /** Diff hunk the thread was written against, so an outdated thread keeps its original context. */
  diffHunk: string;
  comments: PullReviewComment[];
  /** True when the thread has more replies than were read. */
  commentsPartial: boolean;
}

export interface PullReviewThreadsPage {
  threads: PullReviewThread[];
  /** True when the pull request has more review threads than Orbit read. */
  partial: boolean;
}

export interface IssueListQuery {
  /** `owner/name`. The owner must be the signed-in account (personal repos only). */
  repoFullName: string;
  state: IssueStateFilter;
  label?: string;
  /** GitHub login of the issue's creator. */
  author?: string;
  /** 1-based page number. */
  page: number;
}

export interface IssueLabel {
  name: string;
  color: string;
}

export interface IssueSummary {
  id: number;
  number: number;
  title: string;
  state: 'open' | 'closed';
  stateReason: string | null;
  authorLogin: string;
  labels: IssueLabel[];
  /** Logins of the people assigned to the issue. */
  assignees: string[];
  milestone: IssueMilestone | null;
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface IssueMilestone {
  number: number;
  title: string;
}

export interface IssueListPage {
  items: IssueSummary[];
  page: number;
  /** True when GitHub returned a full page, so another page may exist. */
  hasNextPage: boolean;
  /**
   * True when some items could not be shown. The list must be presented as incomplete,
   * never as the full result.
   */
  partial: boolean;
}

export interface IssueComment {
  id: number;
  authorLogin: string;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  /** Raw Markdown source. Only the author's own comments are ever edited from it. */
  body: string;
  /** GitHub-rendered HTML. Sanitize before display. */
  bodyHtml: string;
}

/** Result of editing a comment: saved, or GitHub holds a newer version than the one the user started from. */
export type CommentUpdateResult =
  { kind: 'saved'; comment: IssueComment } | { kind: 'conflict'; current: IssueComment };

/** GitHub's limit for one comment, counted in characters. */
export const COMMENT_MAX_CHARS = 65_536;

/** GitHub's limit for an issue title. */
export const ISSUE_TITLE_MAX_CHARS = 256;
/** GitHub's limit for an issue body, the same as for a comment. */
export const ISSUE_BODY_MAX_CHARS = COMMENT_MAX_CHARS;

export interface IssueDetail {
  summary: IssueSummary;
  /** Raw Markdown source of the body. Only the signed-in user's own issues are ever edited from it. */
  body: string;
  /** GitHub-rendered HTML. Sanitize before display. Empty string when the issue has no body. */
  bodyHtml: string;
  comments: IssueComment[];
  /** True when more comments exist than the first page returned. */
  commentsPartial: boolean;
}

/** An issue as GitHub holds it after a read or write: its summary plus the body in both forms. */
export interface IssueSnapshot {
  summary: IssueSummary;
  body: string;
  bodyHtml: string;
}

export interface IssueContentInput {
  title: string;
  body: string;
}

/** Saved, or GitHub holds a newer version than the one the edit started from. */
export type IssueEditResult =
  { kind: 'saved'; issue: IssueSnapshot } | { kind: 'conflict'; current: IssueSnapshot };

/** Saved, or the body changed on GitHub since the user loaded it, so the checkbox must be re-read. */
export type TaskToggleResult =
  { kind: 'saved'; issue: IssueSnapshot } | { kind: 'stale'; current: IssueSnapshot };

export type IssueCloseReason = 'completed' | 'not_planned';

/** Metadata the user edits. Each list replaces GitHub's list in full. */
export interface IssueFieldsInput {
  labels: string[];
  assignees: string[];
  milestoneNumber: number | null;
}

/** Choices the repo offers for editing an issue's fields. */
export interface IssueRepoOptions {
  labels: IssueLabel[];
  assignees: string[];
  milestones: IssueMilestone[];
  /** True when a list was full, so the repo may offer choices that are not shown. */
  partial: boolean;
}
