import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectionStatus } from '../../../src/shared/connection';
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

import { registerIpcHandlers, type ConnectionPort } from '../../../src/main/ipc';

const trusted = { senderFrame: { url: 'orbit://app/index.html' } };
const untrusted = { senderFrame: { url: 'https://evil.example/' } };

function fakeConnection(): ConnectionPort & { emit(status: ConnectionStatus): void } {
  const listeners = new Set<(status: ConnectionStatus) => void>();
  const status: ConnectionStatus = { state: 'fresh', lastSuccessAt: 1, nextRetryAt: 2 };
  return {
    getStatus: vi.fn(() => status),
    refreshNow: vi.fn(async () => ({ started: true as const })),
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

describe('connection IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.sent.length = 0;
  });

  it('returns the current connection status to trusted renderers only', () => {
    registerIpcHandlers({ connection: fakeConnection(), diagnostics: { report: () => '' } });

    expect(invoke(IpcChannels.connectionGetStatus)).toEqual({
      state: 'fresh',
      lastSuccessAt: 1,
      nextRetryAt: 2
    });
    expect(() => invoke(IpcChannels.connectionGetStatus, untrusted)).toThrow('Untrusted IPC sender');
  });

  it('runs a manual refresh through the engine and returns its decision', async () => {
    const connection = fakeConnection();
    registerIpcHandlers({ connection, diagnostics: { report: () => '' } });

    await expect(invoke(IpcChannels.reposRefresh)).resolves.toEqual({ started: true });
    expect(connection.refreshNow).toHaveBeenCalledTimes(1);
    expect(() => invoke(IpcChannels.reposRefresh, untrusted)).toThrow('Untrusted IPC sender');
  });

  it('pushes each status change to every window', () => {
    const connection = fakeConnection();
    registerIpcHandlers({ connection, diagnostics: { report: () => '' } });

    const next: ConnectionStatus = { state: 'offline', lastSuccessAt: 1, nextRetryAt: 3 };
    connection.emit(next);

    expect(mocks.sent).toEqual([{ channel: IpcChannels.connectionStatusChanged, payload: next }]);
  });

  it('returns the redacted diagnostics report on request', () => {
    registerIpcHandlers({
      connection: fakeConnection(),
      diagnostics: { report: () => 'refresh offline network' }
    });

    expect(invoke(IpcChannels.diagnosticsGetReport)).toBe('refresh offline network');
    expect(() => invoke(IpcChannels.diagnosticsGetReport, untrusted)).toThrow('Untrusted IPC sender');
  });
});
