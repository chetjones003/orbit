/** An issue or pull request a notification leads to. */
export interface NotificationTarget {
  kind: 'issue' | 'pull';
  repoFullName: string;
  number: number;
}

/** One unread notification on a personal repo, as Orbit shows it. Holds no GitHub body text. */
export interface NotificationItem {
  threadId: string;
  repoFullName: string;
  title: string;
  reason: string;
  subjectType: string;
  updatedAt: string;
  /** Null when the notification's subject is not an issue or pull request (for example a release). */
  target: NotificationTarget | null;
}

/**
 * What the user should be told. `items` gets one toast each. `summary` covers
 * many at once; `desktop: false` is the quiet startup baseline, shown in-app only.
 */
export type NotificationDelivery =
  { kind: 'items'; items: NotificationItem[] } | { kind: 'summary'; count: number; desktop: boolean };

/** Result of opening a notification. The thread stays unread when `markReadError` is set. */
export interface NotificationOpenResult {
  target: NotificationTarget | null;
  markReadError: string | null;
}

const REASON_LABELS: Record<string, string> = {
  mention: 'Mention',
  team_mention: 'Team mention',
  review_requested: 'Review requested',
  assign: 'Assigned',
  author: 'Activity on your item',
  comment: 'New comment',
  state_change: 'State changed',
  ci_activity: 'CI activity',
  subscribed: 'Activity'
};

/** How one notification reads in a toast or a desktop notification. */
export function describeItem(item: NotificationItem): { title: string; body: string } {
  const label = REASON_LABELS[item.reason] ?? item.reason;
  return { title: item.repoFullName, body: `${label}: ${item.title}` };
}

/** How a summary reads. `quiet` is the startup baseline: existing unread, not new. */
export function describeSummary(count: number, quiet: boolean): { title: string; body: string } {
  return {
    title: 'Orbit',
    body: quiet ? `${count} unread GitHub notifications` : `${count} new GitHub notifications`
  };
}
