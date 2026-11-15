import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UpdateStatus } from '../../../src/shared/updates';
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

import { registerIpcHandlers, type UpdatePort } from '../../../src/main/ipc';

const trusted = { senderFrame: { url: 'orbit://app/index.html' } };
const untrusted = { senderFrame: { url: 'https://evil.example/' } };

function fakeUpdates(status: UpdateStatus = { kind: 'idle' }): UpdatePort & { emit(s: UpdateStatus): void } {
  const listeners = new Set<(s: UpdateStatus) => void>();
  return {
    getStatus: vi.fn(() => status),
    checkNow: vi.fn(async () => status),
    download: vi.fn(async () => status),
    install: vi.fn(async () => undefined),
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (next) => listeners.forEach((listener) => listener(next))
  };
}

function invoke(channel: string, event: unknown = trusted, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, ...args);
}

const diagnostics = { report: () => '', record: async () => undefined };

describe('update IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.sent.length = 0;
  });

  it('returns the update status to trusted renderers only', () => {
    const updates = fakeUpdates({ kind: 'up-to-date', checkedAt: 5 });
    registerIpcHandlers({ updates, diagnostics });
    expect(invoke(IpcChannels.updatesGetStatus)).toEqual({ kind: 'up-to-date', checkedAt: 5 });
    expect(() => invoke(IpcChannels.updatesGetStatus, untrusted)).toThrow('Untrusted IPC sender');
  });

  it('runs a manual check through the service and returns the resulting status', async () => {
    const updates = fakeUpdates();
    registerIpcHandlers({ updates, diagnostics });
    await expect(invoke(IpcChannels.updatesCheck)).resolves.toEqual({ kind: 'idle' });
    expect(updates.checkNow).toHaveBeenCalledTimes(1);
    expect(() => invoke(IpcChannels.updatesCheck, untrusted)).toThrow('Untrusted IPC sender');
  });

  it('installs only through the service and only for trusted renderers', async () => {
    const updates = fakeUpdates();
    registerIpcHandlers({ updates, diagnostics });
    await invoke(IpcChannels.updatesInstall);
    expect(updates.install).toHaveBeenCalledTimes(1);
    expect(() => invoke(IpcChannels.updatesInstall, untrusted)).toThrow('Untrusted IPC sender');
    expect(updates.install).toHaveBeenCalledTimes(1);
  });

  it('downloads an offered update only when the renderer asks, and only for trusted renderers', async () => {
    const updates = fakeUpdates();
    registerIpcHandlers({ updates, diagnostics });
    await expect(invoke(IpcChannels.updatesDownload)).resolves.toEqual({ kind: 'idle' });
    expect(updates.download).toHaveBeenCalledTimes(1);
    expect(() => invoke(IpcChannels.updatesDownload, untrusted)).toThrow('Untrusted IPC sender');
    expect(updates.download).toHaveBeenCalledTimes(1);
  });

  it('pushes each status change to the renderer', () => {
    const updates = fakeUpdates();
    registerIpcHandlers({ updates, diagnostics });
    updates.emit({ kind: 'checking' });
    expect(mocks.sent).toContainEqual({
      channel: IpcChannels.updatesStatusChanged,
      payload: { kind: 'checking' }
    });
  });
});
