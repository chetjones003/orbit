import { describe, expect, it, vi } from 'vitest';
import { NotificationCenter } from '../../../src/main/notification-center';
import type { NotificationItem, NotificationPoll } from '../../../src/main/github/notification-service';

function item(threadId: string, overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    threadId,
    repoFullName: 'orbit-owner/app',
    title: `Thread ${threadId}`,
    reason: 'mention',
    subjectType: 'Issue',
    updatedAt: '2026-01-01T10:00:00Z',
    target: { kind: 'issue', repoFullName: 'orbit-owner/app', number: 12 },
    ...overrides
  };
}

function setup(poll: NotificationPoll, options: { focused?: boolean; markRead?: () => Promise<void> } = {}) {
  const service = {
    poll: vi.fn(async () => poll),
    markRead: vi.fn(options.markRead ?? (async () => undefined))
  };
  const deliver = vi.fn();
  const notify = vi.fn();
  const center = new NotificationCenter({
    service,
    isFocused: () => options.focused ?? false,
    deliver,
    notify
  });
  return { center, service, deliver, notify };
}

describe('NotificationCenter', () => {
  it('shows a desktop notice and no toast while the window is not focused', async () => {
    const { center, deliver, notify } = setup({
      pollIntervalMs: 60_000,
      delivery: { kind: 'items', items: [item('1')] }
    });

    const result = await center.pollOnce();

    expect(result).toEqual({ pollIntervalMs: 60_000 });
    expect(deliver).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith({
      threadId: '1',
      title: 'orbit-owner/app',
      body: 'Mention: Thread 1'
    });
  });

  it('pushes the in-app toast and no desktop notice while the window is focused', async () => {
    const { center, deliver, notify } = setup(
      { delivery: { kind: 'items', items: [item('1')] } },
      { focused: true }
    );

    await center.pollOnce();

    expect(deliver).toHaveBeenCalledWith({ kind: 'items', items: [item('1')] });
    expect(notify).not.toHaveBeenCalled();
  });

  it('drops the quiet startup summary while unfocused, because nothing should interrupt a hidden window', async () => {
    const { center, deliver, notify } = setup({ delivery: { kind: 'summary', count: 4, desktop: false } });

    await center.pollOnce();

    expect(deliver).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('does nothing when a poll has nothing new', async () => {
    const { center, deliver, notify } = setup({ delivery: null });

    await center.pollOnce();

    expect(deliver).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it('marks a notification read and returns its target when the user opens it', async () => {
    const { center, service } = setup({ delivery: { kind: 'items', items: [item('1')] } });
    await center.pollOnce();

    const result = await center.open('1');

    expect(service.markRead).toHaveBeenCalledWith('1');
    expect(result).toEqual({
      target: { kind: 'issue', repoFullName: 'orbit-owner/app', number: 12 },
      markReadError: null
    });
  });

  it('still navigates when mark-read fails, reports the error, and keeps the thread available to retry', async () => {
    let attempts = 0;
    const { center, service } = setup(
      { delivery: { kind: 'items', items: [item('1')] } },
      {
        markRead: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('GitHub returned 500.');
        }
      }
    );
    await center.pollOnce();

    const first = await center.open('1');
    expect(first.target).toMatchObject({ number: 12 });
    expect(first.markReadError).toBe('GitHub returned 500.');

    const retry = await center.open('1');
    expect(retry.markReadError).toBeNull();
    expect(service.markRead).toHaveBeenCalledTimes(2);
  });

  it('returns no target for an unknown or summary thread without calling GitHub', async () => {
    const { center, service } = setup({ delivery: { kind: 'summary', count: 5, desktop: true } });
    await center.pollOnce();

    await expect(center.open('nope')).resolves.toEqual({ target: null, markReadError: null });
    expect(service.markRead).not.toHaveBeenCalled();
  });

  it('lets poll errors reach the refresh engine so it can back off', async () => {
    const { center, service } = setup({ delivery: null });
    service.poll.mockRejectedValueOnce(new Error('offline'));

    await expect(center.pollOnce()).rejects.toThrow('offline');
  });
});
