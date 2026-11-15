import { describe, expect, it, vi } from 'vitest';
import { desktopNotices, shouldHideOnClose, trayMenuItems } from '../../../src/main/notification-policy';
import type { NotificationItem } from '../../../src/main/github/notification-service';

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

describe('shouldHideOnClose', () => {
  it('hides the window instead of closing it while Orbit keeps running in the tray', () => {
    expect(shouldHideOnClose({ quitting: false, trayAvailable: true })).toBe(true);
  });

  it('closes the window when the user really quits', () => {
    expect(shouldHideOnClose({ quitting: true, trayAvailable: true })).toBe(false);
  });

  it('closes the window when no tray icon exists, so the user is never left with no way back', () => {
    expect(shouldHideOnClose({ quitting: false, trayAvailable: false })).toBe(false);
  });
});

describe('trayMenuItems', () => {
  it('offers Show Orbit and Quit Orbit, wired to the given handlers', () => {
    const show = vi.fn();
    const quit = vi.fn();
    const items = trayMenuItems({ show, quit });

    expect(items.map((entry) => entry.label)).toEqual(['Show Orbit', undefined, 'Quit Orbit']);
    items[0]?.onSelect?.();
    items[2]?.onSelect?.();
    expect(show).toHaveBeenCalledTimes(1);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
