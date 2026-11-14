// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/src/App';
import type { AuthStatus } from '../../../src/shared/auth';
import type { OrbitApi } from '../../../src/shared/ipc';
import type { OrbitSettings, PersonalRepo } from '../../../src/shared/ipc';

type StatusListener = (status: AuthStatus) => void;

function installBridge(
  overrides: {
    getInfo?: OrbitApi['app']['getInfo'];
    status?: AuthStatus;
    repos?: PersonalRepo[];
  } = {}
): { listeners: Set<StatusListener>; api: OrbitApi; settings: OrbitSettings } {
  const listeners = new Set<StatusListener>();
  const settings: OrbitSettings = {
    pinnedRepoIds: [],
    customViews: [],
    theme: 'dark',
    windowState: { width: 1100, height: 720, maximized: false, detailsWidth: 320 }
  };
  const api: OrbitApi = {
    app: {
      getInfo: overrides.getInfo ?? (async () => ({ name: 'Orbit', version: '0.1.0', platform: 'win32' })),
      openExternal: vi.fn(async () => ({ opened: true }))
    },
    auth: {
      getStatus: vi.fn(async () => overrides.status ?? { kind: 'signed-out' }),
      startSignIn: vi.fn(async () => ({ kind: 'signed-out' }) as AuthStatus),
      cancelSignIn: vi.fn(async () => ({ kind: 'signed-out' }) as AuthStatus),
      signOut: vi.fn(async () => ({ kind: 'signed-out' }) as AuthStatus),
      onStatusChanged: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }
    },
    repos: { list: vi.fn(async () => overrides.repos ?? []) },
    settings: {
      get: vi.fn(async () => settings),
      update: vi.fn(async (update) => Object.assign(settings, update))
    }
  };
  window.orbit = api;
  return { listeners, api, settings };
}

describe('App', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    delete document.documentElement.dataset['orbitReady'];
  });

  it('shows app name, version, and platform from the preload bridge', async () => {
    installBridge();
    render(<App />);
    expect(await screen.findByText('Orbit 0.1.0 on win32')).toBeInTheDocument();
  });

  it('marks the document ready only after the bridge calls resolve', async () => {
    installBridge({ getInfo: async () => ({ name: 'Orbit', version: '0.1.0', platform: 'linux' }) });
    render(<App />);
    await waitFor(() => {
      expect(document.documentElement.dataset['orbitReady']).toBe('true');
    });
  });

  it('stays not-ready while the app info call is pending', () => {
    installBridge({ getInfo: () => new Promise(() => {}) });
    render(<App />);
    expect(screen.getByText('Starting…')).toBeInTheDocument();
    expect(document.documentElement.dataset['orbitReady']).toBeUndefined();
  });

  describe('signed-out start screen', () => {
    it('offers Sign in with GitHub and starts the device flow on click', async () => {
      const { api } = installBridge();
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }));
      expect(api.auth.startSignIn).toHaveBeenCalledOnce();
    });

    it('explains why the last sign-in ended', async () => {
      installBridge({
        status: { kind: 'signed-out', notice: 'Sign-in was denied on GitHub.' }
      });
      render(<App />);
      expect(await screen.findByText('Sign-in was denied on GitHub.')).toBeInTheDocument();
    });
  });

  describe('device flow', () => {
    const pending: AuthStatus = {
      kind: 'device-pending',
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://github.com/login/device',
      expiresAt: Date.now() + 900_000
    };

    it('shows the user code with copy and open-browser actions', async () => {
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      const { api } = installBridge({ status: pending });
      render(<App />);

      expect(await screen.findByText('WDJB-MJHT')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
      expect(writeText).toHaveBeenCalledWith('WDJB-MJHT');

      fireEvent.click(screen.getByRole('button', { name: 'Open GitHub in browser' }));
      expect(api.app.openExternal).toHaveBeenCalledWith('https://github.com/login/device');
    });

    it('lets the user cancel while waiting', async () => {
      const { api } = installBridge({ status: pending });
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
      expect(api.auth.cancelSignIn).toHaveBeenCalledOnce();
    });
  });

  describe('signed-in identity', () => {
    it('shows the authenticated account', async () => {
      installBridge({
        status: { kind: 'signed-in', sessionId: 1, login: 'chetjones003', persistent: true }
      });
      render(<App />);
      expect(await screen.findByText('Signed in as @chetjones003')).toBeInTheDocument();
    });

    it('warns before signing out and only signs out when confirmed', async () => {
      const { api } = installBridge({
        status: { kind: 'signed-in', sessionId: 1, login: 'chetjones003', persistent: true }
      });
      vi.mocked(window.confirm).mockReturnValueOnce(false);
      render(<App />);
      fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
      expect(window.confirm).toHaveBeenCalled();
      expect(api.auth.signOut).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
      expect(api.auth.signOut).toHaveBeenCalledOnce();
    });

    it('warns when sign-in will not survive quitting', async () => {
      installBridge({
        status: {
          kind: 'signed-in',
          sessionId: 1,
          login: 'chetjones003',
          persistent: false,
          notice: 'Sign-in will not survive quitting Orbit: credentials could not be saved.'
        }
      });
      render(<App />);
      expect(await screen.findByText(/will not survive quitting Orbit/)).toBeInTheDocument();
    });
  });

  it('asks the user to sign in again when the session needs reauthentication', async () => {
    const { api } = installBridge({
      status: {
        kind: 'reauth-required',
        sessionId: 1,
        login: 'chetjones003',
        notice: 'Your GitHub sign-in has expired. Sign in again to continue.'
      }
    });
    render(<App />);
    expect(await screen.findByText(/sign-in has expired/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' }));
    expect(api.auth.startSignIn).toHaveBeenCalledOnce();
  });

  it('follows status pushed from main without a reload', async () => {
    const { listeners } = installBridge();
    render(<App />);
    await screen.findByRole('button', { name: 'Sign in with GitHub' });
    act(() => {
      for (const listener of listeners) {
        listener({ kind: 'signed-in', sessionId: 2, login: 'chetjones003', persistent: true });
      }
    });
    expect(await screen.findByText('Signed in as @chetjones003')).toBeInTheDocument();
  });

  it('renders accessible workspace landmarks and loads personal repos after sign-in', async () => {
    const repo: PersonalRepo = {
      id: 10,
      name: 'orbit',
      fullName: 'chetjones003/orbit',
      description: 'Work tracker',
      isPrivate: false,
      isFork: false,
      isArchived: false,
      defaultBranch: 'main',
      updatedAt: '2026-01-01',
      htmlUrl: 'https://github.com/chetjones003/orbit'
    };
    const { api } = installBridge({
      status: { kind: 'signed-in', sessionId: 1, login: 'chetjones003', persistent: true },
      repos: [repo]
    });
    render(<App />);
    expect(await screen.findByRole('navigation', { name: 'Primary navigation' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Open chetjones003/orbit' })).toBeInTheDocument();
    expect(api.repos.list).toHaveBeenCalledOnce();
    expect(screen.getByRole('complementary', { name: 'Repository details' })).toBeInTheDocument();
  });

  it('pins repositories, filters forks and archived repos, and shows archived repositories as read only', async () => {
    const repos: PersonalRepo[] = [
      {
        id: 10,
        name: 'normal',
        fullName: 'chet/normal',
        description: null,
        isPrivate: false,
        isFork: false,
        isArchived: false,
        defaultBranch: 'main',
        updatedAt: '2026-01-01',
        htmlUrl: 'https://github.com/chet/normal'
      },
      {
        id: 11,
        name: 'fork',
        fullName: 'chet/fork',
        description: null,
        isPrivate: false,
        isFork: true,
        isArchived: false,
        defaultBranch: 'main',
        updatedAt: '2026-01-01',
        htmlUrl: 'https://github.com/chet/fork'
      },
      {
        id: 12,
        name: 'old',
        fullName: 'chet/old',
        description: null,
        isPrivate: false,
        isFork: false,
        isArchived: true,
        defaultBranch: 'main',
        updatedAt: '2026-01-01',
        htmlUrl: 'https://github.com/chet/old'
      }
    ];
    const { api } = installBridge({
      status: { kind: 'signed-in', sessionId: 1, login: 'chet', persistent: true },
      repos
    });
    render(<App />);
    const normal = await screen.findByRole('button', { name: 'Open chet/normal' });
    expect(screen.queryByRole('button', { name: 'Open chet/fork' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pin normal' }));
    await waitFor(() => expect(api.settings.update).toHaveBeenCalledWith({ pinnedRepoIds: [10] }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show forks & archived' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open chet/old, read only' }));
    expect(await screen.findByText('Archived repositories are read only.')).toBeInTheDocument();
    fireEvent.click(normal);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse details panel' }));
    expect(screen.queryByRole('complementary', { name: 'Repository details' })).not.toBeInTheDocument();
  });
});
