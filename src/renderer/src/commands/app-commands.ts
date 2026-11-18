import type { ShellAction } from '../../../shared/ipc';
import type { RepoRef } from '../../../shared/search';
import type { WorkspaceView } from '../chrome/WorkspaceNav';
import type { PaletteMode } from '../palette/palette-model';
import type { Command, CommandChoices, IconName, Shortcut } from './commands';

export const WORKSPACE_SECTIONS: ReadonlyArray<{ view: WorkspaceView; title: string; icon: IconName }> = [
  { view: 'inbox', title: 'Inbox', icon: 'inbox' },
  { view: 'issues', title: 'Issues', icon: 'issue' },
  { view: 'pulls', title: 'Pull requests', icon: 'pull' },
  { view: 'projects', title: 'Projects', icon: 'projects' },
  { view: 'repos', title: 'Repositories', icon: 'repos' }
];

export interface AppCommandContext {
  signedIn: boolean;
  nextThemeLabel: string;
  nextThemeIcon: IconName;
  trackedRepos: RepoRef[];
  /** The repository on screen, offered first when a command asks for one. */
  currentRepoFullName: string | null;
  openPalette(mode: PaletteMode): void;
  goTo(view: WorkspaceView): void;
  newIssue(repoFullName: string): void;
  newPull(repoFullName: string): void;
  toggleTheme(): void;
  openSettings(): void;
  refresh(): void;
  checkUpdates(): void;
  copyDiagnostics(): void;
  signOut(): void;
  shell(action: ShellAction): void;
}

const mod = (key: string, extra: Partial<Shortcut> = {}): Shortcut => ({ key, mod: true, ...extra });

function repoChoices(context: AppCommandContext, run: (repoFullName: string) => void): CommandChoices {
  const current = context.currentRepoFullName;
  return {
    placeholder: 'Choose a repository',
    options: context.trackedRepos
      .toSorted((a, b) => Number(b.fullName === current) - Number(a.fullName === current))
      .map((repo) => ({ id: repo.fullName, title: repo.fullName })),
    run
  };
}

/** Every command in Orbit. Built on each render, so availability and handlers always match the current state. */
export function buildAppCommands(context: AppCommandContext): Command[] {
  const { signedIn, shell } = context;
  const canCreate = signedIn && context.trackedRepos.length > 0;
  const shellCommand = (
    id: string,
    title: string,
    category: string,
    icon: IconName,
    action: ShellAction,
    extra: Partial<Command> = {}
  ): Command => ({ id, title, category, icon, available: true, run: () => shell(action), ...extra });
  const editCommand = (id: string, title: string, key: string, action: ShellAction): Command =>
    shellCommand(`edit.${id}`, title, 'Edit', 'task', action, {
      inPalette: false,
      shortcuts: [mod(key, { native: true })]
    });

  return [
    {
      id: 'palette.goTo',
      title: 'Go to or search',
      category: 'Palette',
      icon: 'search',
      available: signedIn,
      inPalette: false,
      keepsPalette: true,
      shortcuts: [mod('k')],
      run: () => context.openPalette('goto')
    },
    {
      id: 'palette.commands',
      title: 'Command palette',
      category: 'Palette',
      icon: 'search',
      available: true,
      inPalette: false,
      keepsPalette: true,
      shortcuts: [mod('p', { shift: true })],
      run: () => context.openPalette('commands')
    },
    ...WORKSPACE_SECTIONS.map(({ view, title, icon }): Command => ({
      id: `go.${view === 'pulls' ? 'pulls' : view}`,
      title: `Go to ${view === 'pulls' ? 'pull requests' : title.toLowerCase()}`,
      category: 'Go to',
      icon,
      available: signedIn,
      run: () => context.goTo(view)
    })),
    {
      id: 'create.issue',
      title: 'New issue',
      category: 'Create',
      icon: 'issue',
      available: canCreate,
      choose: repoChoices(context, context.newIssue)
    },
    {
      id: 'create.pull',
      title: 'New pull request',
      category: 'Create',
      icon: 'pull',
      available: canCreate,
      choose: repoChoices(context, context.newPull)
    },
    {
      id: 'app.settings',
      title: 'Open settings',
      category: 'Orbit',
      icon: 'settings',
      available: true,
      shortcuts: [mod(',')],
      run: context.openSettings
    },
    {
      id: 'app.refresh',
      title: 'Refresh repositories',
      category: 'Orbit',
      icon: 'refresh',
      available: signedIn,
      run: context.refresh
    },
    {
      id: 'app.updates',
      title: 'Check for updates',
      category: 'Orbit',
      icon: 'updateArrow',
      available: true,
      run: context.checkUpdates
    },
    {
      id: 'app.diagnostics',
      title: 'Copy diagnostics',
      category: 'Orbit',
      icon: 'info',
      available: true,
      run: context.copyDiagnostics
    },
    {
      id: 'app.signOut',
      title: 'Sign out',
      category: 'Orbit',
      icon: 'signOut',
      available: signedIn,
      run: context.signOut
    },
    {
      id: 'view.theme',
      title: context.nextThemeLabel,
      category: 'View',
      icon: context.nextThemeIcon,
      available: true,
      run: context.toggleTheme
    },
    shellCommand('view.zoomIn', 'Zoom in', 'View', 'plus', 'zoom-in', {
      repeatable: true,
      shortcuts: [mod('='), mod('+')]
    }),
    shellCommand('view.zoomOut', 'Zoom out', 'View', 'minimize', 'zoom-out', {
      repeatable: true,
      shortcuts: [mod('-')]
    }),
    shellCommand('view.zoomReset', 'Actual size', 'View', 'reset', 'zoom-reset', {
      shortcuts: [mod('0')]
    }),
    shellCommand('view.fullscreen', 'Full screen', 'View', 'expand', 'toggle-fullscreen', {
      shortcuts: [{ key: 'F11' }]
    }),
    shellCommand('window.minimize', 'Minimize', 'Window', 'minimize', 'minimize'),
    shellCommand('window.maximize', 'Maximize or restore', 'Window', 'maximize', 'toggle-maximize'),
    shellCommand('window.close', 'Close window', 'Window', 'close', 'close'),
    shellCommand('window.quit', 'Quit Orbit', 'Window', 'signOut', 'quit', {
      shortcuts: [mod('q', { nativeOnMac: true })]
    }),
    editCommand('undo', 'Undo', 'z', 'undo'),
    editCommand('redo', 'Redo', 'y', 'redo'),
    editCommand('cut', 'Cut', 'x', 'cut'),
    editCommand('copy', 'Copy', 'c', 'copy'),
    editCommand('paste', 'Paste', 'v', 'paste'),
    editCommand('selectAll', 'Select all', 'a', 'select-all')
  ];
}
