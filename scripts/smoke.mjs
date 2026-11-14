// Packaged smoke test. Launches one packaged executable signed out, with an
// isolated temporary profile, and requires the window to load its bundled assets
// and the process to exit cleanly with code 0.
//
// Usage: node scripts/smoke.mjs <path-to-executable>
// On Linux CI, run under xvfb-run and set APPIMAGE_EXTRACT_AND_RUN=1 for AppImages.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 120_000;

export async function smokeTest(executable) {
  const exe = resolve(executable);
  if (!existsSync(exe)) throw new Error(`Executable not found: ${exe}`);

  const dir = mkdtempSync(join(tmpdir(), 'orbit-smoke-'));
  const reportPath = join(dir, 'report.json');
  // ELECTRON_RUN_AS_NODE would turn the packaged app into plain Node; never pass it.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...inherited } = process.env;

  try {
    const code = await new Promise((resolveExit, reject) => {
      const child = spawn(exe, [], {
        env: {
          ...inherited,
          ORBIT_SMOKE_REPORT: reportPath,
          ORBIT_USER_DATA: join(dir, 'profile'),
          APPIMAGE_EXTRACT_AND_RUN: '1'
        },
        stdio: 'inherit'
      });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Smoke run exceeded ${TIMEOUT_MS / 1000}s`));
      }, TIMEOUT_MS);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('exit', (exitCode) => {
        clearTimeout(timer);
        resolveExit(exitCode);
      });
    });

    if (!existsSync(reportPath)) throw new Error('Smoke report was not written');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    console.log(JSON.stringify(report, null, 2));
    if (code !== 0 || report.ok !== true) {
      throw new Error(
        `Smoke failed: exit=${code}, ok=${report.ok}${report.error ? `, error=${report.error}` : ''}`
      );
    }
    console.log(`Smoke passed: ${exe}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/smoke.mjs <path-to-executable>');
    process.exit(2);
  }
  smokeTest(target).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
