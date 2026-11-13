import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@ed/db",
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
