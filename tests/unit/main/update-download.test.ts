import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { downloadVerified } from '../../../src/main/updates/download';

// Reference digest computed independently with `node -e` over the bytes "orbit-installer".
const CONTENT = 'orbit-installer';
const SHA512 = '63scVr9x1rEbrCMJC/sC521uoSou7H1al5RJroqvYdMaW3OQ21KDoPUHfPQOBM+zymaLuK4Gh8MAzIZu+rfXMA==';

function fakeFetch(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, { status, headers: { 'content-length': String(body.length) } })) as typeof fetch;
}

describe('downloadVerified', () => {
  it('writes the file when its sha512 matches', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-dl-'));
    const dest = join(dir, 'Orbit.dmg');
    await downloadVerified({
      url: 'https://example.test/a.dmg',
      sha512: SHA512,
      dest,
      fetch: fakeFetch(CONTENT)
    });
    expect(readFileSync(dest, 'utf8')).toBe(CONTENT);
  });

  it('rejects and removes the file when the digest differs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-dl-'));
    const dest = join(dir, 'Orbit.dmg');
    await expect(
      downloadVerified({
        url: 'https://example.test/a.dmg',
        sha512: 'bogus',
        dest,
        fetch: fakeFetch(CONTENT)
      })
    ).rejects.toThrow('checksum');
    expect(existsSync(dest)).toBe(false);
  });

  it('rejects a non-OK response without writing a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-dl-'));
    const dest = join(dir, 'Orbit.dmg');
    await expect(
      downloadVerified({ url: 'https://example.test/a.dmg', sha512: SHA512, dest, fetch: fakeFetch('', 404) })
    ).rejects.toThrow('404');
    expect(existsSync(dest)).toBe(false);
  });
});
