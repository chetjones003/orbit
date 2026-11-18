import { useEffect, useRef, type ComponentProps } from 'react';
import type { Icon } from '../icons';

export type IconName = ComponentProps<typeof Icon>['name'];

export interface Shortcut {
  /** The value of `KeyboardEvent.key`. Letters match in either case. */
  key: string;
  /** Ctrl on Windows and Linux, Cmd on macOS. */
  mod?: boolean;
  shift?: boolean;
  /** Shown beside the command, but the page already handles the key, as with copy and paste. */
  native?: boolean;
  /** As `native`, on macOS only, where the system menu owns the key. */
  nativeOnMac?: boolean;
}

export interface CommandChoice {
  id: string;
  title: string;
  subtitle?: string;
}

/** A second step in the palette, for a command that needs one more answer before it can run. */
export interface CommandChoices {
  placeholder: string;
  options: CommandChoice[];
  run(choiceId: string): void;
}

/** One thing the user can do. The palette, the menu bar, and the keyboard all read this same definition. */
export interface Command {
  /** Stable, such as `view.zoomIn`. */
  id: string;
  title: string;
  category: string;
  icon: IconName;
  /** The first shortcut is the one shown. */
  shortcuts?: Shortcut[];
  /** False hides the command from the palette and disables it in the menu bar. */
  available: boolean;
  /** False for commands that make no sense from the palette, such as those acting on the focused text. */
  inPalette?: boolean;
  /** Keeps acting while its key is held. */
  repeatable?: boolean;
  /** Runs without closing an open palette. */
  keepsPalette?: boolean;
  run?(): void;
  choose?: CommandChoices;
}

/**
 * Keys Orbit keeps from the webview, which would print or open a window. The palette uses them to move its highlight,
 * so a press just after it closes must do nothing.
 */
const RESERVED_SHORTCUTS: readonly Shortcut[] = [
  { key: 'p', mod: true },
  { key: 'n', mod: true }
];

function matches(shortcut: Shortcut, event: KeyboardEvent, mac: boolean): boolean {
  if (shortcut.native || (mac && shortcut.nativeOnMac)) return false;
  const modDown = mac ? event.metaKey : event.ctrlKey;
  const otherDown = mac ? event.ctrlKey : event.metaKey;
  return (
    !otherDown &&
    !event.altKey &&
    modDown === Boolean(shortcut.mod) &&
    event.shiftKey === Boolean(shortcut.shift) &&
    event.key.toLowerCase() === shortcut.key.toLowerCase()
  );
}

function commandWithShortcut(
  commands: readonly Command[],
  event: KeyboardEvent,
  mac: boolean
): Command | undefined {
  return commands.find((command) => command.shortcuts?.some((item) => matches(item, event, mac)));
}

/** The command this key press should run now. A held key repeats only commands that ask for it. */
export function commandForKey(
  commands: readonly Command[],
  event: KeyboardEvent,
  mac: boolean
): Command | undefined {
  const command = commandWithShortcut(commands, event, mac);
  return event.repeat && !command?.repeatable ? undefined : command;
}

export function formatShortcut(shortcut: Shortcut, mac: boolean): string {
  const key = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
  return [shortcut.mod ? (mac ? 'Cmd' : 'Ctrl') : null, shortcut.shift ? 'Shift' : null, key]
    .filter(Boolean)
    .join('+');
}

/** The shortcut to show beside a command, if it has one. */
export function shortcutLabel(command: Command, mac: boolean): string | undefined {
  const shortcut = command.shortcuts?.[0];
  return shortcut ? formatShortcut(shortcut, mac) : undefined;
}

/**
 * Runs commands from the keyboard, anywhere in the window. It listens before the page does, so an editor focused
 * underneath cannot also act on the key. A shortcut that cannot run now is still consumed, as are the reserved keys.
 */
export function useCommandShortcuts(
  commands: readonly Command[],
  mac: boolean,
  run: (command: Command) => void
): void {
  const latest = useRef({ commands, mac, run });
  latest.current = { commands, mac, run };

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const current = latest.current;
      const command = commandWithShortcut(current.commands, event, current.mac);
      const reserved = RESERVED_SHORTCUTS.some((shortcut) => matches(shortcut, event, current.mac));
      if (!command && !reserved) return;
      event.preventDefault();
      event.stopPropagation();
      if (command?.available && (!event.repeat || command.repeatable)) current.run(command);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}
