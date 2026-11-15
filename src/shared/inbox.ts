import type { IssueLabel } from './issues';

/**
 * Inbox shapes shared by main, preload, and renderer. No Node or DOM APIs.
 * The inbox covers the signed-in account's personal repos only.
 */

/** The fixed tabs, in display order. */
export const INBOX_TABS = ['my-open-prs', 'assigned', 'review-requested', 'mentioned', 'recent'] as const;

export type InboxTab = (typeof INBOX_TABS)[number];

export const INBOX_TAB_LABELS: Record<InboxTab, string> = {
  'my-open-prs': 'My open PRs',
  assigned: 'Assigned to me',
  'review-requested': 'Review requested',
  mentioned: 'Mentioned',
  recent: 'Recently updated'
};

export interface InboxQuery {
  tab: InboxTab;
  /** 1-based page number. */
  page: number;
}

export interface InboxItem {
  /** `owner/name`, always a personal repo of the signed-in account. */
  repoFullName: string;
  number: number;
  kind: 'issue' | 'pull';
  title: string;
  state: 'open' | 'closed';
  /** Always false for issues. */
  isDraft: boolean;
  authorLogin: string;
  labels: IssueLabel[];
  commentCount: number;
  updatedAt: string;
  htmlUrl: string;
}

export interface InboxPage {
  tab: InboxTab;
  items: InboxItem[];
  page: number;
  hasNextPage: boolean;
  /**
   * True when some matching items could not be shown, such as results GitHub
   * capped or search results that were incomplete. Never presented as the full list.
   */
  partial: boolean;
}
