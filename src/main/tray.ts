import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import { join } from 'node:path';
import { trayMenuItems } from './tray-policy';

/**
 * Creates the system tray icon. Its menu and click behaviour come from trayMenuItems,
 * so the menu is tested without Electron. The icon ships with the app as build/icon.png.
 */
export function createTray(handlers: { show: () => void; quit: () => void }): Tray {
  const tray = new Tray(nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png')));
  tray.setToolTip('Orbit');
  const template: MenuItemConstructorOptions[] = trayMenuItems(handlers).map((entry) =>
    entry.separator ? { type: 'separator' } : { label: entry.label, click: entry.onSelect }
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.on('click', handlers.show);
  return tray;
}
