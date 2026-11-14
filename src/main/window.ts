import { BrowserWindow, shell, session, type Event as ElectronEvent } from 'electron';
import { join } from 'node:path';
import { parseExternalUrl } from '../shared/ipc';
import { buildContentSecurityPolicy, isAppUrl } from './security';
import { APP_ENTRY_URL } from './protocol';

export interface WindowOptions {
  devServerOrigin?: string;
  show?: boolean;
}

/** Web preferences every renderer window uses. Never relaxed, including for tests. */
export const HARDENED_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  experimentalFeatures: false,
  webviewTag: false
} as const;

/**
 * Creates the single main window with hardened web preferences. Navigation and
 * window-open are blocked; https links leave only through the controlled
 * external-open path.
 */
export function createMainWindow(options: WindowOptions = {}): BrowserWindow {
  const { devServerOrigin } = options;

  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 540,
    show: options.show ?? true,
    webPreferences: {
      ...HARDENED_WEB_PREFERENCES,
      preload: join(__dirname, '../preload/index.js')
    }
  });

  const csp = buildContentSecurityPolicy({ devServerOrigin });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!isAppUrl(details.url, devServerOrigin)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        'Content-Security-Policy': [csp]
      }
    });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfAllowed(url);
    return { action: 'deny' };
  });

  const blockNavigation = (event: ElectronEvent, url: string): void => {
    if (isAppUrl(url, devServerOrigin)) return;
    event.preventDefault();
    openExternalIfAllowed(url);
  };
  win.webContents.on('will-navigate', (event, url) => blockNavigation(event, url));
  win.webContents.on('will-frame-navigate', (details) => {
    if (isAppUrl(details.url, devServerOrigin)) return;
    details.preventDefault();
    openExternalIfAllowed(details.url);
  });
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());

  void win.loadURL(devServerOrigin ?? APP_ENTRY_URL);
  return win;
}

/** Opens only validated https URLs in the system browser. */
export function openExternalIfAllowed(input: unknown): boolean {
  const url = parseExternalUrl(input);
  if (!url) return false;
  void shell.openExternal(url.toString());
  return true;
}
