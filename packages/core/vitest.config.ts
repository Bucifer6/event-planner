import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@ed/core",
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
