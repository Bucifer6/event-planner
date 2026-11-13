import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@ed/storage",
    include: ["test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
