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

function makeIssues() {
  return {
    listIssues: vi.fn(),
    getIssueDetail: vi.fn(),
    getPullDetail: vi.fn(),
    createIssue: vi.fn(async () => ({ summary: {}, body: '', bodyHtml: '' })),
    updateIssue: vi.fn(async () => ({ kind: 'saved' as const, issue: {} })),
    updateIssueFields: vi.fn(async () => ({})),
    setIssueState: vi.fn(async () => ({})),
    getRepoOptions: vi.fn(async () => ({ labels: [], assignees: [], milestones: [] })),
    setTaskItem: vi.fn(async () => ({ kind: 'saved' as const, issue: {} }))
  };
}

describe('issue editing IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
  });

  it('forwards every editing operation from a trusted renderer to the service with its arguments', async () => {
    const issues = makeIssues();
    registerIpcHandlers({ issues: issues as never, comments: undefined });

    await invoke(IpcChannels.issuesCreate, trusted, 'orbit-owner/app', { title: 'T', body: 'B' });
    await invoke(
      IpcChannels.issuesUpdate,
      trusted,
      'orbit-owner/app',
      4,
      { title: 'T', body: 'B' },
      { title: 'old', body: 'old body' }
    );
    await invoke(IpcChannels.issuesUpdateFields, trusted, 'orbit-owner/app', 4, {
      labels: ['bug'],
      assignees: [],
      milestoneNumber: null
    });
    await invoke(IpcChannels.issuesSetState, trusted, 'orbit-owner/app', 4, 'closed', 'not_planned');
    await invoke(IpcChannels.issuesRepoOptions, trusted, 'orbit-owner/app');
    await invoke(IpcChannels.issuesSetTask, trusted, 'orbit-owner/app', 4, {
      index: 1,
      checked: true,
      expectedBody: 'x'
    });

    expect(issues.createIssue).toHaveBeenCalledWith('orbit-owner/app', { title: 'T', body: 'B' });
    expect(issues.updateIssue).toHaveBeenCalledWith(
      'orbit-owner/app',
      4,
      { title: 'T', body: 'B' },
      { title: 'old', body: 'old body' }
    );
    expect(issues.updateIssueFields).toHaveBeenCalledWith('orbit-owner/app', 4, {
      labels: ['bug'],
      assignees: [],
      milestoneNumber: null
    });
    expect(issues.setIssueState).toHaveBeenCalledWith('orbit-owner/app', 4, 'closed', 'not_planned');
    expect(issues.getRepoOptions).toHaveBeenCalledWith('orbit-owner/app');
    expect(issues.setTaskItem).toHaveBeenCalledWith('orbit-owner/app', 4, {
      index: 1,
      checked: true,
      expectedBody: 'x'
    });
  });

  it('refuses every editing operation from an untrusted sender before the service sees it', () => {
    const issues = makeIssues();
    registerIpcHandlers({ issues: issues as never });

    const channels = [
      IpcChannels.issuesCreate,
      IpcChannels.issuesUpdate,
      IpcChannels.issuesUpdateFields,
      IpcChannels.issuesSetState,
      IpcChannels.issuesRepoOptions,
      IpcChannels.issuesSetTask
    ];
    for (const channel of channels) {
      expect(() => invoke(channel, untrusted, 'orbit-owner/app', 4)).toThrow(/Untrusted/);
    }
    expect(issues.createIssue).not.toHaveBeenCalled();
    expect(issues.updateIssue).not.toHaveBeenCalled();
    expect(issues.updateIssueFields).not.toHaveBeenCalled();
    expect(issues.setIssueState).not.toHaveBeenCalled();
    expect(issues.getRepoOptions).not.toHaveBeenCalled();
    expect(issues.setTaskItem).not.toHaveBeenCalled();
  });
});
