// Tray and window-close decisions. Kept free of Electron so they can be unit tested.

/**
 * Closing the window hides it while the tray icon keeps Orbit running. Quitting
 * or the absence of a tray icon always closes it, so the user can never lose the app.
 */
export function shouldHideOnClose(state: { quitting: boolean; trayAvailable: boolean }): boolean {
  return !state.quitting && state.trayAvailable;
}

export interface TrayMenuEntry {
  label?: string;
  separator?: boolean;
  onSelect?: () => void;
}

/** The tray menu, independent of Electron so its wiring can be tested. */
export function trayMenuItems(handlers: {
  show: () => void;
  checkForUpdates: () => void;
  quit: () => void;
}): TrayMenuEntry[] {
  return [
    { label: 'Show Orbit', onSelect: handlers.show },
    { label: 'Check for Updates', onSelect: handlers.checkForUpdates },
    { separator: true },
    { label: 'Quit Orbit', onSelect: handlers.quit }
  ];
}
