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

import { registerIpcHandlers, type RefreshPort } from '../../../src/main/ipc';

const trusted = { senderFrame: { url: 'orbit://app/index.html' } };
const untrusted = { senderFrame: { url: 'https://evil.example/' } };

function fakeConnection(): RefreshPort & { emit(status: ConnectionStatus): void } {
  const listeners = new Set<(status: ConnectionStatus) => void>();
  const status: ConnectionStatus = { state: 'fresh', lastSuccessAt: 1, nextRetryAt: 2 };
  return {
    getStatus: vi.fn(() => status),
    refreshNow: vi.fn(async () => ({ started: true as const })),
    wake: vi.fn(async () => ({ started: true as const })),
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

describe('refresh IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.sent.length = 0;
  });

  it('returns the current refresh status to trusted renderers only', () => {
    registerIpcHandlers({
      refresh: fakeConnection(),
      diagnostics: { report: () => '', record: async () => undefined }
    });

    expect(invoke(IpcChannels.refreshGetStatus)).toEqual({
      state: 'fresh',
      lastSuccessAt: 1,
      nextRetryAt: 2
    });
    expect(() => invoke(IpcChannels.refreshGetStatus, untrusted)).toThrow('Untrusted IPC sender');
  });

  it('runs a manual refresh through the engine and returns its decision', async () => {
    const refresh = fakeConnection();
    registerIpcHandlers({ refresh, diagnostics: { report: () => '', record: async () => undefined } });

    await expect(invoke(IpcChannels.reposRefresh)).resolves.toEqual({ started: true });
    expect(refresh.refreshNow).toHaveBeenCalledTimes(1);
    expect(() => invoke(IpcChannels.reposRefresh, untrusted)).toThrow('Untrusted IPC sender');
  });

  it('pushes each status change to every window', () => {
    const refresh = fakeConnection();
    registerIpcHandlers({ refresh, diagnostics: { report: () => '', record: async () => undefined } });

    const next: ConnectionStatus = { state: 'offline', lastSuccessAt: 1, nextRetryAt: 3 };
    refresh.emit(next);

    expect(mocks.sent).toEqual([{ channel: IpcChannels.refreshStatusChanged, payload: next }]);
  });

  it('returns the redacted diagnostics report on request', () => {
    registerIpcHandlers({
      refresh: fakeConnection(),
      diagnostics: { report: () => 'refresh offline network', record: async () => undefined }
    });

    expect(invoke(IpcChannels.diagnosticsGetReport)).toBe('refresh offline network');
    expect(() => invoke(IpcChannels.diagnosticsGetReport, untrusted)).toThrow('Untrusted IPC sender');
  });
});

describe('diagnostics record IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear();
  });

  it('records a renderer failure by scope and code only, rejecting anything that looks like content', async () => {
    const record = vi.fn(async () => undefined);
    registerIpcHandlers({ refresh: fakeConnection(), diagnostics: { report: () => '', record } });

    await invoke(IpcChannels.diagnosticsRecord, trusted, { scope: 'repos', code: 'load-failed' });
    expect(record).toHaveBeenCalledWith({ level: 'warn', scope: 'repos', code: 'load-failed', message: '' });

    expect(() =>
      invoke(IpcChannels.diagnosticsRecord, trusted, { scope: 'repos', code: 'token ghp_abc123' })
    ).toThrow('Invalid diagnostic');
    expect(() =>
      invoke(IpcChannels.diagnosticsRecord, untrusted, { scope: 'repos', code: 'load-failed' })
    ).toThrow('Untrusted IPC sender');
  });
});

describe('refresh wake IPC', () => {
  beforeEach(() => {
    mocks.handlers.clear();
  });

  it('lets the renderer request an immediate retry after an outage, from trusted senders only', async () => {
    const wake = vi.fn(async () => ({ started: true as const }));
    registerIpcHandlers({
      refresh: { ...fakeConnection(), wake },
      diagnostics: { report: () => '', record: async () => undefined }
    });

    await expect(invoke(IpcChannels.refreshWake)).resolves.toEqual({ started: true });
    expect(wake).toHaveBeenCalledTimes(1);
    expect(() => invoke(IpcChannels.refreshWake, untrusted)).toThrow('Untrusted IPC sender');
  });
});
