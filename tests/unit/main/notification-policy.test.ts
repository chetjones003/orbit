import { describe, expect, it } from 'vitest';
import { desktopNotices } from '../../../src/main/notification-policy';
import type { NotificationItem } from '../../../src/shared/notifications';

function item(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    threadId: '1',
    repoFullName: 'orbit-owner/app',
    title: 'Fix the thing',
    reason: 'mention',
    subjectType: 'Issue',
    updatedAt: '2026-01-01T10:00:00Z',
    target: { kind: 'issue', repoFullName: 'orbit-owner/app', number: 12 },
    ...overrides
  };
}

describe('desktopNotices', () => {
  it('shows one desktop notification per item when the window is not focused', () => {
    const notices = desktopNotices(
      {
        kind: 'items',
        items: [item({ threadId: '1' }), item({ threadId: '2', reason: 'review_requested' })]
      },
      false
    );

    expect(notices).toEqual([
      { threadId: '1', title: 'orbit-owner/app', body: 'Mention: Fix the thing' },
      { threadId: '2', title: 'orbit-owner/app', body: 'Review requested: Fix the thing' }
    ]);
  });

  it('shows nothing as a desktop notification while the window is focused, because the toast covers it', () => {
    expect(desktopNotices({ kind: 'items', items: [item()] }, true)).toEqual([]);
  });

  it('shows a catch-up summary as one desktop notice when the window is not focused', () => {
    expect(desktopNotices({ kind: 'summary', count: 5, desktop: true }, false)).toEqual([
      { threadId: null, title: 'Orbit', body: '5 new GitHub notifications' }
    ]);
  });

  it('never shows the quiet startup baseline as a desktop notification', () => {
    expect(desktopNotices({ kind: 'summary', count: 4, desktop: false }, false)).toEqual([]);
  });

  it('falls back to the raw reason for reasons it does not name', () => {
    const notices = desktopNotices({ kind: 'items', items: [item({ reason: 'new_reason' })] }, false);

    expect(notices[0]?.body).toBe('new_reason: Fix the thing');
  });
});
