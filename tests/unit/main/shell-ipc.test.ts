import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannels, isShellAction } from '../../../src/shared/ipc';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  win: {
    isMaximized: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
    minimize: vi.fn(),
    maximize: vi.fn(),
    unmaximize: vi.fn(),
    close: vi.fn(),
    setFullScreen: vi.fn()
  },
  contents: {
    setZoomLevel: vi.fn(),
    getZoomLevel: vi.fn(() => 0),
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn()
  },
  quit: vi.fn()
}));

vi.mock('electron', () => ({
  app: { getName: () => 'Orbit', getVersion: () => '0.1.0', quit: mocks.quit },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, ...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, fn);
    }
  },
  BrowserWindow: {
    getAllWindows: () => [mocks.win],
    fromWebContents: () => mocks.win
  },
  shell: { openExternal: vi.fn() },
  session: { defaultSession: { webRequest: { onHeadersReceived: vi.fn() } } },
  protocol: {}
}));

import { registerIpcHandlers } from '../../../src/main/ipc';

const trusted = { senderFrame: { url: 'orbit://app/index.html' }, sender: mocks.contents };
const untrusted = { senderFrame: { url: 'https://evil.example/' }, sender: mocks.contents };

function invoke(channel: string, event: unknown, ...args: unknown[]): unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return handler(event, ...args);
}

describe('shell IPC handlers', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers({});
  });

  it('runs a known window command on the window that asked', () => {
    invoke(IpcChannels.shellControl, trusted, 'toggle-maximize');
    expect(mocks.win.maximize).toHaveBeenCalledTimes(1);

    mocks.win.isMaximized.mockReturnValueOnce(true);
    invoke(IpcChannels.shellControl, trusted, 'toggle-maximize');
    expect(mocks.win.unmaximize).toHaveBeenCalledTimes(1);

    invoke(IpcChannels.shellControl, trusted, 'minimize');
    invoke(IpcChannels.shellControl, trusted, 'close');
    expect(mocks.win.minimize).toHaveBeenCalledTimes(1);
    expect(mocks.win.close).toHaveBeenCalledTimes(1);
  });

  it('runs editing and zoom commands on the page, clamping zoom', () => {
    invoke(IpcChannels.shellControl, trusted, 'copy');
    expect(mocks.contents.copy).toHaveBeenCalledTimes(1);

    mocks.contents.getZoomLevel.mockReturnValueOnce(2.9);
    invoke(IpcChannels.shellControl, trusted, 'zoom-in');
    expect(mocks.contents.setZoomLevel).toHaveBeenLastCalledWith(3);

    invoke(IpcChannels.shellControl, trusted, 'zoom-reset');
    expect(mocks.contents.setZoomLevel).toHaveBeenLastCalledWith(0);
  });

  it('quits through app.quit, the real quit path', () => {
    invoke(IpcChannels.shellControl, trusted, 'quit');
    expect(mocks.quit).toHaveBeenCalledTimes(1);
  });

  it('refuses unknown commands and commands from untrusted senders', () => {
    expect(() => invoke(IpcChannels.shellControl, trusted, 'exec-anything')).toThrow(
      'Unknown window command'
    );
    expect(() => invoke(IpcChannels.shellControl, trusted, { action: 'close' })).toThrow(
      'Unknown window command'
    );
    expect(() => invoke(IpcChannels.shellControl, untrusted, 'close')).toThrow('Untrusted IPC sender');
    expect(mocks.win.close).not.toHaveBeenCalled();
  });

  it('reports maximize and full-screen state to trusted renderers', () => {
    mocks.win.isMaximized.mockReturnValue(true);
    expect(invoke(IpcChannels.shellGetState, trusted)).toEqual({ maximized: true, fullscreen: false });
    expect(() => invoke(IpcChannels.shellGetState, untrusted)).toThrow('Untrusted IPC sender');
  });
});

describe('isShellAction', () => {
  it('accepts only the named commands', () => {
    expect(isShellAction('quit')).toBe(true);
    expect(isShellAction('toggle-fullscreen')).toBe(true);
    expect(isShellAction('reload')).toBe(false);
    expect(isShellAction(undefined)).toBe(false);
    expect(isShellAction(7)).toBe(false);
  });
});
