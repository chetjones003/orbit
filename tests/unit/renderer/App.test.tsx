// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectsStub } from './fakes/projects';
// Parallel test runs can slow the first render; allow more time than the 1s default before failing.
configure({ asyncUtilTimeout: 3000 });

vi.mock('../../../src/renderer/src/comments/CodeEditor', async () => {
  const { FakeCodeEditor } = await import('./fakes/fake-code-editor');
  return { CodeEditor: FakeCodeEditor };
});

import { App } from '../../../src/renderer/src/App';
import type { AuthStatus } from '../../../src/shared/auth';
import type { OrbitApi } from '../../../src/shared/ipc';
import type { OrbitSettings, PersonalRepo } from '../../../src/shared/ipc';
import type { ConnectionStatus, RefreshStart } from '../../../src/shared/connection';
import { drafts } from '../../../src/renderer/src/comments/draft-store';

type StatusListener = (status: AuthStatus) => void;
const refreshListeners = new Set<(status: ConnectionStatus) => void>();

function installBridge(
  overrides: {
    getInfo?: OrbitApi['app']['getInfo'];
    status?: AuthStatus;
    repos?: PersonalRepo[];
    refreshStatus?: ConnectionStatus;
    refreshStart?: RefreshStart;
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
    notifications: {
      open: vi.fn(async () => ({ target: null, markReadError: null })),
      onDelivered: () => () => undefined,
      onNavigate: () => () => undefined
    },
    updates: {
      getStatus: vi.fn(async () => ({ kind: 'idle' }) as const),
      check: vi.fn(async () => ({ kind: 'up-to-date', checkedAt: 0 }) as const),
      install: vi.fn(async () => undefined),
      onStatusChanged: vi.fn(() => () => undefined)
    },
    refresh: {
      wake: vi.fn(async () => ({ started: true }) as RefreshStart),
      getStatus: vi.fn(
        async () => overrides.refreshStatus ?? { state: 'idle', lastSuccessAt: null, nextRetryAt: null }
      ),
      onStatusChanged: (listener) => {
        refreshListeners.add(listener);
        return () => refreshListeners.delete(listener);
      }
    },
    repos: {
      list: vi.fn(async () => overrides.repos ?? []),
      refresh: vi.fn(async () => overrides.refreshStart ?? ({ started: true } as RefreshStart))
    },
    projects: projectsStub(),
    issues: {
      list: vi.fn(async () => ({ items: [], page: 1, hasNextPage: false, partial: false })),
      detail: vi.fn(async () => {
        throw new Error('not stubbed');
      })
    },
    diagnostics: {
      getReport: vi.fn(async () => 'report'),
      record: vi.fn(async () => undefined)
    },
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

  it('shows a status banner when GitHub is unreachable, keeping loaded repos visible', async () => {
    const repo: PersonalRepo = {
      id: 11,
      name: 'orbit',
      fullName: 'chetjones003/orbit',
      description: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      defaultBranch: 'main',
      updatedAt: '2026-01-01',
      htmlUrl: 'https://github.com/chetjones003/orbit'
    };
    installBridge({
      status: { kind: 'signed-in', sessionId: 1, login: 'chetjones003', persistent: true },
      repos: [repo],
      refreshStatus: {
        state: 'offline',
        lastSuccessAt: Date.now() - 60_000,
        nextRetryAt: Date.now() + 60_000
      }
    });
    render(<App />);
    expect(
      await screen.findByText(/Offline\. Last updated 1 min ago/, {}, { timeout: 3000 })
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Open chetjones003/orbit' })).toBeInTheDocument();
    expect(screen.getByText('Changes are paused until GitHub is reachable again.')).toBeInTheDocument();
  });

  it('asks main to refresh from the topbar and explains a cooldown instead of failing silently', async () => {
    const { api } = installBridge({
      status: { kind: 'signed-in', sessionId: 1, login: 'chetjones003', persistent: true },
      refreshStart: { started: false, reason: 'cooldown', retryAt: Date.now() + 30_000 }
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh repositories' }));
    expect(api.repos.refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Refresh is cooling down. Try again in a moment.')).toBeInTheDocument();
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

describe('App failure reporting', () => {
  afterEach(() => cleanup());

  it('records a failed repo load in main by scope and code, so Copy diagnostics includes it', async () => {
    const { api } = installBridge({
      status: { kind: 'signed-in', sessionId: 1, login: 'chetjones003', persistent: true }
    });
    api.repos.list = vi.fn(async () => {
      throw new Error('GitHub is unavailable.');
    });
    render(<App />);
    expect(await screen.findByText('GitHub is unavailable.')).toBeInTheDocument();
    expect(api.diagnostics.record).toHaveBeenCalledWith({ scope: 'repos', code: 'load-failed' });
  });
});

describe('App refresh triggers', () => {
  afterEach(() => cleanup());

  it('refetches on window focus (subject to cooldown) and asks main to wake when the network returns', async () => {
    const { api } = installBridge({
      status: { kind: 'signed-in', sessionId: 1, login: 'chetjones003', persistent: true }
    });
    render(<App />);
    await waitFor(() => expect(api.repos.list).toHaveBeenCalled());

    fireEvent(window, new Event('focus'));
    expect(api.refresh.wake).toHaveBeenCalledTimes(1);

    fireEvent(window, new Event('online'));
    expect(api.refresh.wake).toHaveBeenCalledTimes(2);
  });
});

describe('issues in the workspace', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens a repo issue list from the details panel, then shows one issue in the panel and the expanded view', async () => {
    const repo: PersonalRepo = {
      id: 1,
      name: 'app',
      fullName: 'chetjones003/app',
      description: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      defaultBranch: 'main',
      updatedAt: '2026-01-01T00:00:00Z',
      htmlUrl: 'https://github.com/chetjones003/app'
    };
    const summary = {
      id: 104,
      number: 4,
      title: 'Crash on save',
      state: 'open' as const,
      stateReason: null,
      assignees: [],
      milestone: null,
      authorLogin: 'someone',
      labels: [],
      commentCount: 0,
      createdAt: '2026-01-02T00:00:00Z',
      updatedAt: '2026-01-03T00:00:00Z',
      htmlUrl: 'https://github.com/chetjones003/app/issues/4'
    };
    const { api } = installBridge({
      status: { kind: 'signed-in', sessionId: 1, login: 'chetjones003', persistent: true },
      repos: [repo]
    });
    api.issues.list = vi.fn(async () => ({ items: [summary], page: 1, hasNextPage: false, partial: false }));
    api.issues.detail = vi.fn(async () => ({
      summary,
      bodyHtml: '<p>Body text</p>',
      comments: [],
      commentsPartial: false
    }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open chetjones003/app' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View issues' }));
    fireEvent.click(await screen.findByRole('button', { name: /Crash on save/ }));

    expect(await screen.findByText('Body text')).toBeInTheDocument();
    expect(api.issues.detail).toHaveBeenCalledWith('chetjones003/app', 4);

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(await screen.findByRole('button', { name: '← Back to issues' })).toBeInTheDocument();
  });

  it('creates an issue from the repo issue list and opens the new issue', async () => {
    const repo: PersonalRepo = {
      id: 1,
      name: 'app',
      fullName: 'chetjones003/app',
      description: null,
      isPrivate: false,
      isFork: false,
      isArchived: false,
      defaultBranch: 'main',
      updatedAt: '2026-01-01T00:00:00Z',
      htmlUrl: 'https://github.com/chetjones003/app'
    };
    const created = {
      id: 220,
      number: 12,
      title: 'Fresh bug',
      state: 'open' as const,
      stateReason: null,
      assignees: [],
      milestone: null,
      authorLogin: 'chetjones003',
      labels: [],
      commentCount: 0,
      createdAt: '2026-01-04T00:00:00Z',
      updatedAt: '2026-01-04T00:00:00Z',
      htmlUrl: 'https://github.com/chetjones003/app/issues/12'
    };
    const { api } = installBridge({
      status: { kind: 'signed-in', sessionId: 1, login: 'chetjones003', persistent: true },
      repos: [repo]
    });
    api.issues.list = vi.fn(async () => ({ items: [], page: 1, hasNextPage: false, partial: false }));
    api.issues.create = vi.fn(async () => ({
      summary: created,
      body: 'Details',
      bodyHtml: '<p>Details</p>'
    }));
    api.issues.detail = vi.fn(async () => ({
      summary: created,
      body: 'Details',
      bodyHtml: '<p>Details</p>',
      comments: [],
      commentsPartial: false
    }));
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open chetjones003/app' }));
    fireEvent.click(await screen.findByRole('button', { name: 'View issues' }));
    fireEvent.click(await screen.findByRole('button', { name: 'New issue' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Fresh bug' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Details' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create issue' }));

    await waitFor(() => expect(api.issues.detail).toHaveBeenCalledWith('chetjones003/app', 12));
    expect(api.issues.create).toHaveBeenCalledWith('chetjones003/app', {
      title: 'Fresh bug',
      body: 'Details'
    });
  });
});

describe('unsent comment text', () => {
  const SIGNED_IN: AuthStatus = { kind: 'signed-in', sessionId: 3, login: 'orbit-owner', persistent: true };
  const DRAFT = {
    login: 'orbit-owner',
    repoFullName: 'orbit-owner/app',
    kind: 'issue' as const,
    number: 4,
    target: 'new' as const
  };

  afterEach(() => {
    cleanup();
    drafts.clearAccount('orbit-owner');
  });

  it('warns before signing out that unsent text will be discarded, and discards it when confirmed', async () => {
    const { api } = installBridge({ status: SIGNED_IN, repos: [] });
    drafts.set(DRAFT, 'Still writing this reply');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Unsent comment text will be discarded')
    );
    await waitFor(() => expect(api.auth.signOut).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(drafts.hasDrafts()).toBe(false));
  });

  it('keeps unsent text while the same account signs in again, since the session is unchanged', async () => {
    const { listeners } = installBridge({ status: SIGNED_IN, repos: [] });
    drafts.set(DRAFT, 'Survives re-authentication');
    render(<App />);
    await screen.findByRole('button', { name: 'Sign out' });

    act(() => {
      for (const listener of listeners) {
        listener({
          kind: 'device-pending',
          userCode: 'ABCD-1234',
          verificationUri: 'https://github.com/login/device',
          expiresAt: Date.now() + 60_000
        });
      }
    });

    await screen.findByText('ABCD-1234');
    expect(drafts.get(DRAFT)).toBe('Survives re-authentication');
  });

  it('keeps the text and the session when the user declines the sign-out warning', async () => {
    const { api } = installBridge({ status: SIGNED_IN, repos: [] });
    drafts.set(DRAFT, 'Still writing this reply');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

    expect(api.auth.signOut).not.toHaveBeenCalled();
    expect(drafts.get(DRAFT)).toBe('Still writing this reply');
  });
});
