import { defineConfig } from '@playwright/test';

// Windows flow tests run against the packaged app. Set ORBIT_E2E_EXECUTABLE to the
// packaged executable; the spec is skipped otherwise so routine runs stay deterministic.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
});
