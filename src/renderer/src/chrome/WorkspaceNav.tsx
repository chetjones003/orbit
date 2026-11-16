import { Icon } from '../icons';

/** The sections of the workspace. `repos` is where the user chooses which repositories Orbit tracks. */
export type WorkspaceView = 'issues' | 'pulls' | 'inbox' | 'projects' | 'repos';

const TABS: Array<{ view: WorkspaceView; label: string }> = [
  { view: 'inbox', label: 'Inbox' },
  { view: 'issues', label: 'Issues' },
  { view: 'pulls', label: 'Pull requests' },
  { view: 'projects', label: 'Projects' },
  { view: 'repos', label: 'Repositories' }
];

export interface WorkspaceNavProps {
  view: WorkspaceView;
  /** The signed-in login, or null when signed out. Sections need a session, so they are disabled without one. */
  signedInLogin: string | null;
  refreshing: boolean;
  theme: 'dark' | 'light';
  buildLabel: string;
  onView(view: WorkspaceView): void;
  onRefresh(): void;
  onCheckUpdates(): void;
  onToggleTheme(): void;
  onSignOut(): void;
}

/** The top row: the sections of the workspace on the left, account and app actions on the right. */
export function WorkspaceNav({
  view,
  signedInLogin,
  refreshing,
  theme,
  buildLabel,
  onView,
  onRefresh,
  onCheckUpdates,
  onToggleTheme,
  onSignOut
}: WorkspaceNavProps) {
  const signedIn = signedInLogin !== null;
  return (
    <header className="workspace-nav">
      <nav className="workspace-tabs" aria-label="Sections">
        {TABS.map((tab) => (
          <button
            key={tab.view}
            type="button"
            className={`workspace-tab ${view === tab.view ? 'active' : ''}`}
            aria-current={view === tab.view ? 'page' : undefined}
            aria-label={tab.label}
            disabled={!signedIn}
            onClick={() => onView(tab.view)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="workspace-actions">
        {signedIn && (
          <button
            type="button"
            className="icon-button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh repositories"
            title="Refresh"
          >
            <Icon name="refresh" size={16} />
          </button>
        )}
        <button
          type="button"
          className="icon-button update-check"
          onClick={onCheckUpdates}
          aria-label="Check for updates"
          title="Check for updates"
        >
          <Icon name="updateArrow" size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          title="Toggle theme"
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
        {signedIn && <span className="account-indicator">Signed in as @{signedInLogin}</span>}
        {signedIn && (
          <button type="button" className="secondary-action sign-out-action" onClick={onSignOut}>
            Sign out
          </button>
        )}
        <span className="build-label">{buildLabel}</span>
      </div>
    </header>
  );
}
