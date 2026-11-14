import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthStatus } from '../../../src/shared/auth';
import { IpcChannels } from '../../../src/shared/ipc';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  windows: [] as Array<{ webContents: { send: (channel: string, payload: unknown) => void } }>
}));

vi.mock('electron', () => ({
  app: { getName: () => 'Orbit', getVersion: () => '0.1.0' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, fn);
    }
  },
  BrowserWindow: { getAllWindows: () => mocks.windows },
  shell: { openExternal: vi.fn() },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  protocol: {}
}));

import { registerIpcHandlers, type AuthPort } from '../../../src/main/ipc';

const trusted = { senderFrame: { url: 'orbit://app/index.html' } };
const untrusted = { senderFrame: { url: 'https://evil.example/' } };

function fakeAuth(): AuthPort & { emit(status: AuthStatus): void } {
  const listeners = new Set<(status: AuthStatus) => void>();
  const status: AuthStatus = { kind: 'signed-out' };
  return {
    getStatus: vi.fn(() => status),
    startSignIn: vi.fn(async () => ({
      kind: 'device-pending' as const,
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresAt: 0
    })),
    cancelSignIn: vi.fn(() => status),
    signOut: vi.fn(async () => status),
    onStatusChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (next) => listeners.forEach((listener) => listener(next))
  };
}

function invoke(channel: string, event: unknown = trusted): unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event);
}

describe('auth IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.windows.length = 0;
  });

  it('registers each auth channel when an auth service is provided', () => {
    registerIpcHandlers({ auth: fakeAuth() });
    for (const channel of [
      IpcChannels.authGetStatus,
      IpcChannels.authStartSignIn,
      IpcChannels.authCancelSignIn,
      IpcChannels.authSignOut
    ]) {
      expect(mocks.handlers.has(channel)).toBe(true);
    }
  });

  it('returns the current status to the app renderer', () => {
    const auth = fakeAuth();
    registerIpcHandlers({ auth });
    expect(invoke(IpcChannels.authGetStatus)).toEqual({ kind: 'signed-out' });
  });

  it('rejects auth calls from a non-app sender without reaching the service', () => {
    const auth = fakeAuth();
    registerIpcHandlers({ auth });
    expect(() => invoke(IpcChannels.authGetStatus, untrusted)).toThrow('Untrusted IPC sender');
    expect(() => invoke(IpcChannels.authSignOut, untrusted)).toThrow('Untrusted IPC sender');
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('delegates start, cancel, and sign-out to the service', async () => {
    const auth = fakeAuth();
    registerIpcHandlers({ auth });
    await invoke(IpcChannels.authStartSignIn);
    invoke(IpcChannels.authCancelSignIn);
    await invoke(IpcChannels.authSignOut);
    expect(auth.startSignIn).toHaveBeenCalledOnce();
    expect(auth.cancelSignIn).toHaveBeenCalledOnce();
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('pushes every status change to open windows', () => {
    const auth = fakeAuth();
    const send = vi.fn();
    mocks.windows.push({ webContents: { send } });
    registerIpcHandlers({ auth });
    const next: AuthStatus = { kind: 'signed-in', sessionId: 1, login: 'chetjones003', persistent: true };
    auth.emit(next);
    expect(send).toHaveBeenCalledWith(IpcChannels.authStatusChanged, next);
  });
});
