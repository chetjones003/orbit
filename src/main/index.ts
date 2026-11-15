import { app, BrowserWindow, powerMonitor, safeStorage } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { registerIpcHandlers } from './ipc';
import { createMainWindow } from './window';
import { runSmokeTest } from './smoke';
import { registerAppProtocol, registerAppScheme } from './protocol';
import { AuthService } from './github/auth-service';
import { CredentialStore } from './github/credential-store';
import { resolveGitHubEndpoints } from './github/endpoints';
import { RepoService } from './github/repo-service';
import { IssueService } from './github/issue-service';
import { GitHubClient } from './github/github-client';
import { RefreshEngine } from './github/refresh-engine';
import { Diagnostics } from './diagnostics';
import { SettingsStore } from './settings';
import { writesAllowed } from '../shared/connection';

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
    const settings = new SettingsStore(app.getPath('userData'));
    const diagnostics = new Diagnostics({ dir: join(app.getPath('userData'), 'logs') });
    // A restore failure must not block launch; the user simply starts signed out.
    await auth.initialize().catch((error: unknown) => {
      console.error('Stored sign-in restore failed:', error instanceof Error ? error.name : 'unknown');
    });
    const endpoints = resolveGitHubEndpoints(process.env['ORBIT_GITHUB_URL']);
    const client = new GitHubClient({ apiBaseUrl: endpoints.apiBaseUrl });
    const repos = new RepoService({ auth, apiBaseUrl: endpoints.apiBaseUrl, client });
    // Writes are refused while the engine reports offline or rate limiting, so outcomes stay certain.
    const issues = new IssueService({
      auth,
      apiBaseUrl: endpoints.apiBaseUrl,
      client,
      canWrite: () => writesAllowed(engine.getStatus())
    });
    // Visible data refreshes only while signed in. The ETag cache stays in memory.
    const engine = new RefreshEngine({
      refresh: () => repos.listPersonalRepos().then(() => undefined),
      canRefresh: () => auth.getStatus().kind === 'signed-in'
    });
    // After sleep the network may be back before the backoff timer fires; retry at once.
    powerMonitor.on('resume', () => void engine.wake());
    let lastState = engine.getStatus().state;
    engine.onChange((status) => {
      if (status.state === lastState) return;
      lastState = status.state;
      void diagnostics.record({
        level: status.state === 'fresh' ? 'info' : 'warn',
        scope: 'refresh',
        code: status.state,
        message: status.nextRetryAt
          ? `next attempt at ${new Date(status.nextRetryAt).toISOString()}`
          : 'no retry scheduled'
      });
    });
    const runWhileSignedIn = (signedIn: boolean): void => {
      engine.stop();
      if (signedIn) engine.start();
    };
    auth.onStatusChange((status) => runWhileSignedIn(status.kind === 'signed-in'));
    runWhileSignedIn(auth.getStatus().kind === 'signed-in');
    registerIpcHandlers({
      devServerOrigin,
      auth,
      repos,
      issues,
      comments: issues,
      settings,
      refresh: engine,
      diagnostics
    });
    const win = createMainWindow({
      devServerOrigin,
      show: !smokeReportPath,
      windowState: (await settings.load()).windowState,
      saveWindowState: (state) => void settings.saveWindowState(state)
    });
    if (smokeReportPath) {
      void runSmokeTest(win, smokeReportPath);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
