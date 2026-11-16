import { useEffect, useState } from 'react';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@ui-sdk/react/menu';
import { Menubar } from '@ui-sdk/react/menubar';
import type { ShellAction, ShellState } from '../../../shared/ipc';
import { OrbitMark } from '../brand/OrbitMark';
import { Icon } from '../icons';

interface MenuItemSpec {
  label: string;
  /** Shown at the right of the item. Matches a shortcut this title bar handles. */
  accelerator?: string;
  /** Runs in the window through the backend. */
  action?: ShellAction;
  /** Runs in the renderer, for commands that belong to the app's own state. */
  onSelect?: () => void;
  disabled?: boolean;
}

type MenuEntry = MenuItemSpec | { separator: true };

interface MenuGroup {
  label: string;
  items: MenuEntry[];
}

export interface TitleBarProps {
  /** The platform the app runs on. macOS keeps its native menu bar and traffic lights. */
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

const isSeparator = (entry: MenuEntry): entry is { separator: true } => 'separator' in entry;

/**
 * Orbit's own title bar and menu bar, drawn in the app's palette. Windows and Linux use it in place of the native
 * frame; macOS keeps its menu bar and gets only the brand and room for its traffic lights.
 */
export function TitleBar({
  platform,
  signedIn,
  nextThemeLabel,
  onToggleTheme,
  onCheckUpdates,
  onSignOut
}: TitleBarProps) {
  const [shell, setShell] = useState<ShellState>({ maximized: false, fullscreen: false });
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

  // Each item is addressed by a stable value, so the menubar routes its action back to the item it chose.
  const byValue = new Map<string, MenuItemSpec>();
  groups.forEach((group) =>
    group.items.forEach((entry, index) => {
      if (!isSeparator(entry)) byValue.set(`${group.label}:${index}`, entry);
    })
  );

  const run = (item: MenuItemSpec): void => {
    if (item.disabled) return;
    if (item.onSelect) item.onSelect();
    else if (item.action) void window.orbit.shell.control(item.action);
  };

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

  return (
    <header className="titlebar" data-platform={platform ?? 'unknown'}>
      <div className="titlebar-brand">
        <OrbitMark size={15} />
        <span>Orbit</span>
      </div>
      {!mac && (
        <Menubar className="menubar" aria-label="Application menu">
          {groups.map((group) => (
            <Menu
              key={group.label}
              onAction={(value) => {
                const item = byValue.get(value);
                if (item) run(item);
              }}
            >
              <MenuTrigger className="menu-trigger">{group.label}</MenuTrigger>
              <MenuContent className="menu-popup">
                {group.items.map((entry, index) =>
                  isSeparator(entry) ? (
                    <MenuSeparator className="menu-separator" key={`${group.label}-sep-${index}`} />
                  ) : (
                    <MenuItem
                      key={`${group.label}:${index}`}
                      value={`${group.label}:${index}`}
                      disabled={entry.disabled}
                      className="menu-item"
                    >
                      <span>{entry.label}</span>
                      {entry.accelerator && <kbd>{entry.accelerator}</kbd>}
                    </MenuItem>
                  )
                )}
              </MenuContent>
            </Menu>
          ))}
        </Menubar>
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
