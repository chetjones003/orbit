import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

/**
 * Closing the window hides it to the tray; Orbit keeps running until it is really quit.
 * Runs against the unpacked build with no GitHub needed.
 */
const repoRoot = resolve(__dirname, '../..');

test.describe('tray (unpacked build)', () => {
  test('closing the window hides it to the tray and the app keeps running', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'orbit-e2e-tray-'));
    const { ELECTRON_RUN_AS_NODE: _ignored, ...inherited } = process.env;
    const app = await electron.launch({
      args: ['.'],
      cwd: repoRoot,
      env: { ...inherited, ORBIT_USER_DATA: profile }
    });
    try {
      const window = await app.firstWindow();
      await expect(window.locator('html')).toHaveAttribute('data-orbit-ready', 'true');

      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());

      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible() ?? false)
        )
        .toBe(false);
      // Still running: the main process can still answer, and the window still exists to bring back.
      await expect(app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).resolves.toBe(
        1
      );
    } finally {
      await app.close();
    }
  });
});
