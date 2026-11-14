import { spawn } from "node:child_process";
import { z } from "zod";
import { defineJob } from "./queue";
import { recordJobRun } from "./runs";
import { defineSchedule } from "./schedule";

// Backups and the monthly restore test (INF10, SEC9) are an operator seam: the commands are
// whatever the operator's hosting/backup product needs. Nothing here guesses a vendor.
//
//   BACKUP_COMMAND         run daily at 02:30 (Europe/Bucharest); must take an encrypted backup
//   RESTORE_TEST_COMMAND   run on the 1st at 04:30; must restore AND decrypt the latest backup
//   BACKUP_COMMAND_TIMEOUT_MS  default 2 h
//
// Exit code 0 = success. Every run (ok / failed / skipped because not configured) is written
// to job_runs so the console can show it. Command output is NOT stored (it may hold secrets).

export type CommandResult = { status: "ok" | "failed"; exitCode: number | null; ms: number };

export function runCommand(command: string, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, { shell: true, stdio: "ignore" });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      resolve({ status: exitCode === 0 ? "ok" : "failed", exitCode, ms: Date.now() - started });
    };
    child.on("error", () => finish(null));
    child.on("exit", (code) => finish(code));
  });
}

function commandJob(name: string, envVar: string) {
  return defineJob(
    name,
    z.object({}).passthrough(),
    async (ctx) => {
      const command = process.env[envVar]?.trim();
      const startedAt = new Date();
      if (!command) {
        await recordJobRun(
          { db: ctx.db, now: new Date() },
          { name, status: "skipped", startedAt, detail: { reason: `${envVar} is not set` } },
        );
        return;
      }
      const timeoutMs = Number(process.env.BACKUP_COMMAND_TIMEOUT_MS) || 2 * 60 * 60_000;
      const res = await runCommand(command, timeoutMs);
      await recordJobRun(
        { db: ctx.db, now: new Date() },
        { name, status: res.status, startedAt, detail: { exitCode: res.exitCode, ms: res.ms } },
      );
      if (res.status !== "ok") throw new Error(`${name} command exited with ${res.exitCode}`);
    },
    { maxAttempts: 3, leaseMs: 3 * 60 * 60_000 },
  );
}

export const BACKUP_JOB = "backup.run";
export const RESTORE_TEST_JOB = "backup.restore-test";

export function registerJobs(): void {
  commandJob(BACKUP_JOB, "BACKUP_COMMAND");
  commandJob(RESTORE_TEST_JOB, "RESTORE_TEST_COMMAND");
  defineSchedule({ name: "backup.daily", job: BACKUP_JOB, every: { kind: "daily", at: "02:30" } });
  defineSchedule({
    name: "backup.restore-test.monthly",
    job: RESTORE_TEST_JOB,
    every: { kind: "monthly", day: 1, at: "04:30" },
  });
}
