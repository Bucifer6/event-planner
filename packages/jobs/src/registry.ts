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
import "@ed/core/all"; // every domain's import-time registrations (purge hooks, retention rules…)
import { registerJobs as retention } from "@ed/core/retention";
import { registerJobs as stats } from "@ed/core/stats";
import { registerJobs as whatif } from "@ed/core/whatif";
import { registerJobs as storage } from "@ed/storage";
import { registerJobs as builtin } from "./builtin";
import { registerJobs as occasions } from "@ed/core/occasions";
import { registerJobs as digest } from "@ed/core/digest";
import { registerJobs as authCleanup } from "./auth-cleanup";
import { registerJobs as mcp } from "@ed/mcp";
import { registerJobs as reports } from "@ed/core/reports";
import { registerJobs as closeout } from "@ed/core/closeout";
import { registerJobs as supplierSide } from "@ed/core/payments";
import { registerJobs as directory } from "@ed/core/directory";
import { registerJobs as monetization } from "@ed/core/monetization";
import { registerJobs as billing } from "@ed/core/billing";
import { registerJobs as invoicing } from "@ed/core/invoicing";
import { registerJobs as comms } from "@ed/core/comms";
import { registerJobs as enquiries } from "@ed/core/enquiries";
import { registerJobs as catalogues } from "@ed/core/catalogues";
import { registerJobs as discovery } from "@ed/core/discovery";
import { registerJobs as claims } from "@ed/core/claims";
import { registerJobs as programme } from "@ed/core/programme"; // C-03/C-10: programme.notify
import { registerJobs as publicRegistrations } from "@ed/core/registrations"; // C-06: promoted email, waitlist sweep, lifecycle notice
import { registerJobs as privateRequests } from "@ed/core/requests"; // C-07: retention rule private-requests

const registrations: Array<() => void> = [
  builtin,
  retention,
  stats,
  whatif,
  storage,
  occasions,
  digest,
  authCleanup,
  mcp,
  reports,
  closeout,
  supplierSide,
  directory,
  monetization,
  billing,
  invoicing,
  comms,
  enquiries,
  catalogues,
  discovery,
  claims,
  programme,
  publicRegistrations,
  privateRequests,
];

let done = false;

/** Idempotent: safe to call from the worker boot and from tests. */
export function registerAllJobs(): void {
  if (done) return;
  done = true;
  for (const register of registrations) register();
}
