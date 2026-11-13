import type { Ctx } from "@ed/core/context";
import { emailDailyCounters, emailOutbox, lt, sql, type EmailOutboxStatus } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { bucharestDateKey } from "@ed/shared/time";
import { z } from "zod";
import { emailFrom, getEmailProvider } from "./providers";
import { isSuppressed } from "./suppression";
import { hasTemplate, renderEmail, type EmailLocale } from "./templates";

/** Q6: emails per occasion per day (Europe/Bucharest). */
export const DAILY_EMAIL_CAP_PER_OCCASION = 500;

const sendInput = z.object({
  to: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  template: z.string().min(1).max(100),
  params: z.unknown(),
  locale: z.enum(["ro", "en"]).default("ro"),
  occasionId: z.string().min(1).max(200).nullish(),
  bilingual: z.boolean().default(true),
});

export type SendEmailInput = {
  to: string;
  /** Name given to registerTemplate(). */
  template: string;
  params: unknown;
  /** Recipient's language. The message is still bilingual, Romanian first (L5). */
  locale?: EmailLocale;
  /** Set for every email sent on behalf of an occasion: it counts against the Q6 daily cap. */
  occasionId?: string | null;
  /** false = only `locale` (rare). */
  bilingual?: boolean;
};

export type SendEmailResult = { status: "sent" | "suppressed"; outboxId: string };

async function record(
  ctx: Ctx,
  row: {
    to: string;
    template: string;
    locale: string;
    occasionId: string | null;
    provider: string;
    status: EmailOutboxStatus;
    subject?: string;
    text?: string;
    html?: string;
    messageId?: string;
    error?: string;
  },
): Promise<string> {
  const [r] = await ctx.db
    .insert(emailOutbox)
    .values({
      toEmail: row.to,
      template: row.template,
      locale: row.locale,
      occasionId: row.occasionId,
      provider: row.provider,
      status: row.status,
      subject: row.subject ?? null,
      bodyText: row.text ?? null,
      bodyHtml: row.html ?? null,
      providerMessageId: row.messageId ?? null,
      error: row.error ?? null,
      createdAt: ctx.now,
    })
    .returning({ id: emailOutbox.id });
  return r!.id;
}

/**
 * The only way the platform sends email. In order, BEFORE the provider is touched:
 *  1. suppression list — a hard-bounced / complained address is skipped (status "suppressed";
 *     no error, so callers such as sign-in answer identically either way);
 *  2. Q6 daily cap for `occasionId` (500/day) — throws AppError LIMIT "emails.errors.dailyCap";
 *  3. render (bilingual, Romanian first) and hand to the configured provider.
 * A provider failure is recorded and re-thrown.
 */
export async function sendEmail(ctx: Ctx, input: SendEmailInput): Promise<SendEmailResult> {
  const data = sendInput.parse(input);
  if (!hasTemplate(data.template)) throw new Error(`Unknown email template: ${data.template}`);
  const provider = getEmailProvider();
  const base = {
    to: data.to,
    template: data.template,
    locale: data.locale,
    occasionId: data.occasionId ?? null,
    provider: provider.name,
  };

  if (await isSuppressed(ctx, data.to)) {
    return { status: "suppressed", outboxId: await record(ctx, { ...base, status: "suppressed" }) };
  }

  if (data.occasionId) {
    const day = bucharestDateKey(ctx.now);
    const counted = await ctx.db
      .insert(emailDailyCounters)
      .values({ occasionId: data.occasionId, day, count: 1 })
      .onConflictDoUpdate({
        target: [emailDailyCounters.occasionId, emailDailyCounters.day],
        set: { count: sql`${emailDailyCounters.count} + 1` },
        setWhere: lt(emailDailyCounters.count, DAILY_EMAIL_CAP_PER_OCCASION),
      })
      .returning({ count: emailDailyCounters.count });
    if (counted.length === 0) {
      await record(ctx, { ...base, status: "capped" });
      throw new AppError("LIMIT", "emails.errors.dailyCap", {
        params: { limit: DAILY_EMAIL_CAP_PER_OCCASION },
      });
    }
  }

  const rendered = renderEmail(data.template, data.params, {
    locale: data.locale,
    bilingual: data.bilingual,
  });
  const body = provider.keepsBodyInOutbox ? rendered : { subject: rendered.subject };
  try {
    const { messageId } = await provider.send({
      from: emailFrom(),
      to: data.to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      template: data.template,
    });
    return { status: "sent", outboxId: await record(ctx, { ...base, ...body, status: "sent", messageId }) };
  } catch (e) {
    await record(ctx, {
      ...base,
      subject: rendered.subject,
      status: "failed",
      error: e instanceof Error ? e.message.slice(0, 500) : "send failed",
    });
    throw e;
  }
}
