"use server";

import { abandonDeploy, requestDeploy, requestEmergencyDeploy, requestRollback } from "@ed/core/deploys";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { staffAction } from "@/app/console/_lib";

// Deployment actions for /console/deploys (W10, DEP1–DEP7). Each is a staffAction (active
// staff member, two-step sign-in, live console session); roles and every rule are checked in
// @ed/core/deploys. The browser only ever sends a tag name and a reason — the GitHub App
// credentials stay on the server (DEP1).

const zTag = z.string().trim().min(1, "common.validation.required").max(64, "common.validation.tooLong");
const zReason = z.string().trim().min(3, "common.validation.required").max(1000, "common.validation.tooLong");

function refresh(): void {
  revalidatePath("/console", "layout");
}

/** DEP3: asks for a deployment; a second person approves it in /console/approvals. */
export const requestDeployAction = staffAction(z.object({ tag: zTag, reason: zReason }), async (ctx, input) => {
  const res = await requestDeploy(ctx, input);
  refresh();
  return res;
});

/** DEP3: emergency path — one security administrator, audit-marked. */
export const emergencyDeployAction = staffAction(
  z.object({ tag: zTag, reason: z.string().trim().min(10, "deploys.errors.emergencyReason").max(1000, "common.validation.tooLong") }),
  async (ctx, input) => {
    const res = await requestEmergencyDeploy(ctx, input);
    refresh();
    return res;
  },
);

/** DEP5: one staff member rolls production back to the previous release. */
export const rollbackAction = staffAction(z.object({ reason: zReason }), async (ctx, input) => {
  const res = await requestRollback(ctx, input);
  refresh();
  return res;
});

/** Closes a deployment whose pipeline stopped reporting (record only). */
export const abandonDeployAction = staffAction(z.object({ id: z.string().min(1).max(64), reason: zReason }), async (ctx, input) => {
  const row = await abandonDeploy(ctx, input);
  refresh();
  return { id: row.id };
});
