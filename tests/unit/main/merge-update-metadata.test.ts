import { describe, expect, it } from 'vitest';
import { mergeMacMetadata } from '../../../scripts/merge-update-metadata.mjs';

const arm = {
  version: '0.2.0',
  files: [{ url: 'Orbit-0.2.0-mac-arm64.dmg', sha512: 'ARM', size: 100 }],
  path: 'Orbit-0.2.0-mac-arm64.dmg',
  sha512: 'ARM',
  releaseDate: '2026-11-15T00:00:00.000Z'
};
const intel = {
  version: '0.2.0',
  files: [{ url: 'Orbit-0.2.0-mac-x64.dmg', sha512: 'X64', size: 200 }],
  path: 'Orbit-0.2.0-mac-x64.dmg',
  sha512: 'X64',
  releaseDate: '2026-11-15T00:00:00.000Z'
};

describe('mergeMacMetadata', () => {
  it('keeps both architectures so one latest-mac.yml serves every Mac', () => {
    const merged = mergeMacMetadata([arm, intel]);
    expect(merged.version).toBe('0.2.0');
    expect(merged.files.map((file: { url: string }) => file.url)).toEqual([
      'Orbit-0.2.0-mac-arm64.dmg',
      'Orbit-0.2.0-mac-x64.dmg'
    ]);
  });

  it('refuses to merge documents for different versions', () => {
    expect(() => mergeMacMetadata([arm, { ...intel, version: '0.3.0' }])).toThrow('version');
  });

  it('does not duplicate a file that appears in more than one input', () => {
    const merged = mergeMacMetadata([arm, arm]);
    expect(merged.files).toHaveLength(1);
  });
});
