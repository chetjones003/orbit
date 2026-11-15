import { describe, expect, it } from 'vitest';
import { isEligibleUpdate, pickMacAsset, UPDATE_CHECK_INTERVAL_MS } from '../../../src/shared/updates';

describe('isEligibleUpdate', () => {
  it('accepts a strictly newer stable release', () => {
    expect(isEligibleUpdate('0.2.0', '0.1.0')).toBe(true);
    expect(isEligibleUpdate('1.0.0', '0.9.12')).toBe(true);
    expect(isEligibleUpdate('0.1.1', '0.1.0')).toBe(true);
  });

  it('rejects the same version and any older version (no downgrades)', () => {
    expect(isEligibleUpdate('0.1.0', '0.1.0')).toBe(false);
    expect(isEligibleUpdate('0.0.9', '0.1.0')).toBe(false);
    expect(isEligibleUpdate('0.1.0', '0.10.0')).toBe(false);
  });

  it('rejects prerelease versions (no prerelease channel)', () => {
    expect(isEligibleUpdate('0.2.0-beta.1', '0.1.0')).toBe(false);
    expect(isEligibleUpdate('0.2.0-rc.1', '0.1.0')).toBe(false);
  });

  it('rejects anything that is not a plain x.y.z version', () => {
    expect(isEligibleUpdate('v0.2.0', '0.1.0')).toBe(false);
    expect(isEligibleUpdate('0.2', '0.1.0')).toBe(false);
    expect(isEligibleUpdate('', '0.1.0')).toBe(false);
  });
});

describe('pickMacAsset', () => {
  const files = [
    { url: 'Orbit-0.2.0-mac-arm64.dmg', sha512: 'arm', size: 1 },
    { url: 'Orbit-0.2.0-mac-x64.dmg', sha512: 'x64', size: 2 }
  ];

  it('picks the DMG matching the CPU architecture', () => {
    expect(pickMacAsset(files, 'arm64')?.sha512).toBe('arm');
    expect(pickMacAsset(files, 'x64')?.sha512).toBe('x64');
  });

  it('returns null when no DMG matches the architecture', () => {
    expect(pickMacAsset([files[0]!], 'x64')).toBeNull();
  });
});

describe('UPDATE_CHECK_INTERVAL_MS', () => {
  it('is four hours', () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000);
  });
});
