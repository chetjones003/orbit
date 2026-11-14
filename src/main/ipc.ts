import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IpcChannels, type AppInfo, type OpenExternalResult } from '../shared/ipc';
import type { AuthStatus } from '../shared/auth';
import { openExternalIfAllowed } from './window';
import { isAppUrl } from './security';
import type { AuthService } from './github/auth-service';

/** The part of the auth service that IPC needs. Tests can supply a plain object. */
export type AuthPort = Pick<
  AuthService,
  'getStatus' | 'startSignIn' | 'cancelSignIn' | 'signOut' | 'onStatusChange'
>;

export interface IpcOptions {
  devServerOrigin?: string;
  auth?: AuthPort;
}

/** Rejects calls from anything other than the app's own renderer frames. */
export function assertTrustedSender(event: IpcMainInvokeEvent, devServerOrigin?: string): void {
  const senderUrl = event.senderFrame?.url ?? '';
  if (!isAppUrl(senderUrl, devServerOrigin)) {
    throw new Error('Untrusted IPC sender');
  }
}

export function registerIpcHandlers(options: IpcOptions = {}): void {
  const { devServerOrigin, auth } = options;

  ipcMain.handle(IpcChannels.appGetInfo, (event): AppInfo => {
    assertTrustedSender(event, devServerOrigin);
    return { name: app.getName(), version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle(IpcChannels.appOpenExternal, (event, url: unknown): OpenExternalResult => {
    assertTrustedSender(event, devServerOrigin);
    return { opened: openExternalIfAllowed(url) };
  });

  if (auth) registerAuthHandlers(auth, devServerOrigin);
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
