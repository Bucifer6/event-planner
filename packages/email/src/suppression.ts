import { requireSystem, type Ctx } from "@ed/core/context";
import { emailSuppressions, eq, type EmailSuppressionReason } from "@ed/db";
import { hashToken } from "@ed/shared/ids";
import { z } from "zod";

// Suppression list: an address that hard-bounced or complained is never emailed again.
// Only the SHA-256 of the lower-cased address is kept.

export function emailHash(email: string): string {
  return hashToken(email.trim().toLowerCase());
}

export async function isSuppressed(ctx: Ctx, email: string): Promise<boolean> {
  const [row] = await ctx.db
    .select({ id: emailSuppressions.id })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.emailHash, emailHash(email)));
  return !!row;
}

/** System/worker/webhook only. Idempotent. */
export async function suppressEmail(
  ctx: Ctx,
  input: { email: string; reason: EmailSuppressionReason },
): Promise<void> {
  requireSystem(ctx);
  await ctx.db
    .insert(emailSuppressions)
    .values({ emailHash: emailHash(input.email), reason: input.reason })
    .onConflictDoNothing();
}

/**
 * Provider-neutral delivery events, as posted to /api/webhooks/email. The operator's vendor
 * adapter maps the vendor payload to this shape (placeholder contract until a vendor is chosen).
 */
export const emailEventsSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(["bounce", "complaint", "delivered"]),
        email: z.string().trim().toLowerCase().pipe(z.email()),
        /** For bounces: only permanent ("hard") ones suppress. Default true. */
        permanent: z.boolean().optional(),
      }),
    )
    .max(1000),
});
export type EmailEvents = z.infer<typeof emailEventsSchema>;

/** Applies bounce/complaint events. Returns how many addresses were suppressed. */
export async function applyEmailEvents(ctx: Ctx, input: EmailEvents): Promise<number> {
  requireSystem(ctx);
  const { events } = emailEventsSchema.parse(input);
  let suppressed = 0;
  for (const e of events) {
    if (e.type === "complaint") {
      await suppressEmail(ctx, { email: e.email, reason: "complaint" });
      suppressed++;
    } else if (e.type === "bounce" && e.permanent !== false) {
      await suppressEmail(ctx, { email: e.email, reason: "bounce" });
      suppressed++;
    }
  }
  return suppressed;
}
