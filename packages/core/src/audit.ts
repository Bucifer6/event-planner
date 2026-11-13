import { auditLog } from "@ed/db";
import { z } from "zod";
import { actorAccountId, actorRef, type Ctx } from "./context";

const auditInput = z.object({
  /** "<object>.<verb>", e.g. "task.completed" */
  action: z.string().min(1).max(200),
  objectType: z.string().min(1).max(100),
  objectId: z.string().max(200).nullish(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

export type AuditInput = {
  action: string;
  objectType: string;
  objectId?: string | null;
  /** JSON-serialisable snapshots. Never put secrets, codes or tokens in here. */
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
};

/**
 * Appends one row to the append-only audit log (SEC10). Call it inside the same transaction
 * as the state change (pass the inTx ctx) so the change and its audit row commit together.
 * Returns the audit row id.
 */
export async function audit(ctx: Ctx, input: AuditInput): Promise<string> {
  const data = auditInput.parse(input);
  const ref = actorRef(ctx.actor);
  // For staff and MCP the actor id is the staff/token id; keep the account alongside.
  const accountId = ref.kind === "staff" || ref.kind === "mcp" ? actorAccountId(ctx.actor) : null;
  const meta = accountId ? { ...data.meta, actorAccountId: accountId } : data.meta;
  const [row] = await ctx.db
    .insert(auditLog)
    .values({
      at: ctx.now,
      actorKind: ref.kind,
      actorId: ref.id,
      action: data.action,
      objectType: data.objectType,
      objectId: data.objectId ?? null,
      before: toJson(data.before),
      after: toJson(data.after),
      meta: toJson(meta),
    })
    .returning({ id: auditLog.id });
  return row!.id;
}

/** Dates -> ISO strings, bigint -> string, undefined stays out; result is plain JSON or null. */
function toJson(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}
