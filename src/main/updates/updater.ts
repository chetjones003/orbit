import { app, shell } from 'electron';
import { autoUpdater, type UpdateInfo } from 'electron-updater';
import { spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import { downloadVerified } from './download';
import { pickMacAsset, type ReleaseFile } from '../../shared/updates';
import type { PreparedUpdate, RemoteRelease, UpdateServiceOptions } from './update-service';

/** Public GitHub Releases for Orbit. Assets live under the tag `v<version>`. */
const RELEASE_DOWNLOADS = 'https://github.com/chetjones003/orbit/releases/download';

function releaseNotes(notes: UpdateInfo['releaseNotes']): string | null {
  if (typeof notes === 'string') return notes.trim() || null;
  if (Array.isArray(notes)) {
    const text = notes
      .map((entry) => entry.note ?? '')
      .filter((note) => note.trim() !== '')
      .join('\n\n');
    return text || null;
  }
  return null;
}

/**
 * How this install takes an update. electron-updater handles Windows (NSIS), AppImage, and signed
 * macOS builds; Orbit ships unsigned macOS DMGs, so macOS is handled directly. A .deb install cannot be
 * updated in place by electron-updater, so it is downloaded and installed with administrator approval.
 */
type InstallMode = 'electron-updater' | 'mac-dmg' | 'linux-deb';

export function installMode(platform: NodeJS.Platform, appImage: string | undefined): InstallMode {
  if (platform === 'darwin') return 'mac-dmg';
  if (platform === 'linux' && !appImage) return 'linux-deb';
  return 'electron-updater';
}

/**
 * Wires electron-updater and the platform install paths into the UpdateService. Nothing downloads
 * until the service asks, and nothing restarts until the user confirms through `install`.
 */
export function createUpdateDriver(): Pick<UpdateServiceOptions, 'check' | 'prepare'> {
  // Explicit, so a future default change cannot start automatic installs or offer prereleases/downgrades.
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  const mode = installMode(process.platform, process.env['APPIMAGE']);
  const downloadDir = join(app.getPath('temp'), 'orbit-updates');

  return {
    check: async (): Promise<RemoteRelease | null> => {
      // Unpackaged builds have no release to compare against; checking would only report an error.
      if (!app.isPackaged) return null;
      const result = await autoUpdater.checkForUpdates();
      const info = result?.updateInfo;
      if (!info) return null;
      return {
        version: info.version,
        releaseNotes: releaseNotes(info.releaseNotes),
        files: (info.files ?? []) as ReleaseFile[]
      };
    },
    prepare: async (release, onProgress): Promise<PreparedUpdate> => {
      if (mode === 'mac-dmg') {
        const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
        const file = pickMacAsset(release.files, arch);
        if (!file) throw new Error(`No ${arch} DMG in release ${release.version}`);
        const dest = join(downloadDir, basename(file.url));
        await downloadVerified({ url: assetUrl(release.version, file.url), sha512: file.sha512, dest });
        onProgress(100);
        const failure = await shell.openPath(dest);
        if (failure) throw new Error('The downloaded DMG could not be opened');
        return {
          status: { kind: 'mac-opened', version: release.version },
          install: async () => undefined
        };
      }

      if (mode === 'linux-deb') {
        const file = release.files.find((entry) => entry.url.endsWith('.deb'));
        if (!file) throw new Error(`No .deb in release ${release.version}`);
        const dest = join(downloadDir, basename(file.url));
        await downloadVerified({ url: assetUrl(release.version, file.url), sha512: file.sha512, dest });
        onProgress(100);
        return {
          status: { kind: 'ready', version: release.version, releaseNotes: release.releaseNotes },
          install: () => installDeb(dest)
        };
      }

      const onDownload = (progress: { percent: number }): void => onProgress(progress.percent);
      autoUpdater.on('download-progress', onDownload);
      try {
        await autoUpdater.downloadUpdate();
      } finally {
        autoUpdater.off('download-progress', onDownload);
      }
      return {
        status: { kind: 'ready', version: release.version, releaseNotes: release.releaseNotes },
        install: async () => {
          autoUpdater.quitAndInstall(false, true);
        }
      };
    }
  };
}

function assetUrl(version: string, name: string): string {
  return `${RELEASE_DOWNLOADS}/v${version}/${encodeURIComponent(basename(name))}`;
}

/**
 * Installs a downloaded .deb through polkit, which asks for administrator credentials. Orbit restarts
 * only when the install succeeds; a cancelled prompt leaves the current version running.
 */
function installDeb(path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('pkexec', ['apt-get', 'install', '-y', path], { stdio: 'ignore' });
    child.on('error', () => reject(new Error('Administrator approval is not available')));
    child.on('exit', (code) => {
      if (code === 0) {
        app.relaunch();
        app.exit(0);
        resolve();
      } else {
        reject(new Error('The update was not installed'));
      }
    });
  });
}
