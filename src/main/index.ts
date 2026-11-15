import { app, BrowserWindow, Notification, powerMonitor, safeStorage, type Tray } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { broadcast, registerIpcHandlers } from './ipc';
import { IpcChannels } from '../shared/ipc';
import { createMainWindow } from './window';
import { runSmokeTest } from './smoke';
import { registerAppProtocol, registerAppScheme } from './protocol';
import { AuthService } from './github/auth-service';
import { CredentialStore } from './github/credential-store';
import { debugMediaOrigin, resolveGitHubEndpoints } from './github/endpoints';
import { RepoService } from './github/repo-service';
import { IssueService } from './github/issue-service';
import { InboxService } from './github/inbox-service';
import { ProjectsService } from './github/projects-service';
import { GitHubClient } from './github/github-client';
import { RefreshEngine } from './github/refresh-engine';
import { NotificationService } from './github/notification-service';
import { NotificationCenter } from './notification-center';
import type { DesktopNotice } from './notification-policy';
import { shouldHideOnClose } from './tray-policy';
import type { NotificationOpenResult } from '../shared/notifications';
import { createTray } from './tray';
import { Diagnostics } from './diagnostics';
import { UpdateService } from './updates/update-service';
import { createUpdateDriver } from './updates/updater';
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

// Windows groups and attributes native notifications by this id. It must match the installer's id.
app.setAppUserModelId('dev.orbit.app');

// On some Windows GPUs the compositor stops producing frames once an item opens, so transitions freeze (the side
// panel animations among them). Orbit is a light UI, so it draws in software instead. Must run before ready.
app.disableHardwareAcceleration();

// Set on the real quit path (tray menu, app menu, OS shutdown). Closing the window alone only hides it.
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});

/** Shows the main window and brings it to the front, from the tray or a notification click. */
function focusMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
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
    const client = new GitHubClient({
      apiBaseUrl: endpoints.apiBaseUrl,
      uploadsBaseUrl: endpoints.uploadsBaseUrl
    });
    const repos = new RepoService({ auth, apiBaseUrl: endpoints.apiBaseUrl, client });
    const inbox = new InboxService({ auth, apiBaseUrl: endpoints.apiBaseUrl, client });
    // Writes are refused while the engine reports offline or rate limiting, so outcomes stay certain.
    const issues = new IssueService({
      auth,
      apiBaseUrl: endpoints.apiBaseUrl,
      uploadsBaseUrl: endpoints.uploadsBaseUrl,
      client,
      canWrite: () => writesAllowed(engine.getStatus()),
      attachmentNotice: {
        isAcknowledged: async () => (await settings.load()).publicUploadNoticeAcknowledged,
        acknowledge: async () => {
          await settings.acknowledgePublicUploadNotice();
        }
      }
    });
    // Visible data refreshes only while signed in. The ETag cache stays in memory.
    const engine = new RefreshEngine({
      refresh: () => repos.listPersonalRepos().then(() => undefined),
      canRefresh: () => auth.getStatus().kind === 'signed-in'
    });
    // Notifications poll on their own schedule: they are a signal, not the visible data. Their dedupe
    // state lives in memory for one session. Desktop notices show only when Orbit is not focused.
    const notificationService = new NotificationService({
      auth,
      apiBaseUrl: endpoints.apiBaseUrl,
      client
    });
    const notificationCenter = new NotificationCenter({
      service: notificationService,
      isFocused: () => BrowserWindow.getAllWindows().some((win) => win.isFocused()),
      deliver: (delivery) => broadcast(IpcChannels.notificationsDelivered, delivery),
      notify: (notice) => showDesktopNotice(notice, (threadId) => notificationCenter.open(threadId))
    });
    const notificationEngine = new RefreshEngine({
      refresh: () => notificationCenter.pollOnce(),
      canRefresh: () => auth.getStatus().kind === 'signed-in'
    });
    // After sleep the network may be back before the backoff timer fires; retry at once.
    powerMonitor.on('resume', () => {
      void engine.wake();
      void notificationEngine.wake();
    });
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
      notificationEngine.stop();
      if (signedIn) {
        engine.start();
        notificationEngine.start();
      }
    };
    auth.onStatusChange((status) => runWhileSignedIn(status.kind === 'signed-in'));
    runWhileSignedIn(auth.getStatus().kind === 'signed-in');
    const projects = new ProjectsService({
      auth,
      apiBaseUrl: endpoints.apiBaseUrl,
      client,
      canWrite: () => writesAllowed(engine.getStatus())
    });
    // Smoke runs skip updates: they must never reach GitHub or install anything.
    const updateService = smokeReportPath
      ? null
      : new UpdateService({ currentVersion: app.getVersion(), ...createUpdateDriver() });
    registerIpcHandlers({
      devServerOrigin,
      updates: updateService ?? undefined,
      auth,
      repos,
      issues,
      inbox,
      projects,
      comments: issues,
      settings,
      refresh: engine,
      notifications: notificationCenter,
      diagnostics
    });
    // The tray keeps Orbit running after the window is closed. Smoke runs have no user to return to it.
    let tray: Tray | null = null;
    const win = createMainWindow({
      devServerOrigin,
      mediaOrigin: debugMediaOrigin(process.env['ORBIT_GITHUB_URL']),
      show: !smokeReportPath,
      windowState: (await settings.load()).windowState,
      saveWindowState: (state) => void settings.saveWindowState(state),
      hideOnClose: () => shouldHideOnClose({ quitting, trayAvailable: tray !== null })
    });
    if (!smokeReportPath) {
      tray = createTray({
        show: focusMainWindow,
        checkForUpdates: () => void updateService?.checkNow(),
        quit: () => app.quit()
      });
    }
    // Checks at startup and every four hours; the service does nothing for unpackaged builds.
    if (app.isPackaged) updateService?.start();
    if (smokeReportPath) {
      void runSmokeTest(win, smokeReportPath);
    }
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

/** Native notifications that are still on screen. Held so they are not garbage-collected before a click. */
const liveNotices = new Set<Notification>();

/** Shows one desktop notice. A click focuses Orbit and, for an item, marks it read and opens it. */
function showDesktopNotice(
  notice: DesktopNotice,
  open: (threadId: string) => Promise<NotificationOpenResult>
): void {
  if (!Notification.isSupported()) return;
  const native = new Notification({ title: notice.title, body: notice.body });
  liveNotices.add(native);
  native.on('click', () => {
    focusMainWindow();
    if (notice.threadId) {
      void open(notice.threadId).then((result) => broadcast(IpcChannels.notificationsNavigate, result));
    }
  });
  native.on('close', () => liveNotices.delete(native));
  native.show();
}
