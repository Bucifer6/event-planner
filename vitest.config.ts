import { defineConfig } from "vitest/config";

// One root config, one project per package (each has its own vitest.config.ts).
//
// DB isolation: every test file that needs Postgres calls setupTestDb() from "@ed/db/testing",
// which clones a private database from a cached template. Files therefore run in parallel
// safely (no shared tables). maxWorkers is capped because the build machine has 2 cores.
//
//   pnpm test                                             whole suite
//   pnpm exec vitest run packages/core/test/audit.test.ts one file
//   pnpm exec vitest run --project @ed/core               one package
export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts", "apps/*/vitest.config.ts"],
    maxWorkers: 2,
  },
});
