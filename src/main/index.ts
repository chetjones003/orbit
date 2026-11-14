import { app, BrowserWindow } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { registerIpcHandlers } from './ipc';
import { createMainWindow } from './window';
import { runSmokeTest } from './smoke';
import { registerAppProtocol, registerAppScheme } from './protocol';

const devServerOrigin = process.env['ELECTRON_RENDERER_URL'];
const smokeReportPath = process.env['ORBIT_SMOKE_REPORT'];

// Must be registered before app ready. Dev uses the Vite origin instead.
if (!devServerOrigin) {
  registerAppScheme();
}

// Smoke runs use an isolated profile so they never touch a real user's data.
const isolatedProfile = process.env['ORBIT_USER_DATA'];
if (isolatedProfile) {
  mkdirSync(isolatedProfile, { recursive: true });
  app.setPath('userData', isolatedProfile);
}

// Single instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(() => {
    if (!devServerOrigin) {
      registerAppProtocol(join(__dirname, '../renderer'));
    }
    registerIpcHandlers({ devServerOrigin });
    const win = createMainWindow({ devServerOrigin, show: !smokeReportPath });
    if (smokeReportPath) {
      void runSmokeTest(win, smokeReportPath);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
