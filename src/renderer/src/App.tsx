import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent
} from 'react';
import type { AppInfo, OrbitSettings, PersonalRepo, SettingsUpdate } from '../../shared/ipc';
import type { AuthStatus } from '../../shared/auth';
import type { ConnectionStatus } from '../../shared/connection';
import { isRateLimitedAt, writesAllowed } from '../../shared/connection';
import { ConnectionBanner, InlineError, Toast } from './Feedback';
import { IssueList } from './issues/IssueList';
import { IssueDetailView, type ItemKind } from './issues/IssueDetail';
import { drafts } from './comments/draft-store';

/** The issue shown in the details panel or the expanded view. */
interface IssueRef {
  repoFullName: string;
  number: number;
  kind: ItemKind;
}

const GITHUB_BUTTON = 'Sign in with GitHub';
/** Focus refetches only when the last successful refresh is at least this old. */
const FOCUS_REFRESH_MS = 60_000;

/** Single-window Orbit shell. GitHub data stays in memory and is fetched through main. */
export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [settings, setSettings] = useState<OrbitSettings | null>(null);
  const [repos, setRepos] = useState<PersonalRepo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null);
  const [showForksAndArchived, setShowForksAndArchived] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  /** Repo whose issue list replaces the repository list in the workspace. */
  const [issuesRepo, setIssuesRepo] = useState<PersonalRepo | null>(null);
  const [issueRef, setIssueRef] = useState<IssueRef | null>(null);
  const [issueExpanded, setIssueExpanded] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<ConnectionStatus | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<string | null>(null);

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
        setSettings(nextSettings);
        document.documentElement.dataset['theme'] = nextSettings.theme;
        if (!pushed) setStatus(nextStatus);
        document.documentElement.dataset.orbitReady = 'true';
      },
      () => setActionError('Orbit could not load its local settings.')
    );
    return () => {
      cancelled = true;
      unsubscribe();
      unsubscribeRefresh();
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

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

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

  useEffect(() => {
    if (settings) document.documentElement.dataset['theme'] = settings.theme;
  }, [settings]);

  const orderedRepos = useMemo(() => {
    const visible = repos.filter((repo) => showForksAndArchived || (!repo.isFork && !repo.isArchived));
    const pinned = new Set(settings?.pinnedRepoIds ?? []);
    return visible.toSorted(
      (a, b) => Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || a.name.localeCompare(b.name)
    );
  }, [repos, settings?.pinnedRepoIds, showForksAndArchived]);
  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null;

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

  const toggleTheme = (): void => {
    if (!settings) return;
    void updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }).catch(() =>
      setActionError('Could not save the theme preference.')
    );
  };

  const resizeDetails = (event: PointerEvent<HTMLDivElement>): void => {
    if (!settings) return;
    const startX = event.clientX;
    const startWidth = settings.windowState?.detailsWidth ?? 320;
    let lastX = startX;
    const move = (moveEvent: globalThis.PointerEvent): void => {
      lastX = moveEvent.clientX;
      const nextWidth = Math.max(260, Math.min(600, startWidth + startX - moveEvent.clientX));
      setSettings((current) =>
        current
          ? {
              ...current,
              windowState: {
                ...(current.windowState ?? { width: 1100, height: 720, maximized: false }),
                detailsWidth: nextWidth
              }
            }
          : current
      );
    };
    const finish = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      const finalWidth = Math.max(260, Math.min(600, startWidth + startX - lastX));
      void updateSettings({ detailsWidth: finalWidth }).catch(() =>
        setActionError('Could not save the panel size.')
      );
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish, { once: true });
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!settings || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? 24 : -24;
    void updateSettings({
      detailsWidth: Math.max(260, Math.min(600, (settings.windowState?.detailsWidth ?? 320) + delta))
    });
  };

  const refreshNow = (): void => {
    setActionError(null);
    void window.orbit.repos.refresh().then(
      (result) => {
        if (result.started) return;
        setToast(
          result.reason === 'cooldown'
            ? 'Refresh is cooling down. Try again in a moment.'
            : result.reason === 'rate-limited'
              ? 'GitHub is rate limiting Orbit. Refresh resumes automatically.'
              : result.reason === 'signed-out'
                ? 'Sign in to refresh your repositories.'
                : 'A refresh is already running.'
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
        () => setToast('Diagnostics copied. Nothing was uploaded.'),
        () => setToast('Could not copy diagnostics.')
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
    <main className="orbit-shell" aria-label="Orbit">
      <nav className="rail" aria-label="Primary navigation">
        <div className="brand-mark" aria-label="Orbit">
          O
        </div>
        <button
          className="rail-button active"
          aria-current="page"
          aria-label="Repositories"
          title="Repositories"
        >
          ◫
        </button>
        <button className="rail-button" aria-label="Inbox" title="Inbox" disabled>
          ⌑
        </button>
        <div className="rail-spacer" />
        <button
          className="rail-button"
          onClick={toggleTheme}
          aria-label={`Switch to ${settings?.theme === 'dark' ? 'light' : 'dark'} theme`}
          title="Toggle theme"
        >
          ◐
        </button>
        {status?.kind === 'signed-in' && (
          <button
            className="avatar"
            aria-label={`Signed in as @${status.login}`}
            title={`@${status.login}`}
            onClick={signOut}
          >
            {status.login.slice(0, 1).toUpperCase()}
          </button>
        )}
      </nav>

      <section className="workspace" aria-label="Workspace">
        <header className="topbar">
          <div className="workspace-heading">
            <span className="eyebrow">PERSONAL WORKSPACE</span>
            <h1>{status?.kind === 'signed-in' ? `@${status.login}` : 'Your repositories'}</h1>
          </div>
          <div className="topbar-actions">
            {status?.kind === 'signed-in' && (
              <button
                className="icon-button"
                onClick={refreshNow}
                disabled={loadingRepos}
                aria-label="Refresh repositories"
                title="Refresh"
              >
                ↻
              </button>
            )}
            <button
              className="icon-button"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              ◐
            </button>
            {status?.kind === 'signed-in' && (
              <span className="account-indicator">Signed in as @{status.login}</span>
            )}
            {status?.kind === 'signed-in' && (
              <button className="secondary-action sign-out-action" onClick={signOut}>
                Sign out
              </button>
            )}
            <span className="build-label">{info?.version ?? 'Starting…'}</span>
          </div>
        </header>

        {!status || status.kind !== 'signed-in' ? (
          <div className="welcome-state">
            <div className="welcome-orbit">◉</div>
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
        ) : issuesRepo && issueExpanded && issueRef ? (
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
              variant="expanded"
            />
          </div>
        ) : issuesRepo ? (
          <div className="issues-view">
            <div className="repo-toolbar">
              <button
                className="secondary-action"
                onClick={() => {
                  setIssuesRepo(null);
                  setIssueRef(null);
                }}
              >
                ← Repositories
              </button>
              <div>
                <h2>{issuesRepo.fullName}</h2>
                <p>Issues in this personal repo</p>
              </div>
            </div>
            <IssueList
              key={issuesRepo.fullName}
              repoFullName={issuesRepo.fullName}
              selectedNumber={issueRef?.repoFullName === issuesRepo.fullName ? issueRef.number : null}
              onOpenIssue={(number) =>
                setIssueRef({ repoFullName: issuesRepo.fullName, number, kind: 'issue' })
              }
            />
          </div>
        ) : (
          <>
            <div className="repo-toolbar">
              <div>
                <h2>Repositories</h2>
                <p>
                  {orderedRepos.length} {orderedRepos.length === 1 ? 'repository' : 'repositories'}
                  {settings?.pinnedRepoIds.length ? ` · ${settings.pinnedRepoIds.length} pinned` : ''}
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
                              ◆
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
                      ★
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
        {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
      </section>

      {status?.kind === 'signed-in' && detailsOpen && (
        <>
          <div
            className="resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize details panel"
            aria-valuenow={settings?.windowState?.detailsWidth ?? 320}
            aria-valuemin={260}
            aria-valuemax={600}
            tabIndex={0}
            onPointerDown={resizeDetails}
            onKeyDown={resizeWithKeyboard}
          />
          <aside
            className="details-panel"
            aria-label="Repository details"
            style={{ width: settings?.windowState?.detailsWidth ?? 320 }}
          >
            <div className="details-header">
              <span className="eyebrow">DETAILS</span>
              <button
                className="icon-button"
                onClick={() => setDetailsOpen(false)}
                aria-label="Collapse details panel"
                title="Collapse details"
              >
                →
              </button>
            </div>
            {issueRef ? (
              <div className="issue-panel">
                <button className="secondary-action" onClick={() => setIssueExpanded(true)}>
                  Expand
                </button>
                <IssueDetailView
                  key={`${issueRef.repoFullName}#${issueRef.number}`}
                  repoFullName={issueRef.repoFullName}
                  number={issueRef.number}
                  signedInLogin={status.login}
                  kind={issueRef.kind}
                  onOpenIssue={(repoFullName, number, kind) => setIssueRef({ repoFullName, number, kind })}
                />
              </div>
            ) : selectedRepo ? (
              <RepoDetails
                repo={selectedRepo}
                onViewIssues={() => {
                  setIssuesRepo(selectedRepo);
                  setIssueRef(null);
                  setIssueExpanded(false);
                }}
              />
            ) : (
              <div className="details-empty">
                <span className="details-glyph">⌁</span>
                <h2>Select a repository</h2>
                <p>Choose a repository to see its details here.</p>
              </div>
            )}
          </aside>
        </>
      )}
      {status?.kind === 'signed-in' && !detailsOpen && (
        <button
          className="expand-details"
          onClick={() => setDetailsOpen(true)}
          aria-label="Expand details panel"
          title="Expand details"
        >
          ←
        </button>
      )}
    </main>
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
        Open on GitHub ↗
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
