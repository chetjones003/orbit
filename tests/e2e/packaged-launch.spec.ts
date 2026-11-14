import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

const executablePath = process.env['ORBIT_E2E_EXECUTABLE'];

test.describe('packaged app, signed out', () => {
  test.skip(!executablePath, 'Set ORBIT_E2E_EXECUTABLE to a packaged Orbit executable');
  // Observed: Playwright's Electron attach times out against the fused packaged build
  // (2 minute timeout with RunAsNode and inspect-argument fuses disabled). The packaged
  // smoke test uses the diagnostics readiness signal instead, which the ticket allows.
  // Re-enable once an attach approach is proven with fuses intact.
  test.fixme(!!executablePath, 'Playwright attach does not work with fuses intact; see comment');

  test('window loads the bundled renderer and the preload bridge answers', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'orbit-e2e-'));
    const { ELECTRON_RUN_AS_NODE: _ignored, ...inherited } = process.env;
    const app = await electron.launch({
      executablePath,
      env: { ...inherited, ORBIT_USER_DATA: profile }
    });
    try {
      const window = await app.firstWindow();
      await expect(window.locator('h1')).toHaveText('Orbit');
      await expect(window.locator('html')).toHaveAttribute('data-orbit-ready', 'true');
      await expect(window.locator('p')).toContainText('on ');
    } finally {
      await app.close();
    }
  });
});
