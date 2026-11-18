import { useEffect, useState } from 'react';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@ui-sdk/react/menu';
import { Menubar } from '@ui-sdk/react/menubar';
import type { ShellState } from '../../../shared/ipc';
import { OrbitMark } from '../brand/OrbitMark';
import { shortcutLabel, type Command } from '../commands/commands';
import { Icon } from '../icons';

interface MenuItemSpec {
  /** The command this item runs. Its title, shortcut, and availability come from the command. */
  command: string;
  /** Replaces the command's title, where the menu can say something more exact. */
  label?: string;
}

type MenuEntry = MenuItemSpec | { separator: true };

interface MenuGroup {
  label: string;
  items: MenuEntry[];
}

export interface TitleBarProps {
  /** The platform the app runs on. macOS keeps its native menu bar and traffic lights. */
  platform: string | undefined;
  commands: readonly Command[];
  onRunCommand(command: Command): void;
}

const isSeparator = (entry: MenuEntry): entry is { separator: true } => 'separator' in entry;
const SEPARATOR = { separator: true } as const;

/**
 * Orbit's own title bar and menu bar, drawn in the app's palette. Windows and Linux use it in place of the native
 * frame; macOS keeps its menu bar and gets only the brand and room for its traffic lights.
 */
export function TitleBar({ platform, commands, onRunCommand }: TitleBarProps) {
  const [shell, setShell] = useState<ShellState>({ maximized: false, fullscreen: false });
  const mac = platform === 'darwin';

  const groups: MenuGroup[] = [
    {
      label: 'File',
      items: [{ command: 'app.updates' }, { command: 'app.signOut' }, SEPARATOR, { command: 'window.quit' }]
    },
    {
      label: 'Edit',
      items: [
        { command: 'edit.undo' },
        { command: 'edit.redo' },
        SEPARATOR,
        { command: 'edit.cut' },
        { command: 'edit.copy' },
        { command: 'edit.paste' },
        SEPARATOR,
        { command: 'edit.selectAll' }
      ]
    },
    {
      label: 'View',
      items: [
        { command: 'palette.commands' },
        { command: 'palette.goTo' },
        SEPARATOR,
        { command: 'view.theme' },
        SEPARATOR,
        { command: 'view.zoomIn' },
        { command: 'view.zoomOut' },
        { command: 'view.zoomReset' },
        SEPARATOR,
        { command: 'view.fullscreen' }
      ]
    },
    {
      label: 'Window',
      items: [
        { command: 'window.minimize' },
        { command: 'window.maximize', label: shell.maximized ? 'Restore' : 'Maximize' },
        SEPARATOR,
        { command: 'window.close' }
      ]
    }
  ];

  const commandFor = (entry: MenuItemSpec): Command | undefined =>
    commands.find((command) => command.id === entry.command);

  // Each item is addressed by its command, so the menubar routes its action back to what it chose.
  const run = (id: string): void => {
    const command = commands.find((candidate) => candidate.id === id);
    if (command?.available) onRunCommand(command);
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

  return (
    <header className="titlebar" data-platform={platform ?? 'unknown'}>
      <div className="titlebar-brand">
        <OrbitMark size={15} />
        <span>Orbit</span>
      </div>
      {!mac && (
        <Menubar className="menubar" aria-label="Application menu">
          {groups.map((group) => (
            <Menu key={group.label} onAction={run}>
              <MenuTrigger className="menu-trigger">{group.label}</MenuTrigger>
              <MenuContent className="menu-popup">
                {group.items.map((entry, index) => {
                  if (isSeparator(entry)) {
                    return <MenuSeparator className="menu-separator" key={`${group.label}-sep-${index}`} />;
                  }
                  const command = commandFor(entry);
                  if (!command) return null;
                  const accelerator = shortcutLabel(command, mac);
                  return (
                    <MenuItem
                      key={command.id}
                      value={command.id}
                      disabled={!command.available}
                      className="menu-item"
                    >
                      <span>{entry.label ?? command.title}</span>
                      {accelerator && <kbd>{accelerator}</kbd>}
                    </MenuItem>
                  );
                })}
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
