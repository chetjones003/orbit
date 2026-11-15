import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueComment } from '../../../src/shared/issues';
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

const SAVED: IssueComment = {
  id: 501,
  authorLogin: 'orbit-owner',
  createdAt: '2026-01-05T00:00:00Z',
  updatedAt: '2026-01-05T00:00:00Z',
  htmlUrl: 'https://github.com/orbit-owner/app/issues/4#issuecomment-501',
  body: 'hello',
  bodyHtml: '<p>hello</p>'
};

function invoke(channel: string, event: unknown, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, ...args);
}

function makeIssues() {
  return {
    listIssues: vi.fn(),
    getIssueDetail: vi.fn(),
    getPullDetail: vi.fn(),
    previewMarkdown: vi.fn(async () => '<p>hello</p>'),
    createComment: vi.fn(async () => SAVED),
    updateComment: vi.fn(async () => ({ kind: 'saved' as const, comment: SAVED })),
    deleteComment: vi.fn(async () => undefined)
  };
}

describe('comment and preview IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
  });

  it('forwards preview, create, update, and delete from trusted renderers to the service', async () => {
    const issues = makeIssues();
    registerIpcHandlers({ comments: issues });

    await expect(invoke(IpcChannels.markdownPreview, trusted, 'orbit-owner/app', 'hello')).resolves.toBe(
      '<p>hello</p>'
    );
    await expect(invoke(IpcChannels.commentsCreate, trusted, 'orbit-owner/app', 4, 'hello')).resolves.toEqual(
      SAVED
    );
    await expect(
      invoke(IpcChannels.commentsUpdate, trusted, 'orbit-owner/app', 501, 'hello', SAVED.updatedAt)
    ).resolves.toEqual({ kind: 'saved', comment: SAVED });
    await expect(
      invoke(IpcChannels.commentsDelete, trusted, 'orbit-owner/app', 501)
    ).resolves.toBeUndefined();

    expect(issues.previewMarkdown).toHaveBeenCalledWith('orbit-owner/app', 'hello');
    expect(issues.createComment).toHaveBeenCalledWith('orbit-owner/app', 4, 'hello');
    expect(issues.updateComment).toHaveBeenCalledWith('orbit-owner/app', 501, 'hello', SAVED.updatedAt);
    expect(issues.deleteComment).toHaveBeenCalledWith('orbit-owner/app', 501);
  });

  it('rejects comment and preview calls from untrusted senders before the service sees them', () => {
    const issues = makeIssues();
    registerIpcHandlers({ comments: issues });

    expect(() => invoke(IpcChannels.markdownPreview, untrusted, 'orbit-owner/app', 'x')).toThrow('Untrusted');
    expect(() => invoke(IpcChannels.commentsCreate, untrusted, 'orbit-owner/app', 4, 'x')).toThrow(
      'Untrusted'
    );
    expect(() => invoke(IpcChannels.commentsDelete, untrusted, 'orbit-owner/app', 501)).toThrow('Untrusted');
    expect(issues.createComment).not.toHaveBeenCalled();
    expect(issues.deleteComment).not.toHaveBeenCalled();
  });
});
