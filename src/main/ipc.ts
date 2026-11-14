import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IpcChannels, type AppInfo, type OpenExternalResult, type SettingsUpdate } from '../shared/ipc';
import type { AuthStatus } from '../shared/auth';
import { openExternalIfAllowed } from './window';
import { isAppUrl } from './security';
import type { AuthService } from './github/auth-service';
import type { RepoService } from './github/repo-service';
import type { SettingsStore } from './settings';
import type { ConnectionStatus, RefreshStart } from '../shared/connection';
import type { RefreshEngine } from './github/refresh-engine';
import type { Diagnostics } from './diagnostics';

/** The part of the refresh engine that IPC needs. */
export type ConnectionPort = Pick<RefreshEngine, 'refreshNow'> & {
  getStatus(): ConnectionStatus;
  onChange(listener: (status: ConnectionStatus) => void): () => void;
};

/** The part of the auth service that IPC needs. Tests can supply a plain object. */
export type AuthPort = Pick<
  AuthService,
  'getStatus' | 'startSignIn' | 'cancelSignIn' | 'signOut' | 'onStatusChange'
>;

export interface IpcOptions {
  devServerOrigin?: string;
  auth?: AuthPort;
  repos?: Pick<RepoService, 'listPersonalRepos'>;
  settings?: SettingsStore;
  connection?: ConnectionPort;
  diagnostics?: Pick<Diagnostics, 'report'>;
}

/** Rejects calls from anything other than the app's own renderer frames. */
export function assertTrustedSender(event: IpcMainInvokeEvent, devServerOrigin?: string): void {
  const senderUrl = event.senderFrame?.url ?? '';
  if (!isAppUrl(senderUrl, devServerOrigin)) {
    throw new Error('Untrusted IPC sender');
  }
}

export function registerIpcHandlers(options: IpcOptions = {}): void {
  const { devServerOrigin, auth, repos, settings, connection, diagnostics } = options;

  ipcMain.handle(IpcChannels.appGetInfo, (event): AppInfo => {
    assertTrustedSender(event, devServerOrigin);
    return { name: app.getName(), version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle(IpcChannels.appOpenExternal, (event, url: unknown): OpenExternalResult => {
    assertTrustedSender(event, devServerOrigin);
    return { opened: openExternalIfAllowed(url) };
  });

  if (auth) registerAuthHandlers(auth, devServerOrigin);
  if (connection) registerConnectionHandlers(connection, devServerOrigin);
  if (diagnostics) {
    ipcMain.handle(IpcChannels.diagnosticsGetReport, (event): string => {
      assertTrustedSender(event, devServerOrigin);
      return diagnostics.report();
    });
  }
  if (repos) {
    ipcMain.handle(IpcChannels.reposList, async (event) => {
      assertTrustedSender(event, devServerOrigin);
      return repos.listPersonalRepos();
    });
  }
  if (settings) {
    ipcMain.handle(IpcChannels.settingsGet, async (event) => {
      assertTrustedSender(event, devServerOrigin);
      return settings.load();
    });
    ipcMain.handle(IpcChannels.settingsUpdate, async (event, update: SettingsUpdate) => {
      assertTrustedSender(event, devServerOrigin);
      return settings.update(update);
    });
  }
}

/**
 * Auth calls are synchronous up to the service call, so an untrusted sender is
 * rejected before the service sees anything.
 */
function registerAuthHandlers(auth: AuthPort, devServerOrigin?: string): void {
  ipcMain.handle(IpcChannels.authGetStatus, (event): AuthStatus => {
    assertTrustedSender(event, devServerOrigin);
    return auth.getStatus();
  });
  ipcMain.handle(IpcChannels.authStartSignIn, (event): Promise<AuthStatus> => {
    assertTrustedSender(event, devServerOrigin);
    return auth.startSignIn();
  });
  ipcMain.handle(IpcChannels.authCancelSignIn, (event): AuthStatus => {
    assertTrustedSender(event, devServerOrigin);
    return auth.cancelSignIn();
  });
  ipcMain.handle(IpcChannels.authSignOut, (event): Promise<AuthStatus> => {
    assertTrustedSender(event, devServerOrigin);
    return auth.signOut();
  });

  auth.onStatusChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.authStatusChanged, status);
    }
  });
}

function registerConnectionHandlers(connection: ConnectionPort, devServerOrigin?: string): void {
  ipcMain.handle(IpcChannels.connectionGetStatus, (event): ConnectionStatus => {
    assertTrustedSender(event, devServerOrigin);
    return connection.getStatus();
  });
  ipcMain.handle(IpcChannels.reposRefresh, (event): Promise<RefreshStart> => {
    assertTrustedSender(event, devServerOrigin);
    return connection.refreshNow();
  });
  connection.onChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.connectionStatusChanged, status);
    }
  });
}
