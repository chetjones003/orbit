import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels } from '../../../src/shared/ipc';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  sent: [] as Array<{ channel: string; payload: unknown }>
}));

vi.mock('electron', () => ({
  app: { getName: () => 'Orbit', getVersion: () => '0.1.0' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, fn);
    }
  },
  BrowserWindow: {
    getAllWindows: () => [
      { webContents: { send: (channel: string, payload: unknown) => mocks.sent.push({ channel, payload }) } }
    ]
  },
  shell: { openExternal: vi.fn() },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  protocol: {}
}));

import { broadcast, registerIpcHandlers, type NotificationsPort } from '../../../src/main/ipc';

const trusted = { senderFrame: { url: 'orbit://app/index.html' } };
const untrusted = { senderFrame: { url: 'https://evil.example/' } };

function invoke(channel: string, event: unknown = trusted, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, ...args);
}

describe('notification IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.sent.length = 0;
  });

  it('opens a notification for trusted renderers and returns its target and mark-read result', async () => {
    const notifications: NotificationsPort = {
      open: vi.fn(async () => ({
        target: { kind: 'pull' as const, repoFullName: 'orbit-owner/app', number: 30 },
        markReadError: null
      }))
    };
    registerIpcHandlers({ notifications, diagnostics: { report: () => '', record: async () => undefined } });

    await expect(invoke(IpcChannels.notificationsOpen, trusted, '42')).resolves.toEqual({
      target: { kind: 'pull', repoFullName: 'orbit-owner/app', number: 30 },
      markReadError: null
    });
    expect(notifications.open).toHaveBeenCalledWith('42');
  });

  it('refuses to open a notification for an untrusted sender', () => {
    registerIpcHandlers({
      notifications: { open: vi.fn() },
      diagnostics: { report: () => '', record: async () => undefined }
    });

    expect(() => invoke(IpcChannels.notificationsOpen, untrusted, '42')).toThrow('Untrusted IPC sender');
  });

  it('rejects a thread id that is not a short string', () => {
    const open = vi.fn();
    registerIpcHandlers({
      notifications: { open },
      diagnostics: { report: () => '', record: async () => undefined }
    });

    expect(() => invoke(IpcChannels.notificationsOpen, trusted, 42)).toThrow('Invalid notification');
    expect(() => invoke(IpcChannels.notificationsOpen, trusted, 'x'.repeat(65))).toThrow(
      'Invalid notification'
    );
    expect(open).not.toHaveBeenCalled();
  });

  it('broadcasts pushes to every window on the given channel', () => {
    broadcast(IpcChannels.notificationsDelivered, { kind: 'summary', count: 2, desktop: false });

    expect(mocks.sent).toEqual([
      { channel: IpcChannels.notificationsDelivered, payload: { kind: 'summary', count: 2, desktop: false } }
    ]);
  });
});
