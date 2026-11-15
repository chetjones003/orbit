import { useEffect, useRef, useState } from 'react';
import type { ShellAction, ShellState } from '../../../shared/ipc';
import { OrbitMark } from '../brand/OrbitMark';
import { Icon } from '../icons';

interface MenuItem {
  label: string;
  /** Shown at the right of the item. Matches a shortcut this title bar handles. */
  accelerator?: string;
  /** Runs in the window through main. */
  action?: ShellAction;
  /** Runs in the renderer, for commands that belong to the app's own state. */
  onSelect?: () => void;
  disabled?: boolean;
  separator?: false;
}

interface MenuSeparator {
  separator: true;
}

interface MenuGroup {
  label: string;
  items: Array<MenuItem | MenuSeparator>;
}

export interface TitleBarProps {
  /** `process.platform` from the main process. macOS keeps its native menu bar and traffic lights. */
  platform: string | undefined;
  signedIn: boolean;
  /** The theme the toggle switches to, for the View menu's label. */
  nextThemeLabel: string;
  onToggleTheme(): void;
  onCheckUpdates(): void;
  onSignOut(): void;
}

/** Keyboard shortcuts this title bar handles itself. Undo, copy, and paste work in the page already. */
const SHORTCUTS: Array<{ key: string; ctrl?: boolean; shift?: boolean; action: ShellAction }> = [
  { key: 'q', ctrl: true, action: 'quit' },
  { key: '=', ctrl: true, action: 'zoom-in' },
  { key: '+', ctrl: true, action: 'zoom-in' },
  { key: '-', ctrl: true, action: 'zoom-out' },
  { key: '0', ctrl: true, action: 'zoom-reset' },
  { key: 'F11', action: 'toggle-fullscreen' }
];

/**
 * Orbit's own title bar and menu bar, drawn in the app's palette. Windows and Linux use it in place of
 * the native frame; macOS keeps its menu bar and gets only the brand and room for its traffic lights.
 */
export function TitleBar({
  platform,
  signedIn,
  nextThemeLabel,
  onToggleTheme,
  onCheckUpdates,
  onSignOut
}: TitleBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const [shell, setShell] = useState<ShellState>({ maximized: false, fullscreen: false });
  const barRef = useRef<HTMLDivElement>(null);
  const mac = platform === 'darwin';

  const groups: MenuGroup[] = [
    {
      label: 'File',
      items: [
        { label: 'Check for updates', onSelect: onCheckUpdates },
        { label: 'Sign out', onSelect: onSignOut, disabled: !signedIn },
        { separator: true },
        { label: 'Quit Orbit', accelerator: 'Ctrl+Q', action: 'quit' }
      ]
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', accelerator: 'Ctrl+Z', action: 'undo' },
        { label: 'Redo', accelerator: 'Ctrl+Y', action: 'redo' },
        { separator: true },
        { label: 'Cut', accelerator: 'Ctrl+X', action: 'cut' },
        { label: 'Copy', accelerator: 'Ctrl+C', action: 'copy' },
        { label: 'Paste', accelerator: 'Ctrl+V', action: 'paste' },
        { separator: true },
        { label: 'Select all', accelerator: 'Ctrl+A', action: 'select-all' }
      ]
    },
    {
      label: 'View',
      items: [
        { label: nextThemeLabel, onSelect: onToggleTheme },
        { separator: true },
        { label: 'Zoom in', accelerator: 'Ctrl+=', action: 'zoom-in' },
        { label: 'Zoom out', accelerator: 'Ctrl+-', action: 'zoom-out' },
        { label: 'Actual size', accelerator: 'Ctrl+0', action: 'zoom-reset' },
        { separator: true },
        { label: 'Full screen', accelerator: 'F11', action: 'toggle-fullscreen' }
      ]
    },
    {
      label: 'Window',
      items: [
        { label: 'Minimize', action: 'minimize' },
        { label: shell.maximized ? 'Restore' : 'Maximize', action: 'toggle-maximize' },
        { separator: true },
        { label: 'Close window', action: 'close' }
      ]
    }
  ];

  useEffect(() => {
    if (mac) return;
    let active = true;
    void window.orbit.shell.getState().then((state) => active && setShell(state));
    const unsubscribe = window.orbit.shell.onStateChanged((state) => setShell(state));
    return () => {
      active = false;
      unsubscribe();
    };
  }, [mac]);

  // Close an open menu on an outside click or Escape.
  useEffect(() => {
    if (open === null) return;
    const onPointer = (event: MouseEvent): void => {
      if (!barRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(null);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (mac) return;
    const onKey = (event: KeyboardEvent): void => {
      const shortcut = SHORTCUTS.find(
        (candidate) =>
          candidate.key === event.key &&
          Boolean(candidate.ctrl) === (event.ctrlKey || event.metaKey) &&
          Boolean(candidate.shift) === event.shiftKey
      );
      if (!shortcut) return;
      event.preventDefault();
      void window.orbit.shell.control(shortcut.action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mac]);

  const run = (item: MenuItem): void => {
    setOpen(null);
    if (item.disabled) return;
    if (item.onSelect) item.onSelect();
    else if (item.action) void window.orbit.shell.control(item.action);
  };

  return (
    <header className="titlebar" data-platform={platform ?? 'unknown'}>
      <div className="titlebar-brand">
        <OrbitMark size={15} />
        <span>Orbit</span>
      </div>
      {!mac && (
        <div className="menubar" role="menubar" aria-label="Application menu" ref={barRef}>
          {groups.map((group) => {
            const expanded = open === group.label;
            return (
              <div className="menu" key={group.label}>
                <button
                  type="button"
                  role="menuitem"
                  className={`menu-trigger ${expanded ? 'open' : ''}`}
                  aria-haspopup="menu"
                  aria-expanded={expanded}
                  onClick={() => setOpen(expanded ? null : group.label)}
                  onMouseEnter={() => {
                    if (open !== null && open !== group.label) setOpen(group.label);
                  }}
                >
                  {group.label}
                </button>
                {expanded && (
                  <div className="menu-popup" role="menu" aria-label={group.label}>
                    {group.items.map((item, index) =>
                      'separator' in item && item.separator ? (
                        <div className="menu-separator" role="separator" key={`sep-${index}`} />
                      ) : (
                        <button
                          type="button"
                          role="menuitem"
                          className="menu-item"
                          key={item.label}
                          disabled={'disabled' in item && item.disabled}
                          onClick={() => run(item as MenuItem)}
                        >
                          <span>{item.label}</span>
                          {'accelerator' in item && item.accelerator && <kbd>{item.accelerator}</kbd>}
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div className="titlebar-spacer" />
      {!mac && (
        <div className="window-controls">
          <button
            type="button"
            className="window-control"
            aria-label="Minimize window"
            title="Minimize"
            onClick={() => void window.orbit.shell.control('minimize')}
          >
            <Icon name="minimize" size={12} />
          </button>
          <button
            type="button"
            className="window-control"
            aria-label={shell.maximized ? 'Restore window' : 'Maximize window'}
            title={shell.maximized ? 'Restore' : 'Maximize'}
            onClick={() => void window.orbit.shell.control('toggle-maximize')}
          >
            <Icon name={shell.maximized ? 'restore' : 'maximize'} size={12} />
          </button>
          <button
            type="button"
            className="window-control close"
            aria-label="Close window"
            title="Close"
            onClick={() => void window.orbit.shell.control('close')}
          >
            <Icon name="close" size={13} />
          </button>
        </div>
      )}
    </header>
  );
}
