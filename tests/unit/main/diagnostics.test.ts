import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Diagnostics } from '../../../src/main/diagnostics';

describe('Diagnostics', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orbit-diag-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('redacts tokens from every recorded message', async () => {
    const diagnostics = new Diagnostics({ dir });

    await diagnostics.record({
      level: 'error',
      scope: 'auth',
      code: 'refresh-failed',
      message: 'Bearer ghu_abc123secret token ghp_EXAMPLEtoken1234 and github_pat_11AAAAAAA00000 failed'
    });

    const report = diagnostics.report();
    expect(report).toContain('refresh-failed');
    expect(report).not.toMatch(/ghu_abc123secret|ghp_EXAMPLE|github_pat_11AAAA|Bearer \S+/);
    expect(report).toContain('[redacted]');
  });

  it('keeps only the most recent entries in memory', async () => {
    const diagnostics = new Diagnostics({ dir, maxEntries: 3 });

    for (const code of ['one', 'two', 'three', 'four']) {
      await diagnostics.record({ level: 'info', scope: 'refresh', code, message: 'tick' });
    }

    const report = diagnostics.report();
    expect(report).not.toContain(' one ');
    expect(report).toContain('two');
    expect(report).toContain('four');
  });

  it('rotates the log file once it grows past the size limit', async () => {
    const diagnostics = new Diagnostics({ dir, maxFileBytes: 400 });

    for (let i = 0; i < 20; i++) {
      await diagnostics.record({
        level: 'info',
        scope: 'refresh',
        code: `tick-${i}`,
        message: 'x'.repeat(40)
      });
    }
    await diagnostics.flush();

    const files = await readdir(dir);
    expect(files).toEqual(expect.arrayContaining(['diagnostics.log', 'diagnostics.1.log']));
    expect((await stat(join(dir, 'diagnostics.log'))).size).toBeLessThanOrEqual(400);
    expect(await readFile(join(dir, 'diagnostics.log'), 'utf8')).toContain('tick-19');
  });

  it('writes only redacted lines to disk', async () => {
    const diagnostics = new Diagnostics({ dir });

    await diagnostics.record({
      level: 'warn',
      scope: 'auth',
      code: 'x',
      message: 'token ghp_LEAKME0000000000'
    });
    await diagnostics.flush();

    const onDisk = await readFile(join(dir, 'diagnostics.log'), 'utf8');
    expect(onDisk).not.toContain('ghp_LEAKME');
    expect(onDisk).toContain('[redacted]');
  });

  it('creates its directory on first write so a fresh install still gets a log', async () => {
    const fresh = join(dir, 'logs');
    const diagnostics = new Diagnostics({ dir: fresh });

    await diagnostics.record({ level: 'info', scope: 'refresh', code: 'fresh', message: 'first run' });
    await diagnostics.flush();

    expect(await readFile(join(fresh, 'diagnostics.log'), 'utf8')).toContain('first run');
  });

  it('does not treat a missing log as an error when starting', async () => {
    await writeFile(join(dir, 'unrelated.txt'), 'ok');
    const diagnostics = new Diagnostics({ dir });

    await expect(diagnostics.flush()).resolves.toBeUndefined();
    expect(diagnostics.report()).toBe('');
  });
});
