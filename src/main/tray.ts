import { Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron';
import { appIconPath } from './app-icon';
import { trayMenuItems } from './tray-policy';

/**
 * Creates the system tray icon. Its menu and click behaviour come from trayMenuItems,
 * so the menu is tested without Electron. The icon ships with the app (see appIconPath).
 */
export function createTray(handlers: {
  show: () => void;
  checkForUpdates: () => void;
  quit: () => void;
}): Tray {
  const tray = new Tray(nativeImage.createFromPath(appIconPath()));
  tray.setToolTip('Orbit');
  const template: MenuItemConstructorOptions[] = trayMenuItems(handlers).map((entry) =>
    entry.separator ? { type: 'separator' } : { label: entry.label, click: entry.onSelect }
  );
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.on('click', handlers.show);
  return tray;
}
