import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IssueListPage, IssueDetail } from '../../../src/shared/issues';
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

const emptyPage: IssueListPage = { items: [], page: 1, hasNextPage: false, partial: false };
const emptyDetail = {} as IssueDetail;

function invoke(channel: string, event: unknown, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, ...args);
}

describe('issue IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
  });

  it('forwards list queries from trusted renderers and returns the page', async () => {
    const issues = {
      listIssues: vi.fn(async () => emptyPage),
      getIssueDetail: vi.fn(async () => emptyDetail)
    };
    registerIpcHandlers({ issues });
    const query = { repoFullName: 'orbit-owner/app', state: 'open', page: 1 };

    await expect(invoke(IpcChannels.issuesList, trusted, query)).resolves.toEqual(emptyPage);
    expect(issues.listIssues).toHaveBeenCalledWith(query);
  });

  it('forwards detail requests with the repo name and number', async () => {
    const issues = {
      listIssues: vi.fn(async () => emptyPage),
      getIssueDetail: vi.fn(async () => emptyDetail)
    };
    registerIpcHandlers({ issues });

    await invoke(IpcChannels.issuesDetail, trusted, 'orbit-owner/app', 12);

    expect(issues.getIssueDetail).toHaveBeenCalledWith('orbit-owner/app', 12);
  });

  it.each([
    ['list', IpcChannels.issuesList, [{ repoFullName: 'orbit-owner/app', state: 'open', page: 1 }]],
    ['detail', IpcChannels.issuesDetail, ['orbit-owner/app', 12]]
  ])('rejects %s from an untrusted sender before the service runs', (_label, channel, args) => {
    const issues = {
      listIssues: vi.fn(async () => emptyPage),
      getIssueDetail: vi.fn(async () => emptyDetail)
    };
    registerIpcHandlers({ issues });

    expect(() => invoke(channel, untrusted, ...args)).toThrow('Untrusted IPC sender');
    expect(issues.listIssues).not.toHaveBeenCalled();
    expect(issues.getIssueDetail).not.toHaveBeenCalled();
  });
});
