import { and, asc, businesses, count, desc, eq, inArray, listingRevisions, sql, type RevisionState } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { audit } from "./audit";
import { addBusinessNotice, isAccountBusinessMember, queueBusinessEmail, requireBusinessMember } from "./business";
import { actorAccountId, type Ctx } from "./context";
import { readSetting, registerDashboardCounter, requireStaffRole, writeSetting } from "./staff";
import { inTx } from "./tx";

// THE moderation queue (P3, W2) — one queue for everything a business publishes.
//
// A domain that owns moderated content (listings now; venue drawings, flower catalogues …
// later) does two things:
//
//   registerModerationKind("drawing", {
//     labelKey: "drawings.moderation.kind",               // name of the kind, in the queue
//     describe: async (ctx, revision) => ({                // what the moderator sees
//       title: "Sala Mare — plan",
//       fields: [{ key: "caption", labelKey: "drawings.fields.caption", before: "…", after: "…" }],
//     }),
//     apply: async (txCtx, revision) => { …make revision.payload the LIVE content… },
//     onRejected?: async (txCtx, revision) => { … },
//     onWithdrawn?: async (txCtx, revision) => { … },
//   });
//
//   await submitForModeration(ctx, { kind: "drawing", subjectId, payload, listingId, businessId, basePayload });
//
// Rules enforced HERE, for every kind:
//   · the live content is never touched until `apply` runs inside an approval;
//   · only a listing_moderator decides, and never one who is a member of that business or
//     who submitted the revision (P3) → FORBIDDEN;
//   · a rejection carries a reason that is stored and given to the business;
//   · a decided revision is immutable (also a database trigger);
//   · at most one revision of an object waits at a time — submitting again replaces the
//     waiting content and keeps its place in the queue.

export type ModerationRevision = typeof listingRevisions.$inferSelect;

/** One line of the before → after view. `before`/`after` are display text; null = empty. */
export type ModerationField = {
  key: string;
  /** Full i18n key of the field's label. */
  labelKey: string;
  before: string | null;
  after: string | null;
};
export type ModerationDescription = {
  title: string;
  fields: ModerationField[];
  /** Asset ids of images the moderator should look at (shown as pictures). */
  imageAssetIds?: string[];
};

export type ModerationKind = {
  /** Full i18n key naming the kind ("moderation.kinds.listing"). */
  labelKey: string;
  describe: (ctx: Ctx, revision: ModerationRevision) => Promise<ModerationDescription>;
  /** Makes the revision's payload live. Runs inside the approving transaction; throwing rolls the approval back. */
  apply: (txCtx: Ctx, revision: ModerationRevision) => Promise<void>;
  onRejected?: (txCtx: Ctx, revision: ModerationRevision) => Promise<void>;
  onWithdrawn?: (txCtx: Ctx, revision: ModerationRevision) => Promise<void>;
};

const g = globalThis as unknown as { __edModerationKinds?: Map<string, ModerationKind> };
const kinds: Map<string, ModerationKind> = (g.__edModerationKinds ??= new Map());

export function registerModerationKind(kind: string, def: ModerationKind): void {
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(kind)) throw new Error(`Invalid moderation kind: ${kind}`);
  kinds.set(kind, def);
}

function kindOf(kind: string): ModerationKind {
  const def = kinds.get(kind);
  if (!def) throw new Error(`Moderation kind "${kind}" is not registered (import its domain module)`);
  return def;
}

export const MODERATION_TARGET_SETTING = "moderation.targetHours";
/** Placeholder until the operator sets the service target (10-operator-decisions.md). */
export const MODERATION_TARGET_DEFAULT_HOURS = 48;

/** The operator-set moderation service target, in hours. */
export async function getModerationTargetHours(ctx: Pick<Ctx, "db">): Promise<number> {
  const v = await readSetting<number>(ctx, MODERATION_TARGET_SETTING);
  return typeof v === "number" && v > 0 ? v : MODERATION_TARGET_DEFAULT_HOURS;
}

export async function setModerationTargetHours(ctx: Ctx, input: { hours: number }): Promise<void> {
  requireStaffRole(ctx, "platform_admin");
  const hours = z.coerce.number("common.validation.invalid").int("common.validation.invalid").min(1, "common.validation.tooSmall").max(720, "common.validation.tooBig").parse(input.hours);
  await writeSetting(ctx, MODERATION_TARGET_SETTING, hours);
}

/* ── Submit ────────────────────────────────────────────────────────────── */

const submitInput = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/),
  subjectId: z.string().min(1).max(64),
  payload: z.unknown(),
  /** The live content in the same shape, for the before → after view. Omit for something new. */
  basePayload: z.unknown().optional(),
  listingId: zId.nullable().optional(),
  /** The owning business; its members can never decide the revision. Null only for unclaimed listings. */
  businessId: zId.nullable().optional(),
  /** Where the content came from (discovery, BD4). */
  sourceNote: z.string().trim().max(1000).nullable().optional(),
});
export type SubmitForModerationInput = z.input<typeof submitInput>;

/**
 * Queues content for a moderator. An account actor must be a member of `businessId`; staff
 * and the system (discovery) may submit for an unclaimed listing — a staff submitter can
 * never approve their own row. The domain validates `payload` BEFORE calling this.
 * Joins the caller's transaction.
 */
export async function submitForModeration(ctx: Ctx, input: SubmitForModerationInput): Promise<ModerationRevision> {
  const data = submitInput.parse(input);
  kindOf(data.kind);
  if (data.payload === undefined || data.payload === null) throw new AppError("VALIDATION", "common.validation.required");
  let submittedByAccountId: string | null = null;
  let submittedByStaffId: string | null = null;
  if (ctx.actor.kind === "account") {
    if (!data.businessId) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
    const { business } = await requireBusinessMember(ctx, data.businessId);
    if (business.status !== "active") throw new AppError("FORBIDDEN", `business.errors.${business.status}`);
    submittedByAccountId = ctx.actor.accountId;
  } else if (ctx.actor.kind === "staff") {
    submittedByStaffId = requireStaffRole(ctx, "listing_moderator", "platform_admin");
  } else if (ctx.actor.kind !== "system") {
    throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  }
  return inTx(ctx, async (tx) => {
    const [waiting] = await tx.db
      .select()
      .from(listingRevisions)
      .where(and(eq(listingRevisions.kind, data.kind), eq(listingRevisions.subjectId, data.subjectId), eq(listingRevisions.state, "pending")))
      .for("update");
    const values = {
      payload: data.payload as object,
      basePayload: (data.basePayload ?? null) as object | null,
      listingId: data.listingId ?? null,
      businessId: data.businessId ?? null,
      submittedByAccountId,
      submittedByStaffId,
      sourceNote: data.sourceNote ?? null,
    };
    let row: ModerationRevision;
    if (waiting) {
      [row] = (await tx.db.update(listingRevisions).set(values).where(eq(listingRevisions.id, waiting.id)).returning()) as [ModerationRevision];
    } else {
      [row] = (await tx.db
        .insert(listingRevisions)
        .values({ kind: data.kind, subjectId: data.subjectId, state: "pending", createdAt: tx.now, ...values })
        .returning()) as [ModerationRevision];
    }
    await audit(tx, {
      action: waiting ? "moderation.resubmitted" : "moderation.submitted",
      objectType: "moderation_revision",
      objectId: row.id,
      meta: { kind: data.kind, subjectId: data.subjectId, businessId: data.businessId ?? null },
    });
    return row;
  });
}

/** The business takes its waiting revision back. The live content is unaffected. */
export async function withdrawRevision(ctx: Ctx, input: { id: string }): Promise<void> {
  const { id } = z.object({ id: zId }).parse(input);
  const [rev] = await ctx.db.select().from(listingRevisions).where(eq(listingRevisions.id, id));
  if (!rev || !rev.businessId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireBusinessMember(ctx, rev.businessId);
  await inTx(ctx, async (tx) => {
    const updated = await tx.db
      .update(listingRevisions)
      .set({ state: "withdrawn", decidedAt: tx.now })
      .where(and(eq(listingRevisions.id, id), eq(listingRevisions.state, "pending")))
      .returning();
    if (!updated[0]) throw new AppError("CONFLICT", "moderation.errors.alreadyDecided");
    await kindOf(rev.kind).onWithdrawn?.(tx, updated[0]);
    await audit(tx, { action: "moderation.withdrawn", objectType: "moderation_revision", objectId: id, meta: { kind: rev.kind, subjectId: rev.subjectId } });
  });
}

/* ── Read ──────────────────────────────────────────────────────────────── */

export type QueueItem = {
  id: string;
  kind: string;
  kindLabelKey: string;
  title: string;
  businessId: string | null;
  businessName: string | null;
  /** True when it changes something already live (the live version stays up meanwhile). */
  isEdit: boolean;
  state: RevisionState;
  submittedAt: Date;
  waitingMinutes: number;
  /** Past the operator's service target. */
  overdue: boolean;
  decidedAt: Date | null;
};

export type ModerationQueue = { targetHours: number; items: QueueItem[]; pending: number };

function waitingMinutes(ctx: Ctx, rev: ModerationRevision): number {
  const end = rev.state === "pending" ? ctx.now : (rev.decidedAt ?? ctx.now);
  return Math.max(0, Math.floor((end.getTime() - rev.createdAt.getTime()) / 60_000));
}

/** W2: the queue, oldest first, with the waiting time measured against the service target. */
export async function listModerationQueue(
  ctx: Ctx,
  input: { state?: "pending" | "decided"; limit?: number } = {},
): Promise<ModerationQueue> {
  requireStaffRole(ctx, "listing_moderator", "platform_admin");
  const state = input.state ?? "pending";
  const targetHours = await getModerationTargetHours(ctx);
  const rows = await ctx.db
    .select({ rev: listingRevisions, businessName: businesses.name })
    .from(listingRevisions)
    .leftJoin(businesses, eq(businesses.id, listingRevisions.businessId))
    .where(state === "pending" ? eq(listingRevisions.state, "pending") : inArray(listingRevisions.state, ["approved", "rejected"]))
    .orderBy(state === "pending" ? asc(listingRevisions.createdAt) : desc(listingRevisions.decidedAt))
    .limit(Math.min(Math.max(input.limit ?? 100, 1), 300));
  const [p] = await ctx.db.select({ n: count() }).from(listingRevisions).where(eq(listingRevisions.state, "pending"));
  const items: QueueItem[] = [];
  for (const { rev, businessName } of rows) {
    const def = kinds.get(rev.kind);
    const title = def ? (await def.describe(ctx, rev)).title : rev.subjectId;
    const minutes = waitingMinutes(ctx, rev);
    items.push({
      id: rev.id,
      kind: rev.kind,
      kindLabelKey: def?.labelKey ?? "moderation.kinds.unknown",
      title,
      businessId: rev.businessId,
      businessName,
      isEdit: rev.basePayload !== null,
      state: rev.state,
      submittedAt: rev.createdAt,
      waitingMinutes: minutes,
      overdue: minutes > targetHours * 60,
      decidedAt: rev.decidedAt,
    });
  }
  return { targetHours, items, pending: p?.n ?? 0 };
}

export type ModerationDetail = {
  revision: ModerationRevision;
  kindLabelKey: string;
  description: ModerationDescription;
  businessName: string | null;
  targetHours: number;
  waitingMinutes: number;
  overdue: boolean;
  /** Why this staff member cannot decide it (P3), or null when they can. */
  blockedReason: "ownBusiness" | "ownSubmission" | "notModerator" | null;
};

async function blockedFor(ctx: Ctx, rev: ModerationRevision): Promise<ModerationDetail["blockedReason"]> {
  if (ctx.actor.kind !== "staff" || !ctx.actor.roles.includes("listing_moderator")) return "notModerator";
  if (rev.businessId && (await isAccountBusinessMember(ctx, rev.businessId, ctx.actor.accountId))) return "ownBusiness";
  if (rev.submittedByStaffId && rev.submittedByStaffId === ctx.actor.staffId) return "ownSubmission";
  if (rev.submittedByAccountId && rev.submittedByAccountId === ctx.actor.accountId) return "ownSubmission";
  return null;
}

export async function getModerationRevision(ctx: Ctx, id: string): Promise<ModerationDetail> {
  requireStaffRole(ctx, "listing_moderator", "platform_admin");
  const [row] = await ctx.db
    .select({ rev: listingRevisions, businessName: businesses.name })
    .from(listingRevisions)
    .leftJoin(businesses, eq(businesses.id, listingRevisions.businessId))
    .where(eq(listingRevisions.id, id));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const def = kindOf(row.rev.kind);
  const targetHours = await getModerationTargetHours(ctx);
  const minutes = waitingMinutes(ctx, row.rev);
  return {
    revision: row.rev,
    kindLabelKey: def.labelKey,
    description: await def.describe(ctx, row.rev),
    businessName: row.businessName,
    targetHours,
    waitingMinutes: minutes,
    overdue: minutes > targetHours * 60,
    blockedReason: await blockedFor(ctx, row.rev),
  };
}

/** Revisions of one object, newest first — for the owning domain's screens (it checks access). */
export async function listRevisionsForSubject(
  ctx: Pick<Ctx, "db">,
  input: { kind: string; subjectId: string; limit?: number },
): Promise<ModerationRevision[]> {
  return ctx.db
    .select()
    .from(listingRevisions)
    .where(and(eq(listingRevisions.kind, input.kind), eq(listingRevisions.subjectId, input.subjectId)))
    .orderBy(desc(listingRevisions.createdAt))
    .limit(input.limit ?? 10);
}

/* ── Decide ────────────────────────────────────────────────────────────── */

const decideInput = z
  .object({
    id: zId,
    decision: z.enum(["approve", "reject"], "common.validation.required"),
    /** Given to the business. Mandatory when rejecting. */
    reason: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.string().trim().min(10, "moderation.errors.reasonRequired").max(2000, "common.validation.tooLong").optional(),
    ),
  })
  .superRefine((v, c) => {
    if (v.decision === "reject" && !v.reason) c.addIssue({ code: "custom", path: ["reason"], message: "moderation.errors.reasonRequired" });
  });

/**
 * Approves or rejects a waiting revision (P3, W2). Only a listing_moderator; never a member
 * of the business concerned and never the person who submitted it → FORBIDDEN. Approval
 * runs the kind's `apply` in the same transaction; the decision can be taken once.
 */
export async function decideRevision(ctx: Ctx, input: z.input<typeof decideInput>): Promise<ModerationRevision> {
  const staffId = requireStaffRole(ctx, "listing_moderator");
  const data = decideInput.parse(input);
  return inTx(ctx, async (tx) => {
    const [rev] = await tx.db.select().from(listingRevisions).where(eq(listingRevisions.id, data.id)).for("update");
    if (!rev) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (rev.state !== "pending") throw new AppError("CONFLICT", "moderation.errors.alreadyDecided");
    const blocked = await blockedFor(tx, rev);
    if (blocked) throw new AppError("FORBIDDEN", `moderation.errors.${blocked}`);
    const def = kindOf(rev.kind);
    const state = data.decision === "approve" ? "approved" : "rejected";
    if (state === "approved") await def.apply(tx, rev);
    else await def.onRejected?.(tx, rev);
    const [row] = await tx.db
      .update(listingRevisions)
      .set({ state, moderatorStaffId: staffId, decidedAt: tx.now, decisionReason: data.reason ?? null })
      .where(and(eq(listingRevisions.id, rev.id), eq(listingRevisions.state, "pending")))
      .returning();
    if (!row) throw new AppError("CONFLICT", "moderation.errors.alreadyDecided");
    await audit(tx, {
      action: `moderation.${state}`,
      objectType: "moderation_revision",
      objectId: rev.id,
      before: { state: "pending" },
      after: { state, reason: data.reason ?? null },
      meta: { kind: rev.kind, subjectId: rev.subjectId, businessId: rev.businessId, sourceNote: rev.sourceNote },
    });
    if (rev.businessId) {
      await addBusinessNotice(tx, { businessId: rev.businessId, kind: `revision.${state}`, listingId: rev.listingId, reason: data.reason ?? null });
      await queueBusinessEmail(tx, { businessId: rev.businessId, headlineKey: `business.email.revision.${state}`, reason: data.reason ?? null });
    }
    return row;
  });
}

function registerRules(): void {
  registerDashboardCounter({
    key: "moderationQueue",
    count: async (ctx) => {
      const rows = await ctx.db
        .select({ state: listingRevisions.state, n: count() })
        .from(listingRevisions)
        .where(sql`${listingRevisions.createdAt} > now() - interval '365 days'`)
        .groupBy(listingRevisions.state);
      const byStatus = Object.fromEntries(rows.map((r) => [r.state, r.n]));
      return { total: byStatus.pending ?? 0, byStatus };
    },
  });
}
registerRules();
