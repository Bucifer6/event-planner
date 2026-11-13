import { jobRuns } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { enqueue, listJobs, listSchedules, runOnce } from "../src/index";
import { BACKUP_JOB, RESTORE_TEST_JOB } from "../src/builtin";
import { registerAllJobs } from "../src/registry";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
  registerAllJobs();
});
afterAll(async () => {
  await t.close();
});
afterEach(() => {
  delete process.env.BACKUP_COMMAND;
  delete process.env.RESTORE_TEST_COMMAND;
});

const ctx = () => ({ db: t.db, now: new Date() });

describe("registry", () => {
  it("registers the built-in jobs and their schedules", () => {
    expect(listJobs()).toEqual(
      expect.arrayContaining([BACKUP_JOB, RESTORE_TEST_JOB, "retention.purge", "stats.nightly"]),
    );
    expect(listSchedules().map((s) => s.name)).toEqual(
      expect.arrayContaining(["backup.daily", "backup.restore-test.monthly", "retention.daily", "stats.nightly"]),
    );
  });
});

describe("backup seam", () => {
  it("logs 'skipped' when no command is configured (no vendor is guessed)", async () => {
    await enqueue(ctx(), BACKUP_JOB, {});
    expect(await runOnce(ctx(), { names: [BACKUP_JOB] })).toMatchObject({ done: 1 });
    const runs = await t.db.select().from(jobRuns);
    expect(runs.filter((r) => r.name === BACKUP_JOB).map((r) => r.status)).toEqual(["skipped"]);
  });

  it("runs the operator's command and logs ok / failed", async () => {
    process.env.BACKUP_COMMAND = "exit 0";
    await enqueue(ctx(), BACKUP_JOB, {});
    expect(await runOnce(ctx(), { names: [BACKUP_JOB] })).toMatchObject({ done: 1 });
    process.env.RESTORE_TEST_COMMAND = "exit 3";
    await enqueue(ctx(), RESTORE_TEST_JOB, {});
    expect(await runOnce(ctx(), { names: [RESTORE_TEST_JOB] })).toMatchObject({ retried: 1 });
    const runs = await t.db.select().from(jobRuns);
    expect(runs.filter((r) => r.name === BACKUP_JOB).map((r) => r.status).sort()).toEqual(["ok", "skipped"]);
    const restore = runs.filter((r) => r.name === RESTORE_TEST_JOB);
    expect(restore).toHaveLength(1);
    expect(restore[0]!.status).toBe("failed");
    expect(restore[0]!.detail).toMatchObject({ exitCode: 3 });
  });

  it("the retention and nightly-stats jobs run end to end", async () => {
    await enqueue(ctx(), "retention.purge", {});
    await enqueue(ctx(), "stats.nightly", {});
    expect(await runOnce(ctx(), { names: ["retention.purge", "stats.nightly"] })).toMatchObject({ done: 2 });
    const names = (await t.db.select().from(jobRuns)).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(["retention.purge", "stats.nightly"]));
  });
});
