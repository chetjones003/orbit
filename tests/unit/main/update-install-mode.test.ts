import { describe, expect, it } from 'vitest';
import { installMode } from '../../../src/main/updates/updater';

describe('installMode', () => {
  it('updates macOS by opening the matching DMG, never in place', () => {
    expect(installMode('darwin', undefined)).toBe('mac-dmg');
  });

  it('installs a .deb through the package manager when the app is not an AppImage', () => {
    expect(installMode('linux', undefined)).toBe('linux-deb');
  });

  it('lets electron-updater handle an AppImage and Windows', () => {
    expect(installMode('linux', '/home/user/Orbit.AppImage')).toBe('electron-updater');
    expect(installMode('win32', undefined)).toBe('electron-updater');
  });
});
