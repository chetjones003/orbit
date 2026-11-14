import { app, BrowserWindow, safeStorage } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { registerIpcHandlers } from './ipc';
import { createMainWindow } from './window';
import { runSmokeTest } from './smoke';
import { registerAppProtocol, registerAppScheme } from './protocol';
import { AuthService } from './github/auth-service';
import { CredentialStore } from './github/credential-store';
import { resolveGitHubEndpoints } from './github/endpoints';

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

  void app.whenReady().then(async () => {
    if (!devServerOrigin) {
      registerAppProtocol(join(__dirname, '../renderer'));
    }
    const auth = new AuthService({
      ...resolveGitHubEndpoints(process.env['ORBIT_GITHUB_URL']),
      store: new CredentialStore({ dir: app.getPath('userData'), safeStorage })
    });
    // A restore failure must not block launch; the user simply starts signed out.
    await auth.initialize().catch((error: unknown) => {
      console.error('Stored sign-in restore failed:', error instanceof Error ? error.name : 'unknown');
    });
    registerIpcHandlers({ devServerOrigin, auth });
    const win = createMainWindow({ devServerOrigin, show: !smokeReportPath });
    if (smokeReportPath) {
      void runSmokeTest(win, smokeReportPath);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
