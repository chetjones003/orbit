/**
 * Update policy and status shared by main, preload, and renderer. Free of Node and DOM APIs.
 */

/** How often main checks GitHub Releases while Orbit runs. */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Plain x.y.z only. Prerelease and build suffixes are never offered. */
const STABLE_VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function parseStable(version: string): [number, number, number] | null {
  const match = STABLE_VERSION.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * True only when `candidate` is a stable release strictly newer than `current`.
 * Same or older versions are refused, so Orbit never downgrades.
 */
export function isEligibleUpdate(candidate: string, current: string): boolean {
  const next = parseStable(candidate);
  const now = parseStable(current);
  if (!next || !now) return false;
  for (let i = 0; i < 3; i += 1) {
    if (next[i]! !== now[i]!) return next[i]! > now[i]!;
  }
  return false;
}

export interface ReleaseFile {
  url: string;
  sha512: string;
  size: number;
}

/** The macOS DMG for one CPU architecture, as named by electron-builder (`...-mac-<arch>.dmg`). */
export function pickMacAsset(files: ReleaseFile[], arch: 'arm64' | 'x64'): ReleaseFile | null {
  return files.find((file) => file.url.endsWith(`-mac-${arch}.dmg`)) ?? null;
}

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; checkedAt: number }
  | { kind: 'downloading'; version: string; percent: number }
  /** Downloaded and waiting for the user to confirm a restart (Windows, AppImage, .deb). */
  | { kind: 'ready'; version: string; releaseNotes: string | null }
  /** The matching DMG was downloaded, verified, and opened for the user to drag into Applications. */
  | { kind: 'mac-opened'; version: string }
  | { kind: 'error'; message: string };
