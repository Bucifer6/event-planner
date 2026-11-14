import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@ed/i18n",
    include: ["test/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./scripts/vitest-global-setup.mjs"],
  },
});
