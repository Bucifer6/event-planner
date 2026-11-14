import "server-only";
import type { Ctx } from "@ed/core/context";
import { getConsoleAccess, resolveStaff, type ConsoleAccess, type StaffCtx, type StaffRole } from "@ed/core/staff";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { z } from "zod";
import { action, type WrappedAction } from "@/lib/action";
import { getCtx } from "@/lib/ctx";

export const CONSOLE_SETUP_PATH = "/console/setup";

/** The console guard for this request (S5), evaluated once per request. */
export const consoleAccess = cache(async (): Promise<ConsoleAccess> => getConsoleAccess(await getCtx()));

export type ConsoleRequest = {
  ctx: StaffCtx;
  staffId: string;
  roles: StaffRole[];
  expiresAt: Date;
  /** True when the staff member holds at least one of these roles. */
  has: (...roles: StaffRole[]) => boolean;
};

/**
 * EVERY console page starts with this. Someone who is not on the staff gets the ordinary
 * "not found" page — the console does not admit it exists. Staff who still have something to
 * set up (two-step, a fresh sign-in) are sent to the page that explains it.
 */
export async function requireConsole(): Promise<ConsoleRequest> {
  const access = await consoleAccess();
  if (access.state === "not_staff") notFound();
  if (access.state !== "ok") redirect(CONSOLE_SETUP_PATH);
  return {
    ctx: access.ctx,
    staffId: access.staffId,
    roles: access.roles,
    expiresAt: access.expiresAt,
    has: (...roles) => roles.some((r) => access.roles.includes(r)),
  };
}

/**
 * EVERY console Server Action is built with this instead of action(): the handler runs only
 * for an active staff member with two-step and a live console session, and receives the
 * staff Ctx (actor.kind "staff"). Role checks happen in @ed/core.
 */
export function staffAction<S extends z.ZodType, R>(
  schema: S,
  handler: (ctx: StaffCtx, input: z.output<S>) => Promise<R>,
): WrappedAction<z.input<S>, R> {
  return action(schema, async (ctx: Ctx, input) => handler(await resolveStaff(ctx), input));
}
