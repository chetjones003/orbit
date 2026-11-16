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
    getIssueLinks: vi.fn(),
    getPullDetail: vi.fn(),
    createIssue: vi.fn(),
    updateIssue: vi.fn(),
    updateIssueFields: vi.fn(),
    setIssueState: vi.fn(),
    getRepoOptions: vi.fn(),
    setTaskItem: vi.fn(),
    uploadAttachment: vi.fn(async () => ({ kind: 'uploaded' as const, url: 'https://github.com/a/b' }))
  };
}

describe('attachments:upload IPC handler', () => {
  beforeEach(() => {
    mocks.handlers.clear();
  });

  it('forwards an upload from a trusted renderer to the issue service', async () => {
    const issues = makeIssues();
    registerIpcHandlers({ issues });
    const bytes = new Uint8Array([1, 2, 3]);

    const result = await invoke(
      IpcChannels.attachmentsUpload,
      trusted,
      'orbit-owner/app',
      {
        name: 'shot.png',
        bytes
      },
      { acknowledgedPublic: true }
    );

    expect(result).toEqual({ kind: 'uploaded', url: 'https://github.com/a/b' });
    expect(issues.uploadAttachment).toHaveBeenCalledWith(
      'orbit-owner/app',
      { name: 'shot.png', bytes },
      { acknowledgedPublic: true }
    );
  });

  it('rejects an upload from an untrusted sender before the service sees it', () => {
    const issues = makeIssues();
    registerIpcHandlers({ issues });

    expect(() =>
      invoke(
        IpcChannels.attachmentsUpload,
        untrusted,
        'orbit-owner/app',
        {
          name: 'shot.png',
          bytes: new Uint8Array([1])
        },
        { acknowledgedPublic: false }
      )
    ).toThrow('Untrusted IPC sender');
    expect(issues.uploadAttachment).not.toHaveBeenCalled();
  });

  it('rejects a payload that is not a file with bytes', () => {
    const issues = makeIssues();
    registerIpcHandlers({ issues });

    expect(() =>
      invoke(
        IpcChannels.attachmentsUpload,
        trusted,
        'orbit-owner/app',
        { name: 42, bytes: 'text' },
        {
          acknowledgedPublic: false
        }
      )
    ).toThrow('Choose a file to attach.');
    expect(issues.uploadAttachment).not.toHaveBeenCalled();
  });
});
