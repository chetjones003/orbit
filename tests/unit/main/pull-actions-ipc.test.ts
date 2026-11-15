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

function actionsService() {
  return {
    getPullDetail: vi.fn(),
    getPullActions: vi.fn(async () => ({ headSha: 'head-1' })),
    mergePull: vi.fn(async () => ({ kind: 'merged', sha: 'merge-sha', branchDeleted: false })),
    setPullAutoMerge: vi.fn(async () => ({ kind: 'changed' })),
    setPullDraft: vi.fn(async () => ({ kind: 'changed' })),
    getPullWorkflowRuns: vi.fn(async () => []),
    rerunPullWorkflow: vi.fn(async () => ({ kind: 'changed' })),
    createPull: vi.fn(async () => ({ number: 9 })),
    listBranches: vi.fn(async () => ['main', 'feature'])
  };
}

describe('pull request action IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
  });

  it('forwards actions, merge, auto-merge, draft, re-runs, create, and branches from trusted renderers', async () => {
    const issues = actionsService();
    registerIpcHandlers({ issues: issues as never });

    await expect(invoke(IpcChannels.pullsActions, trusted, 'orbit-owner/app', 7)).resolves.toEqual({
      headSha: 'head-1'
    });
    expect(issues.getPullActions).toHaveBeenCalledWith('orbit-owner/app', 7);

    const merge = { method: 'squash', deleteBranch: true, expectedHeadSha: 'head-1' };
    await expect(invoke(IpcChannels.pullsMerge, trusted, 'orbit-owner/app', 7, merge)).resolves.toEqual({
      kind: 'merged',
      sha: 'merge-sha',
      branchDeleted: false
    });
    expect(issues.mergePull).toHaveBeenCalledWith('orbit-owner/app', 7, merge);

    const autoMerge = { enabled: true, method: 'merge', expectedHeadSha: 'head-1' };
    await invoke(IpcChannels.pullsAutoMerge, trusted, 'orbit-owner/app', 7, autoMerge);
    expect(issues.setPullAutoMerge).toHaveBeenCalledWith('orbit-owner/app', 7, autoMerge);

    await invoke(IpcChannels.pullsDraft, trusted, 'orbit-owner/app', 7, true, 'head-1');
    expect(issues.setPullDraft).toHaveBeenCalledWith('orbit-owner/app', 7, true, 'head-1');

    await invoke(IpcChannels.pullsRuns, trusted, 'orbit-owner/app', 7);
    expect(issues.getPullWorkflowRuns).toHaveBeenCalledWith('orbit-owner/app', 7);

    await invoke(IpcChannels.pullsRerun, trusted, 'orbit-owner/app', 11, 'failed', 'head-1');
    expect(issues.rerunPullWorkflow).toHaveBeenCalledWith('orbit-owner/app', 11, 'failed', 'head-1');

    const create = { title: 'Add x', body: '', head: 'feature', base: 'main', draft: false };
    await expect(invoke(IpcChannels.pullsCreate, trusted, 'orbit-owner/app', create)).resolves.toEqual({
      number: 9
    });
    expect(issues.createPull).toHaveBeenCalledWith('orbit-owner/app', create);

    await expect(invoke(IpcChannels.pullsBranches, trusted, 'orbit-owner/app')).resolves.toEqual([
      'main',
      'feature'
    ]);
  });

  it('refuses action calls from untrusted senders before reaching the service', () => {
    const issues = actionsService();
    registerIpcHandlers({ issues: issues as never });
    expect(() => invoke(IpcChannels.pullsMerge, untrusted, 'orbit-owner/app', 7, {})).toThrow(/Untrusted/);
    expect(issues.mergePull).not.toHaveBeenCalled();
  });
});
