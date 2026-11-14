import {
  and,
  desc,
  eq,
  gt,
  lt,
  whatifPreviews,
  type WhatIfDeltaRow,
  type WhatIfProposerKind,
  type WhatIfState,
  type WhatIfText,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { addDays } from "@ed/shared/time";
import { z } from "zod";
import { audit } from "./audit";
import { actorAccountId, type Ctx } from "./context";
import { registerRetentionRule } from "./retention";
import { inTx } from "./tx";

// What-if engine (principle 3, R0-16, MCP3): changes to dates, guests, suppliers, payments,
// cancel/postpone — and EVERYTHING proposed by an external assistant — are first stored as
// a preview with their knock-on effects, and applied only when a person confirms in the app.
//
// A domain plugs in its kinds once, at module load:
//
//   registerWhatIf("occasion.changeDate", {
//     input: z.object({ newDate: zDate }),
//     authorize: async (ctx, p) => { await requireMember(ctx, p.occasionId!, { roles: ["owner"] }); },
//     compute: async (ctx, input, subject) => ({
//       title: { key: "occasions.whatif.changeDate", params: { … } },
//       delta: [{ key: "date", what: { key: "occasions.fields.date" }, before: "14.06.2026", after: "21.06.2026" }, …],
//     }),
//     apply: async (tx, preview) => { …do it with tx (same transaction)…; },
//   });
//
// then:  const p = await createPreview(ctx, { kind, occasionId, subjectType, subjectId, input });
//        … show <PreviewPanel preview={p} /> …  → confirmPreview(ctx, p.id) / discardPreview(ctx, p.id)

export type { WhatIfDeltaRow, WhatIfProposerKind, WhatIfState, WhatIfText } from "@ed/db";

export type WhatIfPreview = typeof whatifPreviews.$inferSelect;

export type WhatIfSubject = {
  kind: string;
  occasionId: string | null;
  subjectType: string;
  subjectId: string;
};

export type WhatIfAction = "create" | "read" | "confirm" | "discard";

export type WhatIfComputed = {
  title?: { key: string; params?: Record<string, string | number> };
  delta: WhatIfDeltaRow[];
};

export type WhatIfHandler<I = unknown> = {
  /** Validates `input` before it is stored. Strongly recommended. */
  input?: z.ZodType<I>;
  /**
   * Access check: THROW AppError (FORBIDDEN / NOT_FOUND) when ctx.actor may not do `action`
   * on this subject. Called on create, read, confirm and discard — with the actor of that
   * moment, so someone who lost access since the proposal cannot confirm it.
   */
  authorize: (ctx: Ctx, subject: WhatIfSubject, action: WhatIfAction) => Promise<void>;
  /** Works out the knock-on effects. Must not change anything. */
  compute?: (ctx: Ctx, input: I, subject: WhatIfSubject) => Promise<WhatIfComputed>;
  /**
   * Makes the change. Runs inside the confirming transaction (use the ctx you are given).
   * Re-check the current state and throw AppError("CONFLICT") if the preview is stale —
   * the preview then stays pending and nothing is applied.
   */
  apply: (txCtx: Ctx, preview: WhatIfPreview & { input: I }) => Promise<void>;
};

const g = globalThis as unknown as { __edWhatIf?: Map<string, WhatIfHandler<never>> };
const handlers: Map<string, WhatIfHandler<never>> = (g.__edWhatIf ??= new Map());

/** Registers (or replaces) the handler of one kind, e.g. "guests.remove". */
export function registerWhatIf<I>(kind: string, handler: WhatIfHandler<I>): void {
  if (!/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)+$/.test(kind)) {
    throw new Error(`Invalid what-if kind "${kind}" (expected "<domain>.<change>")`);
  }
  handlers.set(kind, handler as unknown as WhatIfHandler<never>);
}

function handlerFor(kind: string): WhatIfHandler<unknown> {
  const h = handlers.get(kind);
  if (!h) throw new AppError("VALIDATION", "whatif.errors.unknownKind");
  return h as unknown as WhatIfHandler<unknown>;
}

/** Previews not decided within this many days expire (and can no longer be confirmed). */
export const PREVIEW_TTL_DAYS = 7;
/** Label stored when an MCP proposal does not name its assistant. */
export const EXTERNAL_ASSISTANT_SOURCE = "external assistant";

const idSchema = z.string().min(1).max(64);
const textSchema: z.ZodType<WhatIfText> = z.union([
  z.string().max(500),
  z.object({
    key: z.string().min(1).max(200),
    params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  }),
]);
const deltaSchema = z
  .array(
    z.object({
      key: z.string().min(1).max(200),
      what: textSchema,
      kindLabelKey: z.string().max(200).optional(),
      before: textSchema.nullable().optional(),
      after: textSchema.nullable().optional(),
      noteKey: z.string().max(200).optional(),
      noteParams: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    }),
  )
  .max(500);

const createInput = z.object({
  kind: z.string().min(3).max(120),
  occasionId: idSchema.nullish(),
  subjectType: z.string().min(1).max(100),
  subjectId: idSchema,
  input: z.unknown(),
  /** For callers without compute(): a ready-made delta (e.g. built by the MCP tool). */
  delta: deltaSchema.optional(),
  title: z
    .object({
      key: z.string().min(1).max(200),
      params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
    })
    .optional(),
  /** Where the proposal came from (assistant name). Only kept for MCP/system proposals. */
  source: z.string().trim().max(120).optional(),
});
export type CreatePreviewInput = z.input<typeof createInput>;

function proposer(ctx: Ctx): { kind: WhatIfProposerKind; id: string | null } {
  switch (ctx.actor.kind) {
    case "account":
      return { kind: "account", id: ctx.actor.accountId };
    case "staff":
      return { kind: "account", id: ctx.actor.accountId };
    case "mcp":
      // MCP3: only read_propose tokens may propose
      if (ctx.actor.scope !== "read_propose") {
        throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
      }
      return { kind: "mcp", id: ctx.actor.tokenId };
    case "system":
      return { kind: "system", id: null };
    default:
      throw new AppError("UNAUTHENTICATED", "common.errors.UNAUTHENTICATED");
  }
}

/** Only a signed-in person decides (MCP3): never a token, the system, a guest or nobody. */
function decider(ctx: Ctx): string {
  if (ctx.actor.kind !== "account" && ctx.actor.kind !== "staff") {
    throw new AppError(
      actorAccountId(ctx.actor) || ctx.actor.kind === "system" ? "FORBIDDEN" : "UNAUTHENTICATED",
    );
  }
  return ctx.actor.accountId;
}

function subjectOf(p: WhatIfSubject): WhatIfSubject {
  return {
    kind: p.kind,
    occasionId: p.occasionId ?? null,
    subjectType: p.subjectType,
    subjectId: p.subjectId,
  };
}

/** Stores a proposed change and its effects. Changes nothing else. */
export async function createPreview(ctx: Ctx, input: CreatePreviewInput): Promise<WhatIfPreview> {
  const data = createInput.parse(input);
  const by = proposer(ctx);
  const handler = handlerFor(data.kind);
  const subject = subjectOf({ ...data, occasionId: data.occasionId ?? null });
  await handler.authorize(ctx, subject, "create");
  const parsedInput: unknown = handler.input ? handler.input.parse(data.input) : data.input;
  const computed = handler.compute
    ? await handler.compute(ctx, parsedInput, subject)
    : { title: data.title, delta: data.delta ?? [] };
  const delta = deltaSchema.parse(computed.delta);
  const title = computed.title ?? data.title;

  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(whatifPreviews)
      .values({
        occasionId: subject.occasionId,
        subjectType: subject.subjectType,
        subjectId: subject.subjectId,
        kind: data.kind,
        titleKey: title?.key ?? null,
        titleParams: title?.params ?? null,
        input: JSON.parse(JSON.stringify(parsedInput ?? null)) as unknown,
        delta,
        state: "pending",
        proposedByKind: by.kind,
        proposedById: by.id,
        accountId: actorAccountId(ctx.actor),
        source:
          by.kind === "mcp" ? (data.source ?? EXTERNAL_ASSISTANT_SOURCE) : (data.source ?? null),
        createdAt: ctx.now,
        expiresAt: addDays(ctx.now, PREVIEW_TTL_DAYS),
      })
      .returning();
    await audit(tx, {
      action: "whatif.proposed",
      objectType: "whatif_preview",
      objectId: row!.id,
      meta: { kind: data.kind, subjectType: subject.subjectType, subjectId: subject.subjectId },
    });
    return row!;
  });
}

async function load(ctx: Ctx, previewId: string): Promise<WhatIfPreview> {
  const id = idSchema.parse(previewId);
  const [row] = await ctx.db.select().from(whatifPreviews).where(eq(whatifPreviews.id, id));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

/** One preview, if the actor may see it. */
export async function getPreview(ctx: Ctx, previewId: string): Promise<WhatIfPreview> {
  const row = await load(ctx, previewId);
  await handlerFor(row.kind).authorize(ctx, subjectOf(row), "read");
  return row;
}

export type ConfirmResult = { preview: WhatIfPreview; /** false = it had already been applied */ appliedNow: boolean };

/**
 * Applies a pending preview — atomically and once (Q4). A double tap, or two people
 * confirming together, applies the change one time; the later caller gets the applied
 * preview with appliedNow: false. A discarded or expired preview is a CONFLICT.
 */
export async function confirmPreview(ctx: Ctx, previewId: string): Promise<ConfirmResult> {
  const who = decider(ctx);
  const existing = await load(ctx, previewId);
  const handler = handlerFor(existing.kind);
  await handler.authorize(ctx, subjectOf(existing), "confirm");

  return inTx(ctx, async (tx) => {
    // The conditional UPDATE is the gate: a concurrent confirm waits on the row lock here and
    // then matches nothing.
    const claimed = await tx.db
      .update(whatifPreviews)
      .set({ state: "applied", decidedAt: ctx.now, decidedBy: who })
      .where(
        and(
          eq(whatifPreviews.id, existing.id),
          eq(whatifPreviews.state, "pending"),
          gt(whatifPreviews.expiresAt, ctx.now),
        ),
      )
      .returning();
    const preview = claimed[0];
    if (!preview) {
      const current = await load(tx, existing.id);
      if (current.state === "applied") return { preview: current, appliedNow: false };
      throw new AppError(
        "CONFLICT",
        current.state === "discarded" ? "whatif.errors.discarded" : "whatif.errors.expired",
      );
    }
    // If apply throws, the whole transaction (including the state change) rolls back.
    await handler.apply(tx, preview);
    await audit(tx, {
      action: "whatif.applied",
      objectType: "whatif_preview",
      objectId: preview.id,
      meta: {
        kind: preview.kind,
        subjectType: preview.subjectType,
        subjectId: preview.subjectId,
        proposedByKind: preview.proposedByKind,
      },
    });
    return { preview, appliedNow: true };
  });
}

/**
 * Drops a pending preview. Nothing of the proposed change is kept anywhere except this row
 * (state "discarded") and one audit entry. Idempotent; an applied preview is a CONFLICT.
 */
export async function discardPreview(ctx: Ctx, previewId: string): Promise<WhatIfPreview> {
  const who = decider(ctx);
  const existing = await load(ctx, previewId);
  await handlerFor(existing.kind).authorize(ctx, subjectOf(existing), "discard");
  return inTx(ctx, async (tx) => {
    const updated = await tx.db
      .update(whatifPreviews)
      .set({ state: "discarded", decidedAt: ctx.now, decidedBy: who })
      .where(and(eq(whatifPreviews.id, existing.id), eq(whatifPreviews.state, "pending")))
      .returning();
    if (!updated[0]) {
      const current = await load(tx, existing.id);
      if (current.state === "discarded") return current;
      throw new AppError("CONFLICT", "whatif.errors.alreadyApplied");
    }
    await audit(tx, {
      action: "whatif.discarded",
      objectType: "whatif_preview",
      objectId: existing.id,
      meta: { kind: existing.kind },
    });
    return updated[0];
  });
}

/** Pending, unexpired previews of an occasion that the actor may see, newest first. */
export async function listPending(ctx: Ctx, occasionId: string): Promise<WhatIfPreview[]> {
  const id = idSchema.parse(occasionId);
  const rows = await ctx.db
    .select()
    .from(whatifPreviews)
    .where(
      and(
        eq(whatifPreviews.occasionId, id),
        eq(whatifPreviews.state, "pending"),
        gt(whatifPreviews.expiresAt, ctx.now),
      ),
    )
    .orderBy(desc(whatifPreviews.createdAt))
    .limit(200);
  const visible: WhatIfPreview[] = [];
  for (const row of rows) {
    const handler = handlers.get(row.kind) as unknown as WhatIfHandler<unknown> | undefined;
    if (!handler) continue;
    try {
      await handler.authorize(ctx, subjectOf(row), "read");
      visible.push(row);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
  }
  return visible;
}

/** JSON-safe shape for the web PreviewPanel (dates as ISO strings). */
export type WhatIfPreviewView = {
  id: string;
  kind: string;
  state: WhatIfState;
  title: { key: string; params?: Record<string, string | number> } | null;
  delta: WhatIfDeltaRow[];
  proposedByKind: WhatIfProposerKind;
  source: string | null;
  createdAt: string;
  expiresAt: string;
};

export function toPreviewView(p: WhatIfPreview): WhatIfPreviewView {
  return {
    id: p.id,
    kind: p.kind,
    state: p.state,
    title: p.titleKey ? { key: p.titleKey, params: p.titleParams ?? undefined } : null,
    delta: p.delta,
    proposedByKind: p.proposedByKind,
    source: p.source,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
  };
}

/** Undecided previews are removed 30 days after they expired (they were never applied). */
function registerRules(): void {
  registerRetentionRule({
    name: "whatif-expired-previews",
    run: async (ctx) => {
      const gone = await ctx.db
        .delete(whatifPreviews)
        .where(
          and(eq(whatifPreviews.state, "pending"), lt(whatifPreviews.expiresAt, addDays(ctx.now, -30))),
        )
        .returning({ id: whatifPreviews.id });
      return gone.length;
    },
  });
}
registerRules();

export function registerJobs(): void {
  registerRules();
}
