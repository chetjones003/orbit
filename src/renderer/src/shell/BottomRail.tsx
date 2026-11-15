import { Icon } from '../icons';

/** The bottom row of the left panel, in order: settings, issues, pull requests, projects, repos, inbox, update. */
export type RailTarget = 'settings' | 'issues' | 'pulls' | 'projects' | 'repos' | 'inbox' | 'update';

export interface BottomRailProps {
  /** The section on screen, so its icon reads as selected. Settings and update are actions, never selected. */
  active: RailTarget | null;
  /** True when a newer release is waiting, so the update icon shows a mark. */
  updateAvailable: boolean;
  onSelect(target: RailTarget): void;
}

const ITEMS: Array<{ target: RailTarget; label: string; icon: Parameters<typeof Icon>[0]['name'] }> = [
  { target: 'settings', label: 'Settings', icon: 'settings' },
  { target: 'issues', label: 'Issues', icon: 'issue' },
  { target: 'pulls', label: 'Pull requests', icon: 'pull' },
  { target: 'projects', label: 'Projects', icon: 'projects' },
  { target: 'repos', label: 'Repositories', icon: 'repos' },
  { target: 'inbox', label: 'Inbox', icon: 'inbox' },
  { target: 'update', label: 'Check for updates', icon: 'updateArrow' }
];

export function BottomRail({ active, updateAvailable, onSelect }: BottomRailProps) {
  return (
    <nav className="bottom-rail" aria-label="Sections">
      {ITEMS.map((item) => (
        <button
          key={item.target}
          type="button"
          className={`rail-button ${active === item.target ? 'active' : ''}`}
          aria-label={item.label}
          aria-current={active === item.target ? 'page' : undefined}
          title={item.label}
          onClick={() => onSelect(item.target)}
        >
          <Icon name={item.icon} size={18} />
          {item.target === 'update' && updateAvailable && <span className="rail-dot" aria-hidden="true" />}
        </button>
      ))}
    </nav>
  );
}
