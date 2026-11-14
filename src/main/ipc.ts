import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IpcChannels, type AppInfo, type OpenExternalResult } from '../shared/ipc';
import { openExternalIfAllowed } from './window';
import { isAppUrl } from './security';

export interface IpcOptions {
  devServerOrigin?: string;
}

/** Rejects calls from anything other than the app's own renderer frames. */
export function assertTrustedSender(event: IpcMainInvokeEvent, devServerOrigin?: string): void {
  const senderUrl = event.senderFrame?.url ?? '';
  if (!isAppUrl(senderUrl, devServerOrigin)) {
    throw new Error('Untrusted IPC sender');
  }
}

export function registerIpcHandlers(options: IpcOptions = {}): void {
  const { devServerOrigin } = options;

  ipcMain.handle(IpcChannels.appGetInfo, (event): AppInfo => {
    assertTrustedSender(event, devServerOrigin);
    return { name: app.getName(), version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle(IpcChannels.appOpenExternal, (event, url: unknown): OpenExternalResult => {
    assertTrustedSender(event, devServerOrigin);
    return { opened: openExternalIfAllowed(url) };
  });
}
