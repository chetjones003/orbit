import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppInfo, OpenItemsIn, OrbitSettings, PersonalRepo, SettingsUpdate } from '../../shared/ipc';
import type { AuthStatus } from '../../shared/auth';
import type { ConnectionStatus } from '../../shared/connection';
import { isRateLimitedAt, writesAllowed } from '../../shared/connection';
import { ConnectionBanner, InlineError, Toast } from './Feedback';
import {
  NotificationToasts,
  trimToastQueue,
  type NotificationToast
} from './notifications/NotificationToasts';
import {
  describeItem,
  describeSummary,
  type NotificationOpenResult,
  type NotificationTarget
} from '../../shared/notifications';
import { IssueList } from './issues/IssueList';
import { setDebugMediaOrigin } from './issues/sanitize-issue-html';
import { PullList } from './issues/PullList';
import { Inbox } from './inbox/Inbox';
import { NewIssueForm } from './issues/NewIssueForm';
import { IssueDetailView, type ItemKind } from './issues/IssueDetail';
import { ProjectsView } from './projects/ProjectsView';
import { drafts } from './comments/draft-store';
import { UpdateDialog } from './updates/UpdateDialog';
import type { WorkspaceView } from './chrome/WorkspaceNav';
import { BottomRail, type RailTarget } from './shell/BottomRail';
import { ItemMenu } from './shell/ItemMenu';
import { SettingsDialog } from './shell/SettingsDialog';
import { SideList, type ItemRef } from './shell/SideList';
import { SidePanelStack } from './shell/SidePanelStack';
import { motionMode, useSystemReducedMotion } from './shell/motion';
import { resolveColorScheme, useSystemPrefersDark } from './shell/theme';
import { PALETTE_PROPERTY_NAMES, paletteVariables, type CustomTheme } from '../../shared/themes';
import type { IssueStateFilter } from '../../shared/issues';
import type { UpdateStatus } from '../../shared/updates';
import { Icon } from './icons';
import { OrbitMark } from './brand/OrbitMark';
import { TitleBar } from './chrome/TitleBar';
import { SearchField } from './search/SearchField';
import { SearchView } from './search/SearchView';
import { ListResizeHandle } from './shell/ListResizeHandle';
import { clampListWidth, readStoredListWidth, storeListWidth } from './shell/side-list-width';

/** The issue shown in the details panel or the expanded view. */
interface IssueRef {
  repoFullName: string;
  number: number;
  kind: ItemKind;
}

const GITHUB_BUTTON = 'Sign in with GitHub';
/** Seconds-scale toasts go away on their own; errors stay until dismissed so they are not missed. */
const NOTIFICATION_TOAST_MS = 6000;
/** Newest notifications kept on screen. Older ones are dropped rather than queued without limit. */
const NOTIFICATION_QUEUE_LIMIT = 20;
/** Focus refetches only when the last successful refresh is at least this old. */
const FOCUS_REFRESH_MS = 60_000;
type ActionToast = { id: number; message: string; tone: 'success' | 'error' | 'info' };

/** Short synthesized Orbit cues: a rising chime, descending alert, or soft neutral ping. */
function playNotificationSound(tone: ActionToast['tone'] = 'info'): void {
  const audio = new AudioContext();
  const now = audio.currentTime;
  const notes: ReadonlyArray<readonly [number, number]> =
    tone === 'success'
      ? [
          [0, 587],
          [0.11, 784],
          [0.22, 1175]
        ]
      : tone === 'error'
        ? [
            [0, 392],
            [0.24, 311]
          ]
        : [
            [0, 659],
            [0.14, 880]
          ];
  for (const [offset, frequency] of notes) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = tone === 'error' ? 'triangle' : 'sine';
    gain.gain.setValueAtTime(0.0001, now + offset);
    gain.gain.exponentialRampToValueAtTime(tone === 'error' ? 0.38 : 0.16, now + offset + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + (tone === 'error' ? 0.3 : 0.22));
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(now + offset);
    oscillator.stop(now + offset + (tone === 'error' ? 0.31 : 0.19));
  }
  window.setTimeout(() => void audio.close(), tone === 'error' ? 800 : 700);
}

/** Single-window Orbit shell. GitHub data stays in memory and is fetched through main. */
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<OrbitSettings | null>(null);
  const [repos, setRepos] = useState<PersonalRepo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [showForksAndArchived, setShowForksAndArchived] = useState(false);
  // Closed on every launch: the panel opens when the user picks an item, and its open state is not saved.
  /** Repo whose issue list replaces the repository list in the workspace. */
  const [issuesRepo, setIssuesRepo] = useState<PersonalRepo | null>(null);
  const [issueRef, setIssueRef] = useState<IssueRef | null>(null);
  const [issueExpanded, setIssueExpanded] = useState(false);
  const [listKind, setListKind] = useState<'issue' | 'pull'>('issue');
  // The right-hand side panels, oldest first. Two at most, so two items can be read side by side.
  const [sideItems, setSideItems] = useState<ItemRef[]>([]);
  const [sideWidth, setSideWidth] = useState(440);
  // The left panel's width, kept between launches. The window can shrink, so the width is clamped when drawn too.
  const [listWidth, setListWidth] = useState(readStoredListWidth);
  /** The title bar search text. Typing shows the search view; clearing it returns to the section that was open. */
  const [searchText, setSearchText] = useState('');
  const [searchReturnView, setSearchReturnView] = useState<WorkspaceView>('repos');
  const systemReducedMotion = useSystemReducedMotion();
  const [itemMenu, setItemMenu] = useState<{ item: ItemRef; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Whether the new-issue form replaces the issue list for the open repo. */
  const [creatingIssue, setCreatingIssue] = useState(false);
  /** Which section fills the workspace. The details panel follows the selected item in every section. */
  const [view, setView] = useState<WorkspaceView>('repos');
  const pullMode = view === 'pulls';
  /** Open, closed, or all, for the grouped issue and pull request lists. */
  const [stateFilter, setStateFilter] = useState<IssueStateFilter>('open');
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<ConnectionStatus | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: 'idle' });
  const checkForUpdates = useCallback(() => {
    void window.orbit.updates.check().then(setUpdateStatus, () => undefined);
  }, []);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const openUpdates = useCallback(() => {
    setUpdateDialogOpen(true);
    checkForUpdates();
  }, [checkForUpdates]);
  // A newer release found in the background opens the dialog once, so the user is asked before anything downloads.
  const offeredVersion = updateStatus.kind === 'available' ? updateStatus.version : null;
  useEffect(() => {
    if (offeredVersion !== null) setUpdateDialogOpen(true);
  }, [offeredVersion]);
  const [now, setNow] = useState(() => Date.now());
  const [toasts, setToasts] = useState<ActionToast[]>([]);
  const actionToastIds = useRef(0);
  const showToast = (message: string, tone: ActionToast['tone'] = 'info'): void => {
    const toast = { id: ++actionToastIds.current, message, tone };
    setToasts((current) => [toast, ...current]);
    playNotificationSound(tone);
  };
  const [notificationToasts, setNotificationToasts] = useState<NotificationToast[]>([]);
  const reposRef = useRef<PersonalRepo[]>([]);
  useEffect(() => {
    reposRef.current = repos;
  }, [repos]);
  useEffect(() => {
    storeListWidth(listWidth);
  }, [listWidth]);
  const shownListWidth = clampListWidth(listWidth, window.innerWidth);

  const updateSettings = useCallback(async (update: SettingsUpdate) => {
    const next = await window.orbit.settings.update(update);
    setSettings(next);
  }, []);

  const loadRepos = useCallback(async () => {
    setLoadingRepos(true);
    setActionError(null);
    try {
      setRepos(await window.orbit.repos.list());
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not load repositories.');
      // Recorded in main so "Copy diagnostics" includes this failure. Only the scope and code are sent.
      void window.orbit.diagnostics.record({ scope: 'repos', code: 'load-failed' }).catch(() => undefined);
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pushed = false;
    const unsubscribe = window.orbit.auth.onStatusChanged((next) => {
      pushed = true;
      if (!cancelled) setStatus(next);
    });
    const unsubscribeUpdates = window.orbit.updates.onStatusChanged((next) => {
      if (!cancelled) setUpdateStatus(next);
    });
    void window.orbit.updates.getStatus().then(
      (next) => {
        if (!cancelled) setUpdateStatus((current) => (current.kind === 'idle' ? next : current));
      },
      () => undefined
    );
    const unsubscribeRefresh = window.orbit.refresh.onStatusChanged((next) => {
      if (!cancelled) {
        setRefreshStatus(next);
        setNow(Date.now());
      }
    });
    void window.orbit.refresh.getStatus().then(
      (next) => {
        if (!cancelled) setRefreshStatus((current) => current ?? next);
      },
      () => undefined
    );
    void Promise.all([
      window.orbit.app.getInfo(),
      window.orbit.auth.getStatus(),
      window.orbit.settings.get()
    ]).then(
      ([nextInfo, nextStatus, nextSettings]) => {
        if (cancelled) return;
        setInfo(nextInfo);
        setDebugMediaOrigin(nextInfo.debugMediaOrigin);
        setSettings(nextSettings);
        if (nextSettings.pinnedRepoIds.length > 0) {
          setView((current) => (current === 'repos' ? 'issues' : current));
        }
        if (!pushed) setStatus(nextStatus);
        document.documentElement.dataset.orbitReady = 'true';
      },
      () => setActionError('Orbit could not load its local settings.')
    );
    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeRefresh();
      unsubscribeUpdates();
    };
  }, []);

  // Unsent comment text belongs to one session. It is dropped when the account changes or the user signs out;
  // re-signing in as the same account keeps it, as a session keeps its in-memory work.
  const sessionOwner = useRef<{ sessionId: number; login: string } | null>(null);
  useEffect(() => {
    // Starting a sign-in is not a session change: the previous session still owns its drafts until it ends.
    if (status?.kind === 'device-pending') return;
    const current = status?.kind === 'signed-in' || status?.kind === 'reauth-required' ? status : null;
    const previous = sessionOwner.current;
    if (previous && (!current || current.sessionId !== previous.sessionId)) {
      drafts.clearAccount(previous.login);
    }
    sessionOwner.current = current ? { sessionId: current.sessionId, login: current.login } : null;
  }, [status]);

  // Closing or quitting the window would discard unsent text, so the renderer blocks unload while any exists.
  // The main process then asks the user before the window is allowed to close.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!drafts.hasDrafts()) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    if (status?.kind === 'signed-in') void loadRepos();
    else {
      setRepos([]);
      setSelectedRepoId(null);
      setIssuesRepo(null);
      setIssueRef(null);
      setIssueExpanded(false);
      setSearchText('');
    }
  }, [status, loadRepos]);

  // Each successful background or manual refresh pushes a new lastSuccessAt; reload the list then.
  const lastSuccessAt = refreshStatus?.lastSuccessAt ?? null;
  useEffect(() => {
    if (status?.kind === 'signed-in' && lastSuccessAt !== null) void loadRepos();
  }, [lastSuccessAt]);

  // Banner timings ("Last updated", "Retrying in") only move while the status is not fresh; tick them.
  const needsClock =
    refreshStatus !== null && refreshStatus.state !== 'fresh' && refreshStatus.state !== 'idle';
  useEffect(() => {
    if (!needsClock) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [needsClock]);

  // Notification toasts and navigation. Deliveries arrive from main; a failed mark-read is shown as an error toast.
  const toastIds = useRef(0);
  const toastTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const pushToasts = useCallback((entries: Array<Omit<NotificationToast, 'id'>>) => {
    const added = entries.map((entry) => ({ ...entry, id: ++toastIds.current }));
    setNotificationToasts((current) => trimToastQueue([...current, ...added], NOTIFICATION_QUEUE_LIMIT));
    for (const entry of added) {
      if (entry.tone !== 'info') continue;
      const timer = setTimeout(() => {
        toastTimers.current.delete(timer);
        setNotificationToasts((current) => current.filter((item) => item.id !== entry.id));
      }, NOTIFICATION_TOAST_MS);
      toastTimers.current.add(timer);
    }
  }, []);

  /** Opens a notification's issue or pull request in the repo view, when the repo is in the signed-in user's list. */
  const navigateToTarget = useCallback(
    (target: NotificationTarget) => {
      const repo = reposRef.current.find((candidate) => candidate.fullName === target.repoFullName);
      if (!repo) {
        pushToasts([
          {
            title: 'Notification not opened',
            body: `${target.repoFullName} is not in your repository list.`,
            threadId: null,
            tone: 'error'
          }
        ]);
        return;
      }
      setSelectedRepoId(repo.id);
      setIssuesRepo(repo);
      setView(target.kind === 'pull' ? 'pulls' : 'issues');
      setIssueRef({ repoFullName: target.repoFullName, number: target.number, kind: target.kind });
      setIssueExpanded(true);
    },
    [pushToasts]
  );

  const applyOpenResult = useCallback(
    (result: NotificationOpenResult) => {
      if (result.markReadError) {
        pushToasts([
          {
            title: 'Could not mark notification as read',
            body: `${result.markReadError} It stays unread.`,
            threadId: null,
            tone: 'error'
          }
        ]);
      }
      if (result.target) navigateToTarget(result.target);
      else if (!result.markReadError) {
        // The item is no longer remembered in main, for example after a long session or a restart.
        pushToasts([
          {
            title: 'Notification not available',
            body: 'It is no longer available to open. Check it on GitHub.',
            threadId: null,
            tone: 'error'
          }
        ]);
      }
    },
    [pushToasts, navigateToTarget]
  );

  const openNotification = useCallback(
    (threadId: string) => {
      // The toast is answered by opening it, so it goes away now rather than on its timer.
      setNotificationToasts((current) => current.filter((item) => item.threadId !== threadId));
      void window.orbit.notifications.open(threadId).then(applyOpenResult, () => {
        pushToasts([
          {
            title: 'Could not open notification',
            body: 'Orbit could not reach the notification. Try again.',
            threadId: null,
            tone: 'error'
          }
        ]);
      });
    },
    [applyOpenResult, pushToasts]
  );

  useEffect(() => {
    const timers = toastTimers.current;
    const unsubscribeDelivered = window.orbit.notifications.onDelivered((delivery) => {
      if (delivery.kind === 'items' || (delivery.kind === 'summary' && delivery.desktop))
        playNotificationSound('info');
      if (delivery.kind === 'items') {
        pushToasts(
          delivery.items.map((item) => ({
            ...describeItem(item),
            threadId: item.threadId,
            tone: 'info' as const
          }))
        );
      } else {
        pushToasts([{ ...describeSummary(delivery.count, !delivery.desktop), threadId: null, tone: 'info' }]);
      }
    });
    const unsubscribeNavigate = window.orbit.notifications.onNavigate(applyOpenResult);
    return () => {
      unsubscribeDelivered();
      unsubscribeNavigate();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, [pushToasts, applyOpenResult]);

  // Refetch when the user returns to Orbit and the data is older than FOCUS_REFRESH_MS, and when the
  // network comes back. Focus uses wake(), not the manual refresh, so it never uses up the cooldown.
  const latestRefresh = useRef<ConnectionStatus | null>(null);
  latestRefresh.current = refreshStatus;
  useEffect(() => {
    const onFocus = (): void => {
      const last = latestRefresh.current?.lastSuccessAt ?? 0;
      if (Date.now() - last < FOCUS_REFRESH_MS) return;
      void window.orbit.refresh.wake().catch(() => undefined);
    };
    const onOnline = (): void => {
      void window.orbit.refresh.wake().catch(() => undefined);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // The page shows the light or dark variant of the chosen palette. System follows Windows.
  const systemPrefersDark = useSystemPrefersDark();
  const resolvedScheme = resolveColorScheme(settings?.colorScheme ?? 'dark', systemPrefersDark);
  const palette = settings?.palette ?? 'orbit';
  const customTheme = settings?.customThemes.find((theme) => theme.id === palette);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset['theme'] = resolvedScheme;
    root.dataset['palette'] = palette;
    // A custom theme sets its colours on the page. Clear the last ones first, so a built-in palette shows its own.
    for (const name of PALETTE_PROPERTY_NAMES) root.style.removeProperty(name);
    if (customTheme) {
      for (const [name, value] of Object.entries(paletteVariables(customTheme[resolvedScheme]))) {
        root.style.setProperty(name, value);
      }
    }
  }, [resolvedScheme, palette, customTheme]);

  const orderedRepos = useMemo(() => {
    const visible = repos.filter((repo) => showForksAndArchived || (!repo.isFork && !repo.isArchived));
    const pinned = new Set(settings?.pinnedRepoIds ?? []);
    return visible.toSorted(
      (a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || a.name.localeCompare(b.name)
    );
  }, [repos, settings?.pinnedRepoIds, showForksAndArchived]);
  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null;
  /** The repositories the user chose to track. Orbit keeps them in settings, so the choice survives a restart. */
  const trackedRepos = useMemo(
    () =>
      repos
        .filter((repo) => settings?.pinnedRepoIds.includes(repo.id))
        .toSorted((a, b) => a.name.localeCompare(b.name)),
    [repos, settings?.pinnedRepoIds]
  );

  const run = (action: () => Promise<AuthStatus>): void => {
    setActionError(null);
    void action().then(setStatus, () => setActionError('That action failed. Try again.'));
  };

  const togglePin = (repo: PersonalRepo): void => {
    if (!settings) return;
    const ids = new Set(settings.pinnedRepoIds);
    if (ids.has(repo.id)) ids.delete(repo.id);
    else ids.add(repo.id);
    void updateSettings({ pinnedRepoIds: [...ids] }).catch(() => setActionError('Could not save this pin.'));
  };

  /** Opens an issue or pull request: full screen, or in the side panel. There is one side panel; a new pick replaces it. */
  const openItem = (item: ItemRef, mode: OpenItemsIn = settings?.openItemsIn ?? 'side'): void => {
    if (mode === 'full') {
      setIssueRef({ repoFullName: item.repoFullName, number: item.number, kind: item.kind });
      setIssueExpanded(true);
      setView(item.kind === 'pull' ? 'pulls' : 'issues');
      return;
    }
    setSideItems([item]);
  };

  /** A single pick from a list. With nothing open the item opens full screen; otherwise the setting decides. */
  const pickItem = (item: ItemRef): void => {
    const somethingOpen = sideItems.length > 0 || (issueExpanded && issueRef !== null);
    openItem(item, somethingOpen ? (settings?.openItemsIn ?? 'side') : 'full');
  };

  const railActive: RailTarget | null = settingsOpen
    ? 'settings'
    : view === 'issues' || view === 'pulls' || view === 'projects' || view === 'repos' || view === 'inbox'
      ? (view as RailTarget)
      : null;

  /** Focusing or typing in the title bar opens the search view, remembering the section it came from. */
  const openSearch = (): void => {
    if (view === 'search') return;
    setSearchReturnView(view);
    setView('search');
  };
  const changeSearch = (next: string): void => {
    setSearchText(next);
    openSearch();
  };
  /** Escape or Close search clears the text and returns to the section that was open. */
  const closeSearch = (): void => {
    setSearchText('');
    if (view === 'search') setView(searchReturnView);
  };

  const selectRail = (target: RailTarget): void => {
    if (target === 'settings') return setSettingsOpen(true);
    if (target === 'update') {
      setUpdateDialogOpen(true);
      checkForUpdates();
      return;
    }
    // Switching lists only changes the left panel. The centre changes when an item in the list is clicked.
    if (target === 'issues' || target === 'pulls') {
      setListKind(target === 'pulls' ? 'pull' : 'issue');
      setView(target);
      return;
    }
    setView(target);
  };

  const toggleTheme = (): void => {
    if (!settings) return;
    void updateSettings({ colorScheme: resolvedScheme === 'dark' ? 'light' : 'dark' }).catch(() =>
      setActionError('Could not save the theme preference.')
    );
  };

  /** The details panel may take at most half of the window, so the list always keeps room. */
  const refreshNow = (): void => {
    setActionError(null);
    void window.orbit.repos.refresh().then(
      (result) => {
        if (result.started) return;
        showToast(
          result.reason === 'cooldown'
            ? 'Refresh is cooling down. Try again in a moment.'
            : result.reason === 'rate-limited'
              ? 'GitHub is rate limiting Orbit. Refresh resumes automatically.'
              : result.reason === 'signed-out'
                ? 'Sign in to refresh your repositories.'
                : 'A refresh is already running.',
          'info'
        );
      },
      () => setActionError('Could not start a refresh. Try again.')
    );
  };

  const copyDiagnostics = (): void => {
    void window.orbit.diagnostics
      .getReport()
      .then((text) => navigator.clipboard.writeText(text))
      .then(
        () => showToast('Diagnostics copied. Nothing was uploaded.', 'success'),
        () => showToast('Could not copy diagnostics.', 'error')
      );
  };

  const rateLimitBlocked = refreshStatus !== null && isRateLimitedAt(refreshStatus, now);

  const signOut = (): void => {
    const message = drafts.hasDrafts()
      ? 'Sign out of Orbit? Unsent comment text will be discarded, and the saved sign-in will be removed from this computer.'
      : 'Sign out of Orbit? The saved sign-in will be removed from this computer.';
    if (!window.confirm(message)) return;
    run(() => window.orbit.auth.signOut());
  };

  return (
    <div className="app-frame">
      <TitleBar
        platform={info?.platform}
        signedIn={status?.kind === 'signed-in'}
        nextThemeLabel={`Switch to ${resolvedScheme === 'dark' ? 'light' : 'dark'} theme`}
        onToggleTheme={toggleTheme}
        onCheckUpdates={openUpdates}
        onSignOut={signOut}
        search={
          status?.kind === 'signed-in' ? (
            <SearchField
              value={searchText}
              onChange={changeSearch}
              onFocus={openSearch}
              onClose={closeSearch}
            />
          ) : undefined
        }
      />
      <main
        className="orbit-shell"
        aria-label="Orbit"
        data-motion={motionMode(settings?.motion, systemReducedMotion)}
      >
        {status?.kind === 'signed-in' && (
          <aside className="side-list" aria-label="Lists" style={{ flexBasis: shownListWidth }}>
            <ListResizeHandle
              width={shownListWidth}
              onResize={(next) => setListWidth(clampListWidth(next, window.innerWidth))}
            />
            <div className="side-list-scroll">
              <SideList
                kind={listKind}
                repos={trackedRepos}
                selected={issueExpanded && issueRef ? issueRef : null}
                onOpen={pickItem}
                onOpenFull={(item) => {
                  // A double click means full screen: drop the side panel its first click may have opened.
                  setSideItems((current) => current.filter((entry) => !sameItem(entry, item)));
                  openItem(item, 'full');
                }}
                onContextMenu={(item, x, y) => setItemMenu({ item, x, y })}
                onRefreshRepos={refreshNow}
              />
            </div>
            <BottomRail
              active={railActive}
              updateAvailable={updateStatus.kind === 'available'}
              onSelect={selectRail}
            />
          </aside>
        )}
        <section className="workspace" aria-label="Workspace">
          {status?.kind === 'signed-in' && (view === 'issues' || view === 'pulls') && (
            <div className="scope-bar">
              {import.meta.env.DEV && (
                <div className="dev-notification-controls">
                  <button
                    className="secondary-action"
                    onClick={() => showToast('This is a simulated success toast.', 'success')}
                  >
                    Success toast
                  </button>
                  <button
                    className="secondary-action"
                    onClick={() => showToast('This is a simulated error toast.', 'error')}
                  >
                    Error toast
                  </button>
                  <button
                    className="secondary-action"
                    onClick={() => showToast('This is a simulated info toast.', 'info')}
                  >
                    Info toast
                  </button>
                  <button
                    className="secondary-action"
                    onClick={() => {
                      playNotificationSound('info');
                      if ('Notification' in window)
                        new Notification('Orbit test notification', {
                          body: 'This is a simulated system notification.'
                        });
                      else showToast('System notifications are unavailable in this environment.', 'info');
                    }}
                  >
                    Simulate system notification
                  </button>
                </div>
              )}
              <label className="scope-field">
                <span>Repository</span>
                <select
                  value={issuesRepo?.fullName ?? ''}
                  onChange={(event) => {
                    setIssuesRepo(trackedRepos.find((repo) => repo.fullName === event.target.value) ?? null);
                    setIssueRef(null);
                    setCreatingIssue(false);
                  }}
                >
                  <option value="">All tracked ({trackedRepos.length})</option>
                  {trackedRepos.map((repo) => (
                    <option key={repo.id} value={repo.fullName}>
                      {repo.fullName}
                    </option>
                  ))}
                </select>
              </label>
              {!issuesRepo && (
                <div className="scope-state" role="group" aria-label="Item state">
                  {(['open', 'closed', 'all'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="secondary-action"
                      aria-pressed={stateFilter === option}
                      onClick={() => setStateFilter(option)}
                    >
                      {option === 'open' ? 'Open' : option === 'closed' ? 'Closed' : 'All'}
                    </button>
                  ))}
                </div>
              )}
              {issuesRepo && !pullMode && !creatingIssue && (
                <button type="button" className="secondary-action" onClick={() => setCreatingIssue(true)}>
                  New issue
                </button>
              )}
            </div>
          )}

          {!status || status.kind !== 'signed-in' ? (
            <div className="welcome-state">
              <div className="welcome-orbit">
                <OrbitMark size={34} />
              </div>
              <p className="eyebrow">YOUR WORK, IN ORBIT</p>
              <h2>
                {status?.kind === 'device-pending'
                  ? 'Connect your GitHub account'
                  : 'A clearer view of your GitHub'}
              </h2>
              <p className="welcome-copy">
                Sign in to see the repositories you own and the work happening across them.
              </p>
              {status && (
                <AuthPanel
                  status={status}
                  onStartSignIn={() => run(() => window.orbit.auth.startSignIn())}
                  onCancel={() => run(() => window.orbit.auth.cancelSignIn())}
                />
              )}
              {info && (
                <p className="app-meta">
                  {info.name} {info.version} on {info.platform}
                </p>
              )}
            </div>
          ) : view === 'inbox' ? (
            <div className="issues-view">
              <div className="repo-toolbar">
                <div>
                  <p>Across your personal repositories</p>
                </div>
              </div>
              <Inbox
                selected={issueRef ? { repoFullName: issueRef.repoFullName, number: issueRef.number } : null}
                onOpenItem={(item) => {
                  openItem({ repoFullName: item.repoFullName, number: item.number, kind: item.kind });
                  setIssueExpanded(false);
                }}
              />
            </div>
          ) : view === 'search' ? (
            <div className="issues-view search-page">
              <SearchView
                text={searchText}
                onTextChange={changeSearch}
                repos={repos}
                selected={issueRef ? { repoFullName: issueRef.repoFullName, number: issueRef.number } : null}
                onOpenItem={(item) => {
                  openItem({ repoFullName: item.repoFullName, number: item.number, kind: item.kind });
                  setIssueExpanded(false);
                }}
                onClose={closeSearch}
              />
            </div>
          ) : view === 'projects' ? (
            <div className="issues-view projects-page">
              <div className="repo-toolbar">
                <div>
                  <p>Your projects, their saved views, and the items in them</p>
                </div>
              </div>
              <ProjectsView
                onOpenItem={(repoFullName, number, kind) => {
                  openItem({ repoFullName, number, kind });
                  setIssueExpanded(false);
                }}
              />
            </div>
          ) : (view === 'issues' || view === 'pulls') && issueExpanded && issueRef ? (
            <div className="issues-expanded">
              <button className="secondary-action" onClick={() => setIssueExpanded(false)}>
                ← Back to issues
              </button>
              <IssueDetailView
                key={`${issueRef.repoFullName}#${issueRef.number}`}
                repoFullName={issueRef.repoFullName}
                number={issueRef.number}
                signedInLogin={status.login}
                kind={issueRef.kind}
                onOpenIssue={(repoFullName, number, kind) => setIssueRef({ repoFullName, number, kind })}
                onActionNotice={(message, failed) => showToast(message, failed ? 'error' : 'success')}
                variant="expanded"
              />
            </div>
          ) : (view === 'issues' || view === 'pulls') && issuesRepo ? (
            <div className="issues-view">
              <div className="repo-toolbar">
                <div>
                  <h2>{issuesRepo.fullName}</h2>
                  <p>{pullMode ? 'Pull requests in this personal repo' : 'Issues in this personal repo'}</p>
                </div>
              </div>
              {creatingIssue ? (
                <NewIssueForm
                  repoFullName={issuesRepo.fullName}
                  signedInLogin={status.login}
                  onCreated={(number) => {
                    setCreatingIssue(false);
                    openItem({ repoFullName: issuesRepo.fullName, number, kind: 'issue' });
                  }}
                  onCancel={() => setCreatingIssue(false)}
                />
              ) : pullMode ? (
                <PullList
                  key={issuesRepo.fullName}
                  repoFullName={issuesRepo.fullName}
                  selectedNumber={issueRef?.kind === 'pull' ? issueRef.number : null}
                  onOpenPull={(number) =>
                    openItem({ repoFullName: issuesRepo.fullName, number, kind: 'pull' })
                  }
                />
              ) : (
                <IssueList
                  key={issuesRepo.fullName}
                  repoFullName={issuesRepo.fullName}
                  selectedNumber={issueRef?.repoFullName === issuesRepo.fullName ? issueRef.number : null}
                  onOpenIssue={(number) =>
                    openItem({ repoFullName: issuesRepo.fullName, number, kind: 'issue' })
                  }
                />
              )}
            </div>
          ) : view === 'issues' || view === 'pulls' ? (
            <div className="issues-view">
              {trackedRepos.length === 0 ? (
                <div className="setup-card">
                  <h2>Choose the repositories to track</h2>
                  <p>
                    Orbit groups your issues and pull requests by the repositories you track, and remembers
                    your choice.
                  </p>
                  <button type="button" className="primary-action" onClick={() => setView('repos')}>
                    Choose repositories
                  </button>
                </div>
              ) : (
                <div className="issue-empty">
                  <h2>Pick an {pullMode ? 'pull request' : 'issue'} from the list</h2>
                  <p>It opens here in full, or beside this view, depending on your settings.</p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="repo-toolbar">
                <div>
                  <p>
                    {orderedRepos.length} {orderedRepos.length === 1 ? 'repository' : 'repositories'}
                    {settings?.pinnedRepoIds.length ? ` · ${settings.pinnedRepoIds.length} tracked` : ''}
                  </p>
                </div>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={showForksAndArchived}
                    onChange={(event) => setShowForksAndArchived(event.target.checked)}
                  />
                  <span>Show forks &amp; archived</span>
                </label>
              </div>
              {trackedRepos.length === 0 && (
                <p className="setup-banner" role="note">
                  Choose the repositories Orbit should track. Issues and pull requests are grouped by them,
                  and Orbit remembers the choice.
                </p>
              )}
              {status.notice && (
                <p role="status" className="session-notice">
                  {status.notice}
                </p>
              )}
              {refreshStatus && (
                <ConnectionBanner
                  status={refreshStatus}
                  onRefresh={refreshNow}
                  refreshBlocked={rateLimitBlocked}
                  now={now}
                />
              )}
              {refreshStatus && !writesAllowed(refreshStatus) && (
                <p className="session-notice" role="note">
                  Changes are paused until GitHub is reachable again.
                </p>
              )}
              <div className="repo-list" role="list" aria-label="Personal repositories">
                {loadingRepos && (
                  <p className="empty-state" role="status">
                    Loading your repositories…
                  </p>
                )}
                {!loadingRepos && orderedRepos.length === 0 && !actionError && (
                  <p className="empty-state">
                    No repositories to show. Try showing forks and archived repositories.
                  </p>
                )}
                {orderedRepos.map((repo) => {
                  const isPinned = settings?.pinnedRepoIds.includes(repo.id) ?? false;
                  return (
                    <article
                      className={`repo-row ${selectedRepoId === repo.id ? 'selected' : ''}`}
                      key={repo.id}
                      role="listitem"
                    >
                      <button
                        className="repo-select"
                        onClick={() => setSelectedRepoId(repo.id)}
                        aria-label={`Open ${repo.fullName}${repo.isArchived ? ', read only' : ''}`}
                        aria-current={selectedRepoId === repo.id ? 'true' : undefined}
                      >
                        <span className="repo-avatar">{repo.name.slice(0, 1).toUpperCase()}</span>
                        <span className="repo-copy">
                          <span className="repo-name">
                            {repo.name}
                            {repo.isPrivate && (
                              <span className="private-mark" aria-label="Private">
                                <Icon name="lock" size={11} />
                              </span>
                            )}
                          </span>
                          <span className="repo-description">{repo.description || 'No description'}</span>
                        </span>
                        {repo.isArchived && <span className="repo-badge">Archived</span>}
                        {repo.isFork && <span className="repo-badge">Fork</span>}
                      </button>
                      <button
                        className={`pin-button ${isPinned ? 'pinned' : ''}`}
                        onClick={() => togglePin(repo)}
                        aria-label={`${isPinned ? 'Unpin' : 'Pin'} ${repo.name}`}
                        aria-pressed={isPinned}
                        title={isPinned ? 'Unpin repository' : 'Pin repository'}
                      >
                        <Icon name="star" size={16} filled={isPinned} />
                      </button>
                    </article>
                  );
                })}
              </div>
              <footer className="workspace-footer">{status.login} · Personal repositories only</footer>
            </>
          )}
          {actionError && (
            <InlineError
              message={actionError}
              onRetry={status?.kind === 'signed-in' ? () => void loadRepos() : undefined}
              onCopyDiagnostics={copyDiagnostics}
            />
          )}
          {toasts.length > 0 && (
            <div className="action-toast-stack" aria-label="Action notifications">
              {toasts.map((toast) => (
                <Toast
                  key={toast.id}
                  message={toast.message}
                  tone={toast.tone}
                  onDismiss={() => setToasts((current) => current.filter((item) => item.id !== toast.id))}
                />
              ))}
            </div>
          )}
          <NotificationToasts
            toasts={notificationToasts}
            onOpen={openNotification}
            onDismiss={(id) => setNotificationToasts((current) => current.filter((item) => item.id !== id))}
          />
        </section>

        {status?.kind === 'signed-in' && view === 'repos' && selectedRepo && (
          <aside className="details-panel" aria-label="Repository details">
            <RepoDetails
              repo={selectedRepo}
              onViewIssues={() => {
                setIssuesRepo(selectedRepo);
                setIssueRef(null);
                setIssueExpanded(false);
                setView('issues');
              }}
            />
          </aside>
        )}
        {status?.kind === 'signed-in' && sideItems.length > 0 && (
          <SidePanelStack
            items={sideItems}
            signedInLogin={status.login}
            width={sideWidth}
            motion={motionMode(settings?.motion, systemReducedMotion)}
            onWidth={setSideWidth}
            onExpand={(next) => {
              setSideItems((current) => current.filter((entry) => !sameItem(entry, next)));
              openItem(next, 'full');
            }}
            onClose={(next) => setSideItems((current) => current.filter((entry) => !sameItem(entry, next)))}
            onOpenItem={(next) => openItem(next)}
          />
        )}
        {itemMenu && (
          <ItemMenu
            x={itemMenu.x}
            y={itemMenu.y}
            onOpenFull={() => {
              openItem(itemMenu.item, 'full');
              setItemMenu(null);
            }}
            onOpenSide={() => {
              openItem(itemMenu.item, 'side');
              setItemMenu(null);
            }}
            onClose={() => setItemMenu(null)}
          />
        )}
        {settingsOpen && settings && (
          <SettingsDialog
            colorScheme={settings.colorScheme}
            palette={settings.palette}
            customThemes={settings.customThemes}
            systemPrefersDark={systemPrefersDark}
            openItemsIn={settings.openItemsIn}
            motion={settings.motion}
            systemReducedMotion={systemReducedMotion}
            version={info?.version}
            onColorScheme={(colorScheme) =>
              void updateSettings({ colorScheme }).catch(() => setActionError('Could not save the theme.'))
            }
            onPalette={(next) =>
              void updateSettings({ palette: next }).catch(() => setActionError('Could not save the theme.'))
            }
            onSaveCustomTheme={(theme: CustomTheme) => {
              const others = settings.customThemes.filter((entry) => entry.id !== theme.id);
              void updateSettings({ customThemes: [...others, theme] }).catch(() =>
                setActionError('Could not save this theme.')
              );
            }}
            onDeleteCustomTheme={(id) => {
              void updateSettings({
                customThemes: settings.customThemes.filter((entry) => entry.id !== id),
                palette: settings.palette === id ? 'orbit' : settings.palette
              }).catch(() => setActionError('Could not delete this theme.'));
            }}
            onOpenItemsIn={(openItemsIn) =>
              void updateSettings({ openItemsIn }).catch(() => setActionError('Could not save this setting.'))
            }
            onMotion={(motion) =>
              void updateSettings({ motion }).catch(() => setActionError('Could not save this setting.'))
            }
            onCheckUpdates={() => {
              setSettingsOpen(false);
              openUpdates();
            }}
            onSignOut={() => signOut()}
            login={status?.kind === 'signed-in' ? status.login : null}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {updateDialogOpen && (
          <UpdateDialog
            status={updateStatus}
            currentVersion={info?.version}
            onClose={() => setUpdateDialogOpen(false)}
            onCheck={checkForUpdates}
            onDownload={() => void window.orbit.updates.download().then(setUpdateStatus, () => undefined)}
            onInstall={() => window.orbit.updates.install()}
            hasUnsavedDrafts={() => drafts.hasDrafts()}
          />
        )}
      </main>
    </div>
  );
}

function RepoDetails({ repo, onViewIssues }: { repo: PersonalRepo; onViewIssues: () => void }) {
  return (
    <div className="repo-details">
      <span className="detail-repo-avatar">{repo.name.slice(0, 1).toUpperCase()}</span>
      <p className="eyebrow">REPOSITORY</p>
      <h2>{repo.fullName}</h2>
      <p className="detail-description">{repo.description || 'No description provided.'}</p>
      {repo.isArchived && (
        <p className="read-only-notice" role="status">
          Archived repositories are read only.
        </p>
      )}
      <dl>
        <div>
          <dt>Default branch</dt>
          <dd>{repo.defaultBranch}</dd>
        </div>
        <div>
          <dt>Visibility</dt>
          <dd>{repo.isPrivate ? 'Private' : 'Public'}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{new Date(repo.updatedAt).toLocaleDateString()}</dd>
        </div>
      </dl>
      <button className="secondary-action" onClick={onViewIssues}>
        View issues
      </button>
      <a
        className="github-link"
        href={repo.htmlUrl}
        onClick={(event) => {
          event.preventDefault();
          void window.orbit.app.openExternal(repo.htmlUrl);
        }}
      >
        Open on GitHub <Icon name="external" size={12} />
      </a>
    </div>
  );
}

interface AuthPanelProps {
  status: AuthStatus;
  onStartSignIn: () => void;
  onCancel: () => void;
}

function AuthPanel({ status, onStartSignIn, onCancel }: AuthPanelProps) {
  switch (status.kind) {
    case 'signed-out':
      return (
        <section className="auth-actions">
          {status.notice && <p role="status">{status.notice}</p>}
          <button type="button" className="primary-action" onClick={onStartSignIn}>
            {GITHUB_BUTTON}
          </button>
        </section>
      );
    case 'device-pending':
      return (
        <section className="auth-actions">
          <p>Enter this code on GitHub to finish signing in:</p>
          <p className="device-code">{status.userCode}</p>
          <p className="device-expiry">Code expires at {new Date(status.expiresAt).toLocaleTimeString()}</p>
          <div className="device-actions">
            <button
              className="secondary-action"
              onClick={() => void navigator.clipboard.writeText(status.userCode)}
            >
              Copy code
            </button>
            <button
              className="secondary-action"
              onClick={() => void window.orbit.app.openExternal(status.verificationUri)}
            >
              Open GitHub in browser
            </button>
            <button className="text-action" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </section>
      );
    case 'reauth-required':
      return (
        <section className="auth-actions">
          <p role="status">{status.notice}</p>
          <button className="primary-action" onClick={onStartSignIn}>
            {GITHUB_BUTTON}
          </button>
        </section>
      );
  }
}

function sameItem(a: ItemRef, b: ItemRef): boolean {
  return a.repoFullName === b.repoFullName && a.number === b.number && a.kind === b.kind;
}
