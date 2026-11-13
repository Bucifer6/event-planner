import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    name: "@ed/web",
    include: ["test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    globalSetup: ["../../packages/i18n/scripts/vitest-global-setup.mjs"],
  },
});
