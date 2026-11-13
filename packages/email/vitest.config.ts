import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@ed/email",
    include: ["test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    globalSetup: ["../i18n/scripts/vitest-global-setup.mjs"],
  },
});
