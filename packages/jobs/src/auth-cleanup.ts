import { purgeExpiredAuthRows } from "@ed/auth";
import { purgeDueAccounts } from "@ed/core/accounts";
import { z } from "zod";
import { defineJob } from "./queue";
import { recordJobRun } from "./runs";
import { defineSchedule } from "./schedule";

// Daily account housekeeping (R0-04, R0-18):
//   auth.purge-expired   used/expired sign-in codes and links, long-dead sessions, old
//                        rate-limit windows (purgeExpiredAuthRows in @ed/auth)
//   accounts.purge-due   accounts whose seven-day undo window has closed (D6); the purge runs
//                        every onAccountPurge hook (MCP tokens, …)
// Both are idempotent: a second run finds nothing left to do.

export const AUTH_PURGE_JOB = "auth.purge-expired";
export const ACCOUNTS_PURGE_JOB = "accounts.purge-due";

export function registerJobs(): void {
  defineJob(AUTH_PURGE_JOB, z.object({}).passthrough(), async (ctx) => {
    await purgeExpiredAuthRows(ctx);
  });
  defineJob(ACCOUNTS_PURGE_JOB, z.object({}).passthrough(), async (ctx) => {
    const purged = await purgeDueAccounts(ctx);
    await recordJobRun(ctx, { name: ACCOUNTS_PURGE_JOB, status: "ok", detail: { purged: purged.length } });
  });
  defineSchedule({ name: "auth.purge-expired.daily", job: AUTH_PURGE_JOB, every: { kind: "daily", at: "03:10" } });
  defineSchedule({ name: "accounts.purge-due.daily", job: ACCOUNTS_PURGE_JOB, every: { kind: "daily", at: "03:20" } });
}
