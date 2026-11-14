import { and, desc, eq, occasionGuestSettings, whatifPreviews } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { assertOccasionWritable } from "./lifecycle";
import { chunkText } from "./plannotes";
import { PLANNING_ROLES } from "./suppliers";
import { inTx } from "./tx";
import { createPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// Custom invitation wording (MCP tool propose_invitation_text, MCP3, MCP5, INF7).
// One nullable column: occasion_guest_settings.invitation_text. It is shown on the guest
// plate. While the text still is exactly what an external assistant proposed, it carries the
// label "creat cu un asistent extern"; the label goes as soon as the planner edits the text.

export const INVITATION_TEXT_KIND = "guests.invitationText";
export const INVITATION_TEXT_MAX = 1200;

const zWording = z.string().trim().min(1, "common.validation.required").max(INVITATION_TEXT_MAX, "common.validation.tooLong");
const textInput = z.object({ text: zWording });

async function readText(ctx: Pick<Ctx, "db">, occasionId: string): Promise<string | null> {
  const [row] = await ctx.db.select({ text: occasionGuestSettings.invitationText }).from(occasionGuestSettings).where(eq(occasionGuestSettings.occasionId, occasionId));
  return row?.text ?? null;
}

async function writeText(tx: Ctx, occasionId: string, text: string | null): Promise<void> {
  await tx.db
    .insert(occasionGuestSettings)
    .values({ occasionId, invitationText: text })
    .onConflictDoUpdate({ target: occasionGuestSettings.occasionId, set: { invitationText: text } });
}

/** True while the stored text is, unchanged, the last assistant draft that was confirmed (MCP5). */
async function isAssistantText(ctx: Pick<Ctx, "db">, occasionId: string, text: string | null): Promise<boolean> {
  if (!text) return false;
  const [last] = await ctx.db
    .select({ input: whatifPreviews.input, by: whatifPreviews.proposedByKind })
    .from(whatifPreviews)
    .where(and(eq(whatifPreviews.occasionId, occasionId), eq(whatifPreviews.kind, INVITATION_TEXT_KIND), eq(whatifPreviews.state, "applied")))
    .orderBy(desc(whatifPreviews.decidedAt))
    .limit(1);
  return !!last && last.by === "mcp" && (last.input as { text?: string } | null)?.text === text;
}

export type InvitationText = { text: string | null; externalAssistant: boolean };

/** The custom wording as planning members see it. */
export async function getInvitationText(ctx: Ctx, occasionId: string): Promise<InvitationText> {
  await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const text = await readText(ctx, occasionId);
  return { text, externalAssistant: await isAssistantText(ctx, occasionId, text) };
}

/** The same, for the guest link (guest actor): the wording of THEIR occasion only. */
export async function getGuestInvitationText(ctx: Ctx): Promise<InvitationText> {
  if (ctx.actor.kind !== "guest") throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const text = await readText(ctx, ctx.actor.occasionId);
  return { text, externalAssistant: await isAssistantText(ctx, ctx.actor.occasionId, text) };
}

/** The planner types or clears (blank) the wording. Managers only. */
export async function setInvitationText(ctx: Ctx, input: { occasionId: string; text?: string | null }): Promise<void> {
  requireWriteCapable(ctx);
  const data = z.object({ occasionId: zId, text: z.string().trim().max(INVITATION_TEXT_MAX, "common.validation.tooLong").nullish() }).parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  await assertOccasionWritable(ctx, data.occasionId);
  await inTx(ctx, async (tx) => {
    const before = await readText(tx, data.occasionId);
    const next = data.text ? data.text : null;
    if (before === next) return;
    await writeText(tx, data.occasionId, next);
    await audit(tx, { action: "guests.invitation_text_set", objectType: "occasion", objectId: data.occasionId, meta: { set: next !== null, length: next?.length ?? 0 } });
  });
}

registerWhatIf<z.output<typeof textInput>>(INVITATION_TEXT_KIND, {
  input: textInput,
  authorize: async (ctx, subject, action) => {
    await requireMember(ctx, subject.occasionId ?? "", action === "read" ? { roles: PLANNING_ROLES } : { manage: true });
  },
  compute: async (ctx, input, subject) => {
    const current = await readText(ctx, subject.occasionId!);
    const before = current ? chunkText(current) : [];
    return {
      title: { key: "mcp.whatif.invitationText.title" },
      // the whole wording is shown, in rows of readable length — nothing is cut off
      delta: chunkText(input.text).map((part, n) => ({
        key: `text:${n}`,
        what: { key: "mcp.whatif.invitationText.what" },
        before: before[n] ?? undefined,
        after: part,
        ...(n === 0 ? { noteKey: "mcp.whatif.invitationText.note" } : {}),
      })),
    };
  },
  apply: async (tx, preview) => {
    const occasionId = preview.occasionId!;
    await requireMember(tx, occasionId, { manage: true });
    await assertOccasionWritable(tx, occasionId);
    await writeText(tx, occasionId, preview.input.text);
    await audit(tx, { action: "guests.invitation_text_set", objectType: "occasion", objectId: occasionId, meta: { set: true, length: preview.input.text.length, proposedByKind: preview.proposedByKind, previewId: preview.id } });
  },
});

/** A preview of new invitation wording. Managers only (SEC15). */
export async function proposeInvitationText(ctx: Ctx, input: { occasionId: string; text: string; source?: string }): Promise<WhatIfPreview> {
  const occasionId = zId.parse(input.occasionId);
  await requireMember(ctx, occasionId, { manage: true });
  return createPreview(ctx, { kind: INVITATION_TEXT_KIND, occasionId, subjectType: "occasion", subjectId: occasionId, input: { text: input.text }, source: input.source });
}
