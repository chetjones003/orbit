// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { buildAppCommands, type AppCommandContext } from '../../../src/renderer/src/commands/app-commands';
import {
  commandForKey,
  formatShortcut,
  type Command,
  type Shortcut
} from '../../../src/renderer/src/commands/commands';

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init);
}

function command(id: string, shortcuts: Shortcut[], extra: Partial<Command> = {}): Command {
  return { id, title: id, category: 'View', icon: 'search', available: true, shortcuts, ...extra };
}

function context(overrides: Partial<AppCommandContext> = {}): AppCommandContext {
  return {
    signedIn: true,
    nextThemeLabel: 'Switch to light theme',
    nextThemeIcon: 'sun',
    trackedRepos: [
      { name: 'alpha', fullName: 'me/alpha' },
      { name: 'beta', fullName: 'me/beta' }
    ],
    currentRepoFullName: null,
    openPalette: vi.fn(),
    goTo: vi.fn(),
    newIssue: vi.fn(),
    newPull: vi.fn(),
    toggleTheme: vi.fn(),
    openSettings: vi.fn(),
    refresh: vi.fn(),
    checkUpdates: vi.fn(),
    copyDiagnostics: vi.fn(),
    signOut: vi.fn(),
    shell: vi.fn(),
    ...overrides
  };
}

describe('shortcut matching', () => {
  const palette = command('palette', [{ key: 'p', mod: true, shift: true }]);
  const goTo = command('goto', [{ key: 'p', mod: true }]);

  it('uses Ctrl on Windows and Linux, and Cmd on macOS', () => {
    expect(commandForKey([goTo], key({ key: 'p', ctrlKey: true }), false)?.id).toBe('goto');
    expect(commandForKey([goTo], key({ key: 'p', metaKey: true }), false)).toBeUndefined();
    expect(commandForKey([goTo], key({ key: 'p', metaKey: true }), true)?.id).toBe('goto');
    expect(commandForKey([goTo], key({ key: 'p', ctrlKey: true }), true)).toBeUndefined();
  });

  it('tells Shift combinations apart, whatever case the key reports', () => {
    const commands = [goTo, palette];
    expect(commandForKey(commands, key({ key: 'P', ctrlKey: true, shiftKey: true }), false)?.id).toBe(
      'palette'
    );
    expect(commandForKey(commands, key({ key: 'P', ctrlKey: true }), false)?.id).toBe('goto');
    expect(commandForKey(commands, key({ key: 'p', ctrlKey: true, altKey: true }), false)).toBeUndefined();
  });

  it('skips a held key unless the command repeats', () => {
    const zoom = command('zoom', [{ key: '=', mod: true }], { repeatable: true });
    expect(commandForKey([goTo], key({ key: 'p', ctrlKey: true, repeat: true }), false)).toBeUndefined();
    expect(commandForKey([zoom], key({ key: '=', ctrlKey: true, repeat: true }), false)?.id).toBe('zoom');
  });

  it('leaves shortcuts the page or macOS already handles alone', () => {
    const copy = command('copy', [{ key: 'c', mod: true, native: true }]);
    const quit = command('quit', [{ key: 'q', mod: true, nativeOnMac: true }]);
    expect(commandForKey([copy], key({ key: 'c', ctrlKey: true }), false)).toBeUndefined();
    expect(commandForKey([quit], key({ key: 'q', ctrlKey: true }), false)?.id).toBe('quit');
    expect(commandForKey([quit], key({ key: 'q', metaKey: true }), true)).toBeUndefined();
  });

  it('writes shortcuts for each platform', () => {
    const shortcut = { key: 'p', mod: true, shift: true };
    expect(formatShortcut(shortcut, false)).toBe('Ctrl+Shift+P');
    expect(formatShortcut(shortcut, true)).toBe('Cmd+Shift+P');
    expect(formatShortcut({ key: 'F11' }, false)).toBe('F11');
    expect(formatShortcut({ key: ',', mod: true }, false)).toBe('Ctrl+,');
  });
});

describe('app commands', () => {
  const byId = (commands: Command[], id: string): Command => {
    const found = commands.find((entry) => entry.id === id);
    if (!found) throw new Error(`No command ${id}`);
    return found;
  };

  it('gives every command a unique id, and every shortcut one owner', () => {
    const commands = buildAppCommands(context());
    expect(new Set(commands.map((entry) => entry.id)).size).toBe(commands.length);
    const keys = commands.flatMap((entry) =>
      (entry.shortcuts ?? []).map((item) => `${item.mod}:${item.shift}:${item.key.toLowerCase()}`)
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps account commands unavailable while signed out, and app commands available', () => {
    const commands = buildAppCommands(context({ signedIn: false, trackedRepos: [] }));
    for (const id of [
      'palette.goTo',
      'go.inbox',
      'create.issue',
      'create.pull',
      'app.refresh',
      'app.signOut'
    ]) {
      expect(byId(commands, id).available, id).toBe(false);
    }
    for (const id of ['palette.commands', 'app.settings', 'view.theme', 'view.zoomIn', 'app.updates']) {
      expect(byId(commands, id).available, id).toBe(true);
    }
  });

  it('asks for a repository before creating, offering the current one first', () => {
    const newIssue = vi.fn();
    const commands = buildAppCommands(context({ newIssue, currentRepoFullName: 'me/beta' }));
    const create = byId(commands, 'create.issue');
    expect(create.choose?.options.map((option) => option.id)).toEqual(['me/beta', 'me/alpha']);
    create.choose?.run('me/alpha');
    expect(newIssue).toHaveBeenCalledWith('me/alpha');
  });

  it('cannot create anything without a tracked repository', () => {
    const commands = buildAppCommands(context({ trackedRepos: [] }));
    expect(byId(commands, 'create.issue').available).toBe(false);
    expect(byId(commands, 'create.pull').available).toBe(false);
  });

  it('keeps editing commands out of the palette, where they would act on its input', () => {
    const commands = buildAppCommands(context());
    expect(byId(commands, 'edit.paste').inPalette).toBe(false);
    expect(byId(commands, 'edit.paste').shortcuts?.[0]?.native).toBe(true);
  });

  it('opens the palette from Ctrl+K and Ctrl+Shift+P, and not from Ctrl+P', () => {
    const openPalette = vi.fn();
    const commands = buildAppCommands(context({ openPalette }));
    expect(commandForKey(commands, key({ key: 'p', ctrlKey: true }), false)).toBeUndefined();
    commandForKey(commands, key({ key: 'k', ctrlKey: true }), false)?.run?.();
    commandForKey(commands, key({ key: 'P', ctrlKey: true, shiftKey: true }), false)?.run?.();
    expect(openPalette.mock.calls).toEqual([['goto'], ['commands']]);
  });
});
