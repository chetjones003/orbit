import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../../src/shared/ipc';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
}));

vi.mock('electron', () => ({
  app: { getName: () => 'Orbit', getVersion: () => '0.1.0' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, fn);
    }
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: vi.fn() },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  protocol: {}
}));

import { registerIpcHandlers } from '../../../src/main/ipc';

const trusted = { senderFrame: { url: 'orbit://app/index.html' } };
const untrusted = { senderFrame: { url: 'https://evil.example/' } };

function invoke(channel: string, event: unknown, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, ...args);
}

function reviewService() {
  return {
    getPullDetail: vi.fn(),
    getPullReviewState: vi.fn(async () => ({ headSha: 'head-1', isOwnPull: false, pending: null })),
    addReviewComment: vi.fn(async () => ({ kind: 'new-commits', headSha: 'head-2' })),
    replyToReviewThread: vi.fn(async () => ({ kind: 'new-commits', headSha: 'head-2' })),
    setReviewThreadResolved: vi.fn(async () => true),
    submitReview: vi.fn(async () => ({ kind: 'submitted' }))
  };
}

describe('review IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
  });

  it('forwards review state, comments, replies, resolve, and submit from trusted renderers', async () => {
    const issues = reviewService();
    registerIpcHandlers({ issues: issues as never });
    const anchor = { path: 'src/a.ts', side: 'RIGHT', line: 4 };

    await expect(invoke(IpcChannels.pullsReviewState, trusted, 'orbit-owner/app', 7)).resolves.toEqual({
      headSha: 'head-1',
      isOwnPull: false,
      pending: null
    });
    expect(issues.getPullReviewState).toHaveBeenCalledWith('orbit-owner/app', 7);

    await invoke(IpcChannels.pullsReviewComment, trusted, 'orbit-owner/app', 7, {
      anchor,
      body: 'Nit',
      reviewedHeadSha: 'head-1'
    });
    expect(issues.addReviewComment).toHaveBeenCalledWith('orbit-owner/app', 7, {
      anchor,
      body: 'Nit',
      reviewedHeadSha: 'head-1'
    });

    await invoke(IpcChannels.pullsReviewReply, trusted, 'orbit-owner/app', 7, {
      threadId: 'T1',
      body: 'Reply',
      reviewedHeadSha: 'head-1'
    });
    expect(issues.replyToReviewThread).toHaveBeenCalledWith('orbit-owner/app', 7, {
      threadId: 'T1',
      body: 'Reply',
      reviewedHeadSha: 'head-1'
    });

    await invoke(IpcChannels.pullsReviewResolve, trusted, 'orbit-owner/app', 7, 'T1', true);
    expect(issues.setReviewThreadResolved).toHaveBeenCalledWith('orbit-owner/app', 7, 'T1', true);

    await invoke(IpcChannels.pullsReviewSubmit, trusted, 'orbit-owner/app', 7, {
      event: 'COMMENT',
      body: '',
      reviewedHeadSha: 'head-1'
    });
    expect(issues.submitReview).toHaveBeenCalledWith('orbit-owner/app', 7, {
      event: 'COMMENT',
      body: '',
      reviewedHeadSha: 'head-1'
    });
  });

  it('rejects review calls from untrusted senders before the service sees them', () => {
    const issues = reviewService();
    registerIpcHandlers({ issues: issues as never });

    expect(() => invoke(IpcChannels.pullsReviewState, untrusted, 'orbit-owner/app', 7)).toThrow(
      'Untrusted IPC sender'
    );
    expect(() => invoke(IpcChannels.pullsReviewSubmit, untrusted, 'orbit-owner/app', 7, {})).toThrow(
      'Untrusted IPC sender'
    );
    expect(issues.getPullReviewState).not.toHaveBeenCalled();
    expect(issues.submitReview).not.toHaveBeenCalled();
  });
});
