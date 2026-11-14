import { index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, timestamptz, updatedAt } from "./_helpers";

export const ACTOR_KINDS = ["account", "guest", "staff", "mcp", "system", "anonymous"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];
export const actorKindSchema = z.enum(ACTOR_KINDS);

/**
 * Append-only audit trail (SEC10). UPDATE and DELETE are rejected by a trigger
 * (src/sql/001_audit_append_only.sql). Write through audit() in @ed/core/audit.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    at: timestamptz("at").notNull().defaultNow(),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    meta: jsonb("meta"),
  },
  (t) => [
    index("audit_log_object_idx").on(t.objectType, t.objectId, t.at),
    index("audit_log_actor_idx").on(t.actorKind, t.actorId, t.at),
    index("audit_log_at_idx").on(t.at),
  ],
);

/** One row per (scope, key): the stored result of a mutation that must apply once (Q4). */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: id(),
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    accountId: text("account_id"),
    resultJson: jsonb("result_json"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("idempotency_keys_scope_key_uq").on(t.scope, t.key),
    index("idempotency_keys_created_at_idx").on(t.createdAt),
  ],
);

/** Operator-configurable settings edited from the console (key -> JSON value). */
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});
