// THE job registry (R0-12). The worker calls registerAllJobs() once at boot.
//
// Pattern for every domain:
//   1. In your domain file (packages/core/src/<domain>.ts, or @ed/email, @ed/storage, …):
//
//        import { defineJob, defineSchedule } from "@ed/jobs";
//        export function registerJobs(): void {
//          defineJob("digest.send", z.object({ occasionId: zId }), async (ctx, p) => { … });
//          defineSchedule({ name: "digest.daily", job: "digest.plan", every: { kind: "daily", at: "07:00" } });
//          registerRetentionRule({ … });   // from @ed/core/retention, if you own purgeable data
//          registerStatCollector({ … });   // from @ed/core/stats, if you own nightly statistics
//        }
//
//   2. Append ONE import line and ONE array entry below (append only, never reorder).
//
// Handlers get a system-actor Ctx and MUST be idempotent (at-least-once delivery).
// This file is the only one in @ed/jobs that imports domain packages.
import { registerJobs as retention } from "@ed/core/retention";
import { registerJobs as stats } from "@ed/core/stats";
import { registerJobs as whatif } from "@ed/core/whatif";
import { registerJobs as storage } from "@ed/storage";
import { registerJobs as builtin } from "./builtin";

const registrations: Array<() => void> = [
  builtin,
  retention,
  stats,
  whatif,
  storage,
];

let done = false;

/** Idempotent: safe to call from the worker boot and from tests. */
export function registerAllJobs(): void {
  if (done) return;
  done = true;
  for (const register of registrations) register();
}
