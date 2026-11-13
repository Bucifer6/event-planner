import { AppError } from "@ed/shared/errors";
import { requireMember, type Member, type OccasionGrant } from "./access";
import type { Ctx } from "./context";
import { getOccasion } from "./occasions";
import { countTasks, queryTasks, type TaskItem } from "./tasks";
import { formatDay } from "./templates";

// Basic exports (A12). An export contains the occasion's OWN data only: nothing from the
// directory, no Featured/paid content (P16, invariant 7), nothing a member has no grant for (D2).

export type ExportFile = { filename: string; mime: string; content: string };
export type ExportDefinition = {
  /** URL-safe key: /occasions/<id>/print/<key> downloads it. */
  key: string;
  /** i18n keys for the row on the print page. */
  titleKey: string;
  descriptionKey?: string;
  /** Members without this grant neither see nor can run the export. */
  grant?: OccasionGrant;
  /** Owner / project manager only. */
  manageOnly?: boolean;
  run: (ctx: Ctx, occasionId: string, member: Member) => Promise<ExportFile>;
};

const g = globalThis as unknown as { __edExports?: Map<string, ExportDefinition> };
const registry: Map<string, ExportDefinition> = (g.__edExports ??= new Map());

/**
 * EXTENSION POINT for later releases — register more exports here-style from your own domain:
 *   - guest list CSV (guests agent; needs no grant, but never other households' private answers)
 *   - supplier briefing PDF (release B)
 *   - budget CSV (release B; grant: "finance")
 *   - print pack: place cards, table plan, menu (release C)
 * Registered exports appear on /occasions/<id>/print automatically.
 */
export function registerExport(def: ExportDefinition): void {
  if (!/^[a-z][a-z0-9-]*$/.test(def.key)) throw new Error(`Invalid export key: ${def.key}`);
  registry.set(def.key, def);
}

function allowed(def: ExportDefinition, member: Member): boolean {
  if (def.grant && !member.grants[def.grant]) return false;
  if (def.manageOnly && member.role !== "owner" && member.role !== "pm") return false;
  return true;
}

/** Exports this member may run, in registration order. */
export async function listExports(ctx: Ctx, occasionId: string): Promise<Array<Pick<ExportDefinition, "key" | "titleKey" | "descriptionKey">>> {
  const member = await requireMember(ctx, occasionId);
  return [...registry.values()]
    .filter((d) => allowed(d, member))
    .map((d) => ({ key: d.key, titleKey: d.titleKey, descriptionKey: d.descriptionKey }));
}

/** Runs one export. Unknown key or missing grant looks the same as "not there" / FORBIDDEN. */
export async function runExport(ctx: Ctx, occasionId: string, key: string): Promise<ExportFile> {
  const def = registry.get(key);
  const member = await requireMember(ctx, occasionId, {
    grant: def?.grant,
    manage: def?.manageOnly,
  });
  if (!def) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return def.run(ctx, occasionId, member);
}

/* ── CSV ────────────────────────────────────────────────────────────────── */

/** RFC 4180 cell; cells that a spreadsheet would run as a formula are defused with a quote. */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** UTF-8 CSV with a BOM so Excel reads diacritics correctly. */
export function toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

function slug(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "ocazie";
}

const HEAD = {
  ro: {
    tasks: ["Sarcină", "Stare", "Termen", "Etapă", "Responsabil", "Listă de verificare", "Subsarcini", "Așteaptă după", "Prioritate"],
    summary: ["Câmp", "Valoare"],
    status: { todo: "De făcut", doing: "În lucru", waiting: "În așteptare", done: "Gata" },
    stage: { m12: "12 luni înainte", m9: "9 luni înainte", m6: "6 luni înainte", m3: "3 luni înainte", m1: "Ultima lună", week: "Săptămâna evenimentului", after: "După eveniment" },
    fields: { title: "Ocazie", date: "Data", venue: "Locul", address: "Adresa", purpose: "Scop", priority: "Prioritate", total: "Sarcini în total", done: "Sarcini gata", open: "Sarcini rămase", poll: "se decide prin sondaj" },
  },
  en: {
    tasks: ["Task", "Status", "Due", "Stage", "Owner", "Checklist", "Child tasks", "Waiting for", "Priority"],
    summary: ["Field", "Value"],
    status: { todo: "To do", doing: "In progress", waiting: "Waiting", done: "Done" },
    stage: { m12: "12 months before", m9: "9 months before", m6: "6 months before", m3: "3 months before", m1: "Last month", week: "Week of the event", after: "After the event" },
    fields: { title: "Occasion", date: "Date", venue: "Venue", address: "Address", purpose: "Purpose", priority: "Priority", total: "Tasks in total", done: "Tasks done", open: "Tasks left", poll: "to be decided by poll" },
  },
} as const;

/** Hard ceiling of one export (pages of 500 through the one task query). */
export const EXPORT_TASK_LIMIT = 20_000;

async function allTasks(ctx: Ctx, occasionId: string): Promise<TaskItem[]> {
  const out: TaskItem[] = [];
  for (let offset = 0; offset < EXPORT_TASK_LIMIT; offset += 500) {
    const page = await queryTasks(ctx, occasionId, { limit: 500, offset });
    out.push(...page.rows);
    if (!page.hasMore) break;
  }
  return out;
}

/** Tasks of the occasion as CSV, in the reader's language. Members only. */
export async function exportTasksCsv(ctx: Ctx, occasionId: string): Promise<ExportFile> {
  const occasion = await getOccasion(ctx, occasionId);
  const h = HEAD[ctx.locale];
  const rows = (await allTasks(ctx, occasionId)).map((t) => [
    t.title,
    h.status[t.status],
    t.dueAt ? formatDay(t.dueAt, occasion.timezone) : "",
    t.stage ? h.stage[t.stage] : "",
    t.ownerName ?? "",
    t.checklist.total > 0 ? `${t.checklist.done}/${t.checklist.total}` : "",
    t.children.total > 0 ? `${t.children.done}/${t.children.total}` : "",
    t.blockedBy > 0 ? t.blockedBy : "",
    t.priorityIndex !== null ? (occasion.priorities[t.priorityIndex] ?? "") : "",
  ]);
  return {
    filename: `${slug(occasion.title)}-${ctx.locale === "ro" ? "sarcini" : "tasks"}.csv`,
    mime: "text/csv; charset=utf-8",
    content: toCsv([...h.tasks], rows),
  };
}

export type PlanSummary = {
  title: string;
  date: string | null;
  endDate: string | null;
  venueName: string | null;
  venueAddress: string | null;
  purpose: string | null;
  priorities: string[];
  counts: { total: number; done: number; open: number };
  tasks: TaskItem[];
  timezone: string;
};

/** The plan on one page: brief, counts and the task list (also the print page's data). */
export async function getPlanSummary(ctx: Ctx, occasionId: string): Promise<PlanSummary> {
  const occasion = await getOccasion(ctx, occasionId);
  const [counts, tasks] = await Promise.all([countTasks(ctx, occasionId), allTasks(ctx, occasionId)]);
  return {
    title: occasion.title,
    date: occasion.startsAt ? formatDay(occasion.startsAt, occasion.timezone) : null,
    endDate: occasion.endsAt ? formatDay(occasion.endsAt, occasion.timezone) : null,
    venueName: occasion.venueName,
    venueAddress: occasion.venueAddress,
    purpose: occasion.purpose,
    priorities: occasion.priorities,
    counts: { total: counts.total, done: counts.done, open: counts.total - counts.done },
    tasks,
    timezone: occasion.timezone,
  };
}

/** The plan summary as a two-column CSV. */
export async function exportPlanSummaryCsv(ctx: Ctx, occasionId: string): Promise<ExportFile> {
  const s = await getPlanSummary(ctx, occasionId);
  const h = HEAD[ctx.locale];
  const rows: Array<[string, string | number]> = [
    [h.fields.title, s.title],
    [h.fields.date, s.date ? (s.endDate ? `${s.date} – ${s.endDate}` : s.date) : h.fields.poll],
    [h.fields.venue, s.venueName ?? ""],
    [h.fields.address, s.venueAddress ?? ""],
    [h.fields.purpose, s.purpose ?? ""],
    ...s.priorities.map((p, i): [string, string] => [`${h.fields.priority} ${i + 1}`, p]),
    [h.fields.total, s.counts.total],
    [h.fields.done, s.counts.done],
    [h.fields.open, s.counts.open],
  ];
  return {
    filename: `${slug(s.title)}-${ctx.locale === "ro" ? "rezumat" : "summary"}.csv`,
    mime: "text/csv; charset=utf-8",
    content: toCsv([...h.summary], rows),
  };
}

registerExport({
  key: "tasks",
  titleKey: "overview.exports.tasks.title",
  descriptionKey: "overview.exports.tasks.description",
  run: (ctx, occasionId) => exportTasksCsv(ctx, occasionId),
});
registerExport({
  key: "summary",
  titleKey: "overview.exports.summary.title",
  descriptionKey: "overview.exports.summary.description",
  run: (ctx, occasionId) => exportPlanSummaryCsv(ctx, occasionId),
});
