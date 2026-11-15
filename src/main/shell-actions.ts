import { app, type BrowserWindow, type WebContents } from 'electron';
import type { ShellAction, ShellState } from '../shared/ipc';

const ZOOM_STEP = 0.5;
const ZOOM_LIMIT = 3;

function clampZoom(level: number): number {
  return Math.max(-ZOOM_LIMIT, Math.min(ZOOM_LIMIT, level));
}

/** The window state the custom title bar shows: maximize/restore icon and full-screen state. */
export function shellStateOf(win: BrowserWindow | null): ShellState {
  if (!win || win.isDestroyed()) return { maximized: false, fullscreen: false };
  return { maximized: win.isMaximized(), fullscreen: win.isFullScreen() };
}

/**
 * Runs one command the renderer asked for, on the window and page that asked. Only actions named in
 * SHELL_ACTIONS reach this function; the IPC handler refuses everything else.
 */
export function runShellAction(contents: WebContents, win: BrowserWindow | null, action: ShellAction): void {
  switch (action) {
    case 'minimize':
      win?.minimize();
      return;
    case 'toggle-maximize':
      if (!win) return;
      if (win.isMaximized()) win.unmaximize();
      else win.maximize();
      return;
    case 'close':
      // Closing hides to the tray when notifications are on, exactly as the native close button does.
      win?.close();
      return;
    case 'toggle-fullscreen':
      win?.setFullScreen(!win.isFullScreen());
      return;
    case 'zoom-in':
      contents.setZoomLevel(clampZoom(contents.getZoomLevel() + ZOOM_STEP));
      return;
    case 'zoom-out':
      contents.setZoomLevel(clampZoom(contents.getZoomLevel() - ZOOM_STEP));
      return;
    case 'zoom-reset':
      contents.setZoomLevel(0);
      return;
    case 'undo':
      contents.undo();
      return;
    case 'redo':
      contents.redo();
      return;
    case 'cut':
      contents.cut();
      return;
    case 'copy':
      contents.copy();
      return;
    case 'paste':
      contents.paste();
      return;
    case 'select-all':
      contents.selectAll();
      return;
    case 'quit':
      // The real quit path: before-quit marks it, so unsent comment text still asks first.
      app.quit();
      return;
  }
}
