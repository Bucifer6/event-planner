import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "@ed/shared", include: ["test/**/*.test.ts"], environment: "node" },
});
