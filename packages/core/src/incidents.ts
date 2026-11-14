import { desc, eq, incidents, isNull, and } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { audit } from "./audit";
import { actorRef, type Ctx } from "./context";

// Incident log + guest-facing status (LAU5). While an incident is open, guest-facing pages
// show its plain-language message ("Ceva nu funcționează…") — never a stack trace.
// The console screen for this comes from the console agent; these are its functions.

export type Incident = typeof incidents.$inferSelect;

/** What a guest-facing page may know: the message (or null = use the default text). */
export type ActiveIncident = { id: string; message: string | null; startedAt: Date };

function requireOperator(ctx: Ctx): void {
  if (ctx.actor.kind !== "staff" && ctx.actor.kind !== "system") {
    throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  }
}

const plainText = z
  .string()
  .trim()
  .min(1)
  .max(500)
  // plain language only: refuse anything that looks like a stack trace or markup
  .refine((s) => !/<[a-z/!]|\bat .+\(.+:\d+:\d+\)|Error:|Exception/i.test(s), "common.validation.invalid");

const createInput = z.object({
  messageRo: plainText.optional(),
  messageEn: plainText.optional(),
  internalNote: z.string().trim().max(2000).optional(),
});

/** Opens an incident (staff or system). With no message the default text is shown. */
export async function createIncident(
  ctx: Ctx,
  input: z.input<typeof createInput> = {},
): Promise<Incident> {
  requireOperator(ctx);
  const data = createInput.parse(input);
  const [row] = await ctx.db
    .insert(incidents)
    .values({
      messageRo: data.messageRo ?? null,
      messageEn: data.messageEn ?? null,
      internalNote: data.internalNote ?? null,
      startedAt: ctx.now,
      createdBy: actorRef(ctx.actor).id,
    })
    .returning();
  await audit(ctx, { action: "incident.opened", objectType: "incident", objectId: row!.id });
  return row!;
}

/** Closes an incident. Idempotent: resolving twice keeps the first resolution. */
export async function resolveIncident(ctx: Ctx, incidentId: string): Promise<Incident> {
  requireOperator(ctx);
  const id = z.string().min(1).max(64).parse(incidentId);
  const updated = await ctx.db
    .update(incidents)
    .set({ resolvedAt: ctx.now, resolvedBy: actorRef(ctx.actor).id })
    .where(and(eq(incidents.id, id), isNull(incidents.resolvedAt)))
    .returning();
  if (updated[0]) {
    await audit(ctx, { action: "incident.resolved", objectType: "incident", objectId: id });
    return updated[0];
  }
  const [existing] = await ctx.db.select().from(incidents).where(eq(incidents.id, id));
  if (!existing) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return existing;
}

/**
 * The open incident to show on guest-facing pages, in the reader's language (falls back to
 * the other language, then to null = default text). Readable by anyone: it is public status.
 */
export async function getActiveIncident(ctx: Ctx): Promise<ActiveIncident | null> {
  const [row] = await ctx.db
    .select()
    .from(incidents)
    .where(isNull(incidents.resolvedAt))
    .orderBy(desc(incidents.startedAt))
    .limit(1);
  if (!row) return null;
  const message =
    ctx.locale === "en" ? (row.messageEn ?? row.messageRo) : (row.messageRo ?? row.messageEn);
  return { id: row.id, message: message ?? null, startedAt: row.startedAt };
}

/** The incident log for the console, newest first (staff or system). */
export async function listIncidents(ctx: Ctx, limit = 100): Promise<Incident[]> {
  requireOperator(ctx);
  return ctx.db
    .select()
    .from(incidents)
    .orderBy(desc(incidents.startedAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}
