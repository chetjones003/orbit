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
export type RefreshPort = Pick<RefreshEngine, 'refreshNow' | 'wake'> & {
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
  repos?: Pick<RepoService, 'current'>;
  settings?: SettingsStore;
  refresh?: RefreshPort;
  diagnostics?: Pick<Diagnostics, 'report' | 'record'>;
}

/** Rejects calls from anything other than the app's own renderer frames. */
export function assertTrustedSender(event: IpcMainInvokeEvent, devServerOrigin?: string): void {
  const senderUrl = event.senderFrame?.url ?? '';
  if (!isAppUrl(senderUrl, devServerOrigin)) {
    throw new Error('Untrusted IPC sender');
  }
}

export function registerIpcHandlers(options: IpcOptions = {}): void {
  const { devServerOrigin, auth, repos, settings, refresh, diagnostics } = options;

  ipcMain.handle(IpcChannels.appGetInfo, (event): AppInfo => {
    assertTrustedSender(event, devServerOrigin);
    return { name: app.getName(), version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle(IpcChannels.appOpenExternal, (event, url: unknown): OpenExternalResult => {
    assertTrustedSender(event, devServerOrigin);
    return { opened: openExternalIfAllowed(url) };
  });

  if (auth) registerAuthHandlers(auth, devServerOrigin);
  if (refresh) registerRefreshHandlers(refresh, devServerOrigin);
  if (diagnostics) {
    ipcMain.handle(IpcChannels.diagnosticsRecord, (event, entry: unknown): void => {
      assertTrustedSender(event, devServerOrigin);
      const { scope, code } = parseRendererDiagnostic(entry);
      void diagnostics.record({ level: 'warn', scope, code, message: '' });
    });
    ipcMain.handle(IpcChannels.diagnosticsGetReport, (event): string => {
      assertTrustedSender(event, devServerOrigin);
      return diagnostics.report();
    });
  }
  if (repos) {
    ipcMain.handle(IpcChannels.reposList, async (event) => {
      assertTrustedSender(event, devServerOrigin);
      return repos.current();
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

function registerRefreshHandlers(refresh: RefreshPort, devServerOrigin?: string): void {
  ipcMain.handle(IpcChannels.refreshGetStatus, (event): ConnectionStatus => {
    assertTrustedSender(event, devServerOrigin);
    return refresh.getStatus();
  });
  ipcMain.handle(IpcChannels.refreshWake, (event): Promise<RefreshStart> => {
    assertTrustedSender(event, devServerOrigin);
    return refresh.wake();
  });
  ipcMain.handle(IpcChannels.reposRefresh, (event): Promise<RefreshStart> => {
    assertTrustedSender(event, devServerOrigin);
    return refresh.refreshNow();
  });
  refresh.onChange((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.refreshStatusChanged, status);
    }
  });
}

const CODE_PATTERN = /^[a-z][a-z-]{0,39}$/;

/**
 * Renderer-reported diagnostics carry only a scope and a short code. Anything
 * else (free text, tokens, GitHub content) is rejected before it reaches the log.
 */
export function parseRendererDiagnostic(input: unknown): { scope: string; code: string } {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid diagnostic');
  const { scope, code } = input as { scope?: unknown; code?: unknown };
  if (typeof scope !== 'string' || typeof code !== 'string') throw new Error('Invalid diagnostic');
  if (!CODE_PATTERN.test(scope) || !CODE_PATTERN.test(code)) throw new Error('Invalid diagnostic');
  return { scope, code };
}
