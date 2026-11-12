import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['../db/test/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    include: ['test/**/*.test.ts'],
  },
});
