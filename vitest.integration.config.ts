import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    // Real Electron windows cannot run in parallel on one display.
    fileParallelism: false,
    testTimeout: 90_000
  }
});
