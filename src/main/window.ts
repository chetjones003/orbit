import { BrowserWindow, Menu, dialog, shell, session, type Event as ElectronEvent } from 'electron';
import { join } from 'node:path';
import { parseExternalUrl } from '../shared/ipc';
import { buildContentSecurityPolicy, isAppUrl } from './security';
import { APP_ENTRY_URL } from './protocol';
import type { WindowState } from '../shared/ipc';
import { IpcChannels } from '../shared/ipc';
import { shellStateOf } from './shell-actions';
import { appIconPath } from './app-icon';

export interface WindowOptions {
  devServerOrigin?: string;
  show?: boolean;
  windowState?: WindowState | null;
  saveWindowState?: (state: WindowState) => void;
  /** Asked when the window closes. True hides it instead, so notifications keep arriving from the tray. */
  hideOnClose?: () => boolean;
  /** The fake GitHub's origin during debugging; media from it is allowed. Null otherwise. */
  mediaOrigin?: string | null;
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
  const restored = options.windowState;
  // Windows and Linux draw their own title and menu bars, so the native menu goes. macOS keeps its
  // menu bar and traffic lights; the title bar only leaves room for them.
  const ownChrome = process.platform !== 'darwin';
  if (ownChrome) Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    x: restored?.x,
    y: restored?.y,
    width: restored?.width ?? 1100,
    height: restored?.height ?? 720,
    minWidth: 800,
    minHeight: 540,
    show: options.show ?? true,
    // The taskbar shows the window's icon. Without this, a dev run (Electron's own binary) shows Electron's logo.
    icon: appIconPath(),
    ...(ownChrome ? { frame: false } : { titleBarStyle: 'hidden' as const }),
    webPreferences: {
      ...HARDENED_WEB_PREFERENCES,
      preload: join(__dirname, '../preload/index.js')
    }
  });
  if (restored?.maximized) win.maximize();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persistState = (): void => {
    const bounds = win.getNormalBounds();
    options.saveWindowState?.({ ...bounds, maximized: win.isMaximized() });
  };
  const saveState = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistState, 250);
  };
  win.on('resize', saveState);
  win.on('move', saveState);
  win.on('maximize', saveState);
  win.on('unmaximize', saveState);
  const sendShellState = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.shellStateChanged, shellStateOf(win));
  };
  win.on('maximize', sendShellState);
  win.on('unmaximize', sendShellState);
  win.on('enter-full-screen', sendShellState);
  win.on('leave-full-screen', sendShellState);
  win.on('close', (event) => {
    if (options.hideOnClose?.()) {
      event.preventDefault();
      win.hide();
    }
    if (saveTimer) clearTimeout(saveTimer);
    persistState();
  });

  const csp = buildContentSecurityPolicy({ devServerOrigin, mediaOrigin: options.mediaOrigin });
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
  // The renderer blocks unload while comment text is unsent. Ask before discarding it; Keep editing stays open.
  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep editing', 'Discard and close'],
      defaultId: 0,
      cancelId: 0,
      message: 'You have unsent comment text.',
      detail: 'Closing Orbit discards it. Unsent text is kept only in memory and is never saved to disk.'
    });
    if (choice === 1) event.preventDefault();
  });

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
