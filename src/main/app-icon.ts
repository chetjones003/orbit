import { app } from 'electron';
import { join } from 'node:path';

/**
 * The icon file the window and tray use. Windows gets build/icon.ico, which carries several sizes;
 * a single 1024 px PNG is not drawn reliably in the taskbar. Other platforms use the PNG.
 */
export function appIconPath(): string {
  return join(app.getAppPath(), 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
}
