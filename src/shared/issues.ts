/**
 * Issue shapes shared by main, preload, and renderer. No Node or DOM APIs.
 * Bodies are GitHub's own rendered HTML; the renderer sanitizes them before display.
 */
export type IssueStateFilter = 'open' | 'closed' | 'all';

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
  commentCount: number;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
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
  /** GitHub-rendered HTML. Sanitize before display. */
  bodyHtml: string;
}

export interface IssueDetail {
  summary: IssueSummary;
  /** GitHub-rendered HTML. Sanitize before display. Empty string when the issue has no body. */
  bodyHtml: string;
  comments: IssueComment[];
  /** True when more comments exist than the first page returned. */
  commentsPartial: boolean;
}
