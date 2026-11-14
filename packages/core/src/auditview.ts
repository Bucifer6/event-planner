import { and, auditLog, desc, eq, gte, ilike, lt, lte, or, ACTOR_KINDS, type SQL } from "@ed/db";
import { addZonedDays, bucharestToUtc } from "@ed/shared/time";
import { z } from "zod";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { requireStaffRole } from "./staff";

// Audit log viewer and export (W8, SEC10). READ-ONLY by construction: this module — the only
// console path to audit_log — exports a list and a CSV copy and nothing that updates or
// deletes. The table itself rejects UPDATE/DELETE/TRUNCATE for every role (database trigger).
// Taking an export is itself written to the log.

const AUDIT_ROLES = ["platform_admin", "security_administrator", "privacy_owner"] as const;

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_MAX_ROWS = 50_000;

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(max).optional());
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/**
 * A Date / ISO instant, or a plain day "yyyy-mm-dd" as a date input sends it. A plain day is
 * read in Europe/Bucharest: its start for `from`, its last millisecond for `to`.
 */
const optionalDate = (edge: "start" | "end") =>
  z.preprocess((v) => {
    if (v === "" || v === null) return undefined;
    const m = typeof v === "string" ? DAY_RE.exec(v.trim()) : null;
    if (!m) return v;
    const start = bucharestToUtc({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: 0, minute: 0 });
    return edge === "start" ? start : new Date(addZonedDays(start, 1).getTime() - 1);
  }, z.coerce.date("common.validation.invalid").optional());

export const auditFilterSchema = z.object({
  actorKind: z.preprocess((v) => (v === "" ? undefined : v), z.enum(ACTOR_KINDS).optional()),
  /** Exact actor id (account, staff or token id). */
  actorId: optionalText(200),
  /** Action, or its beginning ("approval." finds every approval event). */
  action: optionalText(200),
  objectType: optionalText(100),
  objectId: optionalText(200),
  /** Both ends inclusive. */
  from: optionalDate("start"),
  to: optionalDate("end"),
});
export type AuditFilter = z.input<typeof auditFilterSchema>;

export type AuditEntry = typeof auditLog.$inferSelect;

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function conditions(f: z.output<typeof auditFilterSchema>): SQL | undefined {
  return and(
    f.actorKind ? eq(auditLog.actorKind, f.actorKind) : undefined,
    f.actorId ? eq(auditLog.actorId, f.actorId) : undefined,
    f.action ? ilike(auditLog.action, `${escapeLike(f.action)}%`) : undefined,
    f.objectType ? eq(auditLog.objectType, f.objectType) : undefined,
    f.objectId ? eq(auditLog.objectId, f.objectId) : undefined,
    f.from ? gte(auditLog.at, f.from) : undefined,
    f.to ? lte(auditLog.at, f.to) : undefined,
  );
}

/** Keyset cursor "<iso time>|<id>": stable while new rows keep arriving. */
function parseCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = cursor.split("|");
  const at = new Date(iso ?? "");
  return id && !Number.isNaN(at.getTime()) ? { at, id } : null;
}

export type AuditPage = { entries: AuditEntry[]; nextCursor: string | null };

/** One page of the audit log, newest first, filtered by actor, action, object and date. */
export async function listAudit(
  ctx: Ctx,
  input: AuditFilter & { cursor?: string; limit?: number } = {},
): Promise<AuditPage> {
  requireStaffRole(ctx, ...AUDIT_ROLES);
  const filter = auditFilterSchema.parse(input);
  const limit = Math.min(Math.max(input.limit ?? AUDIT_PAGE_SIZE, 1), 200);
  const cursor = parseCursor(input.cursor);
  const rows = await ctx.db
    .select()
    .from(auditLog)
    .where(
      and(
        conditions(filter),
        cursor
          ? or(lt(auditLog.at, cursor.at), and(eq(auditLog.at, cursor.at), lt(auditLog.id, cursor.id)))
          : undefined,
      ),
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1);
  const entries = rows.slice(0, limit);
  const last = entries[entries.length - 1];
  return {
    entries,
    nextCursor: rows.length > limit && last ? `${last.at.toISOString()}|${last.id}` : null,
  };
}

const CSV_COLUMNS = [
  "id",
  "at",
  "actor_kind",
  "actor_id",
  "action",
  "object_type",
  "object_id",
  "before",
  "after",
  "meta",
] as const;

/** RFC 4180 quoting, plus a leading apostrophe on cells a spreadsheet would run as a formula. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "string" ? value : value instanceof Date ? value.toISOString() : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export type AuditExport = { filename: string; csv: string; rows: number; truncated: boolean };

/**
 * A read-only COPY of the filtered log as CSV (W8). Nothing in audit_log changes except one
 * new row saying who exported what.
 */
export async function exportAuditCsv(ctx: Ctx, input: AuditFilter = {}): Promise<AuditExport> {
  requireStaffRole(ctx, ...AUDIT_ROLES);
  const filter = auditFilterSchema.parse(input);
  const rows = await ctx.db
    .select()
    .from(auditLog)
    .where(conditions(filter))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(AUDIT_EXPORT_MAX_ROWS + 1);
  const truncated = rows.length > AUDIT_EXPORT_MAX_ROWS;
  const data = truncated ? rows.slice(0, AUDIT_EXPORT_MAX_ROWS) : rows;
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of data) {
    lines.push(
      [r.id, r.at, r.actorKind, r.actorId, r.action, r.objectType, r.objectId, r.before, r.after, r.meta]
        .map(csvCell)
        .join(","),
    );
  }
  await audit(ctx, {
    action: "audit.exported",
    objectType: "audit_log",
    meta: {
      rows: data.length,
      truncated,
      filter: {
        ...filter,
        from: filter.from?.toISOString(),
        to: filter.to?.toISOString(),
      },
    },
  });
  const stamp = ctx.now.toISOString().replace(/[:.]/g, "-");
  return { filename: `eventdesk-audit-${stamp}.csv`, csv: `${lines.join("\r\n")}\r\n`, rows: data.length, truncated };
}
