import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// `electron` in Node resolves to the path of the downloaded Electron binary.
import electronPath from 'electron';

const repoRoot = resolve(__dirname, '../..');

/**
 * Real-Electron integration: launches the built app with an isolated profile and
 * checks the hardened window configuration and bundled renderer through the
 * smoke report. Requires `npm run build` first.
 */
describe('Electron app launch', () => {
  it('starts with a hardened window, loads the bundle, and exits cleanly', async () => {
    expect(existsSync(join(repoRoot, 'out/main/index.js'))).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), 'orbit-integration-'));
    const reportPath = join(dir, 'report.json');

    const code = await new Promise<number | null>((resolveExit, reject) => {
      // ELECTRON_RUN_AS_NODE makes the binary behave as plain Node, so drop it.
      const { ELECTRON_RUN_AS_NODE: _ignored, ...inherited } = process.env;
      const child = spawn(String(electronPath), ['.'], {
        cwd: repoRoot,
        env: {
          ...inherited,
          ORBIT_SMOKE_REPORT: reportPath,
          ORBIT_USER_DATA: join(dir, 'profile')
        },
        stdio: 'ignore'
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Electron did not exit within 60s'));
      }, 60_000);
      child.on('exit', (exitCode) => {
        clearTimeout(timer);
        resolveExit(exitCode);
      });
    });

    const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      ok: boolean;
      ready: boolean;
      hasBridge: boolean;
      title: string;
      security: {
        hardenedPreferences: { contextIsolation: boolean; sandbox: boolean; nodeIntegration: boolean };
        nodeGlobalsAbsent: boolean;
        cspActive: boolean;
      };
    };
    expect(report.ready).toBe(true);
    expect(report.hasBridge).toBe(true);
    expect(report.title).toBe('Orbit');
    expect(report.security.hardenedPreferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    });
    expect(report.security.nodeGlobalsAbsent).toBe(true);
    expect(report.security.cspActive).toBe(true);
    expect(report.ok).toBe(true);
    expect(code).toBe(0);
  }, 90_000);
});
