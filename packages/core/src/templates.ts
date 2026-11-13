import {
  and,
  asc,
  eq,
  inArray,
  occasions,
  tasks,
  templateTasks,
  templates,
  type OccasionKind,
  type TaskStage,
  type WhatIfDeltaRow,
} from "@ed/db";
import { occasionKindSchema } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zonedParts, zonedToUtc } from "@ed/shared/time";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { createPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// Templates (A2): seeded task lists, scheduled relative to the occasion date. Applying or
// re-running a template is a diff against the tasks already there — matched by a stable
// templateTaskKey, so nothing is ever duplicated — and goes through a What-if preview.

/* ── Calendar-day helpers (a "day" is stored as 12:00 local time in the occasion's zone) ── */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const zDay = z.string().regex(DAY_RE, "common.validation.invalid").refine((s) => {
  const m = DAY_RE.exec(s)!;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}, "common.validation.invalid");

/** "2026-06-14" → the instant of 12:00 that day in `tz`. */
export function dayToInstant(day: string, tz: string): Date {
  const m = DAY_RE.exec(day);
  if (!m) throw new AppError("VALIDATION", "common.validation.invalid");
  return zonedToUtc({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: 12 }, tz);
}

/** The calendar day ("2026-06-14") of an instant in `tz`. */
export function instantToDay(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Calendar arithmetic on a day key; months clamp to the month end (31 Mar − 1 month = 28 Feb). */
export function shiftDay(day: string, by: { months?: number; days?: number }): string {
  const m = DAY_RE.exec(day);
  if (!m) throw new AppError("VALIDATION", "common.validation.invalid");
  let year = Number(m[1]);
  let month = Number(m[2]) - 1 + (by.months ?? 0);
  year += Math.floor(month / 12);
  month = ((month % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(year, month, Math.min(Number(m[3]), last) + (by.days ?? 0)));
  return d.toISOString().slice(0, 10);
}

/** Whole calendar days from `a` to `b` (negative when b is earlier). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** dd.mm.yyyy — the one date shape used in previews, emails and exports. */
export function formatDay(d: Date, tz: string): string {
  const [y, m, day] = instantToDay(d, tz).split("-");
  return `${day}.${m}.${y}`;
}

/** Due date of a template task: occasion day − offsetMonths months + offsetDays days. */
export function scheduleDue(
  startsAt: Date | null,
  tz: string,
  offsetMonths: number | null,
  offsetDays: number | null,
): Date | null {
  if (!startsAt) return null;
  const day = shiftDay(instantToDay(startsAt, tz), {
    months: -(offsetMonths ?? 0),
    days: offsetDays ?? 0,
  });
  return dayToInstant(day, tz);
}

/* ── Catalogue ──────────────────────────────────────────────────────────── */

export type Template = typeof templates.$inferSelect;
export type TemplateTask = typeof templateTasks.$inferSelect;
export type TemplateSummary = {
  kind: OccasionKind;
  nameRo: string;
  nameEn: string;
  descriptionRo: string | null;
  descriptionEn: string | null;
  taskCount: number;
};

/** The seeded templates in display order (public catalogue: no access check needed). */
export async function listTemplates(ctx: Ctx): Promise<TemplateSummary[]> {
  const rows = await ctx.db.select().from(templates).orderBy(asc(templates.position));
  const counts = new Map<string, number>();
  if (rows.length > 0) {
    const all = await ctx.db
      .select({ templateId: templateTasks.templateId })
      .from(templateTasks)
      .where(inArray(templateTasks.templateId, rows.map((r) => r.id)));
    for (const r of all) counts.set(r.templateId, (counts.get(r.templateId) ?? 0) + 1);
  }
  return rows.map((r) => ({
    kind: r.kind,
    nameRo: r.nameRo,
    nameEn: r.nameEn,
    descriptionRo: r.descriptionRo,
    descriptionEn: r.descriptionEn,
    taskCount: counts.get(r.id) ?? 0,
  }));
}

async function loadTemplateTasks(ctx: Ctx, kind: OccasionKind): Promise<TemplateTask[]> {
  const [tpl] = await ctx.db.select().from(templates).where(eq(templates.kind, kind));
  if (!tpl) return [];
  return ctx.db
    .select()
    .from(templateTasks)
    .where(eq(templateTasks.templateId, tpl.id))
    .orderBy(asc(templateTasks.position));
}

/* ── Diff ───────────────────────────────────────────────────────────────── */

export type TemplatePlanRow = {
  templateTaskKey: string;
  action: "create" | "change" | "skip";
  /** Why a row is skipped. */
  reason?: "unchanged" | "done";
  title: string;
  stage: TaskStage;
  offsetMonths: number;
  offsetDays: number;
  dueAt: Date | null;
  existing?: { id: string; title: string; dueAt: Date | null };
};

type OccasionRow = typeof occasions.$inferSelect;

/**
 * What applying `kind` to the occasion would do, task by task. Pure read.
 * create = no task with that template key yet; change = the task exists but its title or due
 * date differs from the template; skip = identical, or already done (done work is never moved).
 */
export async function planTemplate(
  ctx: Ctx,
  occasion: OccasionRow,
  kind: OccasionKind,
): Promise<TemplatePlanRow[]> {
  const tplTasks = await loadTemplateTasks(ctx, kind);
  if (tplTasks.length === 0) return [];
  const keys = tplTasks.map((t) => `${kind}:${t.key}`);
  const existing = await ctx.db
    .select()
    .from(tasks)
    .where(and(eq(tasks.occasionId, occasion.id), inArray(tasks.templateTaskKey, keys)));
  const byKey = new Map(existing.map((t) => [t.templateTaskKey!, t]));

  return tplTasks.map((tt) => {
    const templateTaskKey = `${kind}:${tt.key}`;
    const title = occasion.locale === "en" ? tt.titleEn : tt.titleRo;
    const dueAt = scheduleDue(occasion.startsAt, occasion.timezone, tt.offsetMonths, tt.offsetDays);
    const base = {
      templateTaskKey,
      title,
      stage: tt.stage,
      offsetMonths: tt.offsetMonths,
      offsetDays: tt.offsetDays,
      dueAt,
    };
    const current = byKey.get(templateTaskKey);
    if (!current) return { ...base, action: "create" as const };
    const ref = { id: current.id, title: current.title, dueAt: current.dueAt };
    if (current.status === "done") {
      return { ...base, action: "skip" as const, reason: "done" as const, existing: ref };
    }
    const same =
      current.title === title && (current.dueAt?.getTime() ?? null) === (dueAt?.getTime() ?? null);
    return same
      ? { ...base, action: "skip" as const, reason: "unchanged" as const, existing: ref }
      : { ...base, action: "change" as const, existing: ref };
  });
}

/** Applies a plan inside the caller's transaction. Returns what it did. */
export async function applyTemplatePlan(
  tx: Ctx,
  occasion: OccasionRow,
  rows: TemplatePlanRow[],
  createdByMemberId: string | null,
): Promise<{ created: number; changed: number; skipped: number }> {
  let created = 0;
  let changed = 0;
  const creates = rows.filter((r) => r.action === "create");
  if (creates.length > 0) {
    const inserted = await tx.db
      .insert(tasks)
      .values(
        creates.map((r) => ({
          occasionId: occasion.id,
          title: r.title,
          stage: r.stage,
          dueAt: r.dueAt,
          templateTaskKey: r.templateTaskKey,
          offsetMonths: r.offsetMonths,
          offsetDays: r.offsetDays,
          createdByMemberId,
          createdAt: tx.now,
        })),
      )
      // the unique (occasion, templateTaskKey) index makes a concurrent re-run a no-op
      .onConflictDoNothing()
      .returning({ id: tasks.id });
    created = inserted.length;
  }
  for (const r of rows) {
    if (r.action !== "change" || !r.existing) continue;
    const res = await tx.db
      .update(tasks)
      .set({
        title: r.title,
        dueAt: r.dueAt,
        stage: r.stage,
        offsetMonths: r.offsetMonths,
        offsetDays: r.offsetDays,
      })
      .where(and(eq(tasks.id, r.existing.id), eq(tasks.occasionId, occasion.id)))
      .returning({ id: tasks.id });
    changed += res.length;
  }
  return { created, changed, skipped: rows.length - creates.length - changed };
}

/** Rows shown in a preview before the summary row takes over. */
export const PREVIEW_ROW_LIMIT = 300;

function planDelta(rows: TemplatePlanRow[], tz: string): WhatIfDeltaRow[] {
  const delta: WhatIfDeltaRow[] = [];
  const shown = rows.filter((r) => r.action !== "skip");
  for (const r of shown.slice(0, PREVIEW_ROW_LIMIT)) {
    if (r.action === "create") {
      delta.push({
        key: r.templateTaskKey,
        what: r.title,
        kindLabelKey: "whatif.kinds.added",
        after: r.dueAt ? formatDay(r.dueAt, tz) : { key: "templates.whatif.noDate" },
      });
    } else {
      const titleChanged = r.existing!.title !== r.title;
      delta.push({
        key: r.templateTaskKey,
        what: r.existing!.title,
        kindLabelKey: "whatif.kinds.changed",
        before: r.existing!.dueAt ? formatDay(r.existing!.dueAt, tz) : null,
        after: r.dueAt ? formatDay(r.dueAt, tz) : null,
        ...(titleChanged
          ? { noteKey: "templates.whatif.renamed", noteParams: { title: r.title } }
          : {}),
      });
    }
  }
  if (shown.length > PREVIEW_ROW_LIMIT) {
    delta.push({
      key: "_more",
      what: { key: "templates.whatif.more", params: { count: shown.length - PREVIEW_ROW_LIMIT } },
    });
  }
  const skipped = rows.length - shown.length;
  if (skipped > 0) {
    delta.push({
      key: "_skipped",
      what: { key: "templates.whatif.skipped", params: { count: skipped } },
      kindLabelKey: "templates.whatif.skipLabel",
    });
  }
  return delta;
}

export const APPLY_TEMPLATE_KIND = "tasks.applyTemplate";
const applyInput = z.object({ kind: occasionKindSchema });

async function loadOccasion(ctx: Ctx, occasionId: string | null): Promise<OccasionRow> {
  if (!occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [row] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

registerWhatIf<z.infer<typeof applyInput>>(APPLY_TEMPLATE_KIND, {
  input: applyInput,
  authorize: async (ctx, subject, action) => {
    await requireMember(ctx, subject.occasionId ?? "", action === "read" ? {} : { manage: true });
  },
  compute: async (ctx, input, subject) => {
    const occasion = await loadOccasion(ctx, subject.occasionId);
    const rows = await planTemplate(ctx, occasion, input.kind);
    return {
      title: { key: `templates.whatif.applyTitle.${input.kind}` },
      delta: planDelta(rows, occasion.timezone),
    };
  },
  apply: async (tx, preview) => {
    const occasion = await loadOccasion(tx, preview.occasionId);
    const member = await requireMember(tx, occasion.id, { manage: true });
    // recomputed now: whatever changed since the preview, the result never duplicates
    const rows = await planTemplate(tx, occasion, preview.input.kind);
    const result = await applyTemplatePlan(tx, occasion, rows, member.id);
    await audit(tx, {
      action: "template.applied",
      objectType: "occasion",
      objectId: occasion.id,
      meta: { kind: preview.input.kind, ...result },
    });
  },
});

/** Preview of applying (or re-running) a template on an occasion. Managers only. */
export async function proposeTemplate(
  ctx: Ctx,
  input: { occasionId: string; kind: OccasionKind },
): Promise<WhatIfPreview> {
  const data = z.object({ occasionId: z.string().min(1).max(64), kind: occasionKindSchema }).parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  return createPreview(ctx, {
    kind: APPLY_TEMPLATE_KIND,
    occasionId: data.occasionId,
    subjectType: "occasion",
    subjectId: data.occasionId,
    input: { kind: data.kind },
  });
}

/** The diff itself (same rows the preview shows), for screens that want the detail. */
export async function getTemplateDiff(
  ctx: Ctx,
  input: { occasionId: string; kind: OccasionKind },
): Promise<TemplatePlanRow[]> {
  await requireMember(ctx, input.occasionId);
  const occasion = await loadOccasion(ctx, input.occasionId);
  return planTemplate(ctx, occasion, occasionKindSchema.parse(input.kind));
}
