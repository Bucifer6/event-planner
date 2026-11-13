import {
  and,
  asc,
  budgetCategories,
  eq,
  expenses,
  isNull,
  occasions,
  sql,
  type OccasionKind,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { DEFAULT_CURRENCY } from "@ed/shared/money";
import { zCurrency, zText } from "@ed/shared/zod";
import { z } from "zod";
import { requireMember, type Member } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { registerDigestSection } from "./digest";
import { csvCell, registerExport, toCsv } from "./exports";
import { assertOccasionWritable } from "./lifecycle";
import { registerOverviewSection, type OverviewText } from "./overview";
import { inTx } from "./tx";

// Budget by category (B1). FIVE amounts per category, always separate, never merged into one
// "spent" number:
//   estimate   entered by a person — what we planned to spend            (NULL = unknown)
//   forecast   entered by a person — what we now expect it to cost       (NULL = unknown)
//   committed  DERIVED — approved expenses + what budget sources report (signed bookings…)
//   invoiced   DERIVED — every expense that was not rejected + sources
//   paid       DERIVED — expenses marked paid (a fact, whatever their approval) + sources
// Everything here needs the `finance` grant (D2): a member without it gets FORBIDDEN on every
// read and write. Unknown stays unknown (principle 5): no estimate is NULL, never 0.

export type BudgetCategory = typeof budgetCategories.$inferSelect;

const idSchema = z.string().min(1).max(64);
/** Minor units ≥ 0, or null = unknown. */
const zAmountOrUnknown = z.number().int().safe().min(0, "common.validation.tooSmall").max(9_000_000_000_00, "common.validation.tooBig").nullable();

/** The finance gate used by every budget, expense and ledger function. */
export function requireFinance(ctx: Ctx, occasionId: string, opts: { manage?: boolean } = {}): Promise<Member> {
  return requireMember(ctx, occasionId, { grant: "finance", manage: opts.manage });
}

/* ── Default categories ─────────────────────────────────────────────────── */

/** Preset keys; names live in i18n `budget.presets.<key>`. */
export const BUDGET_PRESETS = [
  "venue",
  "food",
  "cake",
  "music",
  "photo",
  "flowers",
  "attire",
  "rings",
  "church",
  "invitations",
  "favours",
  "transport",
  "lodging",
  "activities",
  "insurance",
  "gifts",
  "misc",
] as const;
export type BudgetPreset = (typeof BUDGET_PRESETS)[number];
export const budgetPresetSchema = z.enum(BUDGET_PRESETS);

const PRESETS_BY_KIND: Record<OccasionKind, BudgetPreset[]> = {
  nunta: ["venue", "food", "music", "photo", "flowers", "attire", "rings", "invitations", "transport", "lodging", "gifts", "misc"],
  botez: ["venue", "food", "cake", "music", "photo", "flowers", "attire", "church", "invitations", "favours", "gifts", "misc"],
  aniversare: ["venue", "food", "cake", "music", "photo", "flowers", "invitations", "gifts", "misc"],
  picnic: ["food", "transport", "activities", "misc"],
  revelion: ["venue", "food", "music", "flowers", "transport", "lodging", "misc"],
  voiaj_solo: ["transport", "lodging", "food", "activities", "insurance", "misc"],
  voiaj_grup: ["transport", "lodging", "food", "activities", "insurance", "misc"],
  blank: ["venue", "food", "music", "photo", "flowers", "invitations", "transport", "misc"],
};

/** Sensible default categories for an occasion kind, in display order. */
export function presetsForKind(kind: OccasionKind): BudgetPreset[] {
  return PRESETS_BY_KIND[kind] ?? PRESETS_BY_KIND.blank;
}

/* ── Budget sources (extension point) ───────────────────────────────────── */

export type BudgetSourceSum = {
  /** NULL = not tied to a budget category (shown on the "uncategorised" row). */
  categoryId: string | null;
  committedMinor: number;
  invoicedMinor: number;
  paidMinor: number;
  currency: string;
};
export type BudgetSource = {
  key: string;
  /**
   * Amounts this domain adds to the DERIVED columns (e.g. supplier bookings: contract value →
   * committed; payment deadlines paid → paid). Called only after the finance check passed, so
   * do NOT re-check access; do not count anything already recorded as an expense (use
   * expenseTotalsByBooking from @ed/core/expenses to net those off).
   */
  sums(ctx: Ctx, occasionId: string): Promise<BudgetSourceSum[]>;
};

const g = globalThis as unknown as { __edBudgetSources?: Map<string, BudgetSource> };
const sources: Map<string, BudgetSource> = (g.__edBudgetSources ??= new Map());

/** Registers (or replaces, by key) a source of committed / invoiced / paid amounts. */
export function registerBudgetSource(source: BudgetSource): void {
  sources.set(source.key, source);
}

/* ── Reading the budget ─────────────────────────────────────────────────── */

export type BudgetRow = {
  /** NULL = expenses and source amounts without a category. */
  categoryId: string | null;
  name: string | null;
  presetKey: string | null;
  currency: string;
  estimateMinor: number | null;
  forecastMinor: number | null;
  committedMinor: number;
  invoicedMinor: number;
  paidMinor: number;
  expenseCount: number;
  /** forecast − estimate when both are known and forecast is higher; else null. */
  overrunMinor: number | null;
};
export type BudgetTotals = {
  currency: string;
  /** Sum of the KNOWN estimates; null when no category has one. */
  estimateMinor: number | null;
  /** Categories whose estimate is still unknown (they are not counted as 0). */
  estimateUnknown: number;
  forecastMinor: number | null;
  forecastUnknown: number;
  committedMinor: number;
  invoicedMinor: number;
  paidMinor: number;
};
export type Budget = {
  occasionId: string;
  categories: BudgetCategory[];
  rows: BudgetRow[];
  /** One per currency in use; the occasion's main currency (RON) first. */
  totals: BudgetTotals[];
};

type Derived = { committed: number; invoiced: number; paid: number; count: number };

async function derive(ctx: Ctx, occasionId: string): Promise<Map<string, Derived>> {
  const out = new Map<string, Derived>();
  const at = (categoryId: string | null, currency: string): Derived => {
    const key = `${categoryId ?? ""}|${currency}`;
    let d = out.get(key);
    if (!d) out.set(key, (d = { committed: 0, invoiced: 0, paid: 0, count: 0 }));
    return d;
  };
  const rows = await ctx.db
    .select({
      categoryId: expenses.categoryId,
      currency: expenses.currency,
      committed: sql<string>`coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.approvalState} = 'approved'), 0)`,
      invoiced: sql<string>`coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.approvalState} <> 'rejected'), 0)`,
      paid: sql<string>`coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.paymentState} = 'paid'), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(and(eq(expenses.occasionId, occasionId), isNull(expenses.retainedAt)))
    .groupBy(expenses.categoryId, expenses.currency);
  for (const r of rows) {
    const d = at(r.categoryId, r.currency);
    d.committed += Number(r.committed);
    d.invoiced += Number(r.invoiced);
    d.paid += Number(r.paid);
    d.count += r.count;
  }
  for (const source of sources.values()) {
    for (const s of await source.sums(ctx, occasionId)) {
      const d = at(s.categoryId, s.currency);
      d.committed += s.committedMinor;
      d.invoiced += s.invoicedMinor;
      d.paid += s.paidMinor;
    }
  }
  return out;
}

async function loadCategories(ctx: Ctx, occasionId: string): Promise<BudgetCategory[]> {
  return ctx.db
    .select()
    .from(budgetCategories)
    .where(eq(budgetCategories.occasionId, occasionId))
    .orderBy(asc(budgetCategories.sortOrder), asc(budgetCategories.createdAt), asc(budgetCategories.id));
}

/** Budget categories (finance grant). */
export async function listCategories(ctx: Ctx, occasionId: string): Promise<BudgetCategory[]> {
  await requireFinance(ctx, idSchema.parse(occasionId));
  return loadCategories(ctx, occasionId);
}

/** The whole budget: one row per category (five separate amounts) and totals per currency. */
export async function getBudget(ctx: Ctx, occasionId: string): Promise<Budget> {
  const id = idSchema.parse(occasionId);
  await requireFinance(ctx, id);
  return buildBudget(ctx, id);
}

async function buildBudget(ctx: Ctx, id: string): Promise<Budget> {
  const [categories, raw] = await Promise.all([loadCategories(ctx, id), derive(ctx, id)]);
  const known = new Set(categories.map((c) => c.id));
  // amounts whose category no longer exists (or never had one) fold into "no category"
  const derived = new Map<string, Derived>();
  for (const [key, d] of raw) {
    const [cid, cur] = key.split("|") as [string, string];
    const k = known.has(cid) ? key : `|${cur}`;
    const into = derived.get(k);
    if (into) {
      into.committed += d.committed;
      into.invoiced += d.invoiced;
      into.paid += d.paid;
      into.count += d.count;
    } else {
      derived.set(k, { ...d });
    }
  }
  const rows: BudgetRow[] = [];
  const row = (c: BudgetCategory | null, currency: string, own: boolean): BudgetRow => {
    const d = derived.get(`${c?.id ?? ""}|${currency}`) ?? { committed: 0, invoiced: 0, paid: 0, count: 0 };
    const estimate = own && c ? c.estimateMinor : null;
    const forecast = own && c ? c.forecastMinor : null;
    return {
      categoryId: c?.id ?? null,
      name: c?.name ?? null,
      presetKey: c?.presetKey ?? null,
      currency,
      estimateMinor: estimate,
      forecastMinor: forecast,
      committedMinor: d.committed,
      invoicedMinor: d.invoiced,
      paidMinor: d.paid,
      expenseCount: d.count,
      overrunMinor: estimate !== null && forecast !== null && forecast > estimate ? forecast - estimate : null,
    };
  };
  for (const c of categories) {
    rows.push(row(c, c.currency, true));
    // amounts recorded in another currency keep their own currency (no conversion)
    for (const key of derived.keys()) {
      const [cid, cur] = key.split("|") as [string, string];
      if (cid === c.id && cur !== c.currency) rows.push(row(c, cur, false));
    }
  }
  for (const key of derived.keys()) {
    const [cid, cur] = key.split("|") as [string, string];
    if (cid === "") rows.push(row(null, cur, false));
  }

  const byCurrency = new Map<string, BudgetTotals>();
  for (const r of rows) {
    let t = byCurrency.get(r.currency);
    if (!t) {
      t = { currency: r.currency, estimateMinor: null, estimateUnknown: 0, forecastMinor: null, forecastUnknown: 0, committedMinor: 0, invoicedMinor: 0, paidMinor: 0 };
      byCurrency.set(r.currency, t);
    }
    const own = r.categoryId !== null && categories.find((c) => c.id === r.categoryId)?.currency === r.currency;
    if (own) {
      if (r.estimateMinor === null) t.estimateUnknown++;
      else t.estimateMinor = (t.estimateMinor ?? 0) + r.estimateMinor;
      if (r.forecastMinor === null) t.forecastUnknown++;
      else t.forecastMinor = (t.forecastMinor ?? 0) + r.forecastMinor;
    }
    t.committedMinor += r.committedMinor;
    t.invoicedMinor += r.invoicedMinor;
    t.paidMinor += r.paidMinor;
  }
  if (byCurrency.size === 0) {
    byCurrency.set(DEFAULT_CURRENCY, { currency: DEFAULT_CURRENCY, estimateMinor: null, estimateUnknown: 0, forecastMinor: null, forecastUnknown: 0, committedMinor: 0, invoicedMinor: 0, paidMinor: 0 });
  }
  const totals = [...byCurrency.values()].sort((a, b) =>
    a.currency === DEFAULT_CURRENCY ? -1 : b.currency === DEFAULT_CURRENCY ? 1 : a.currency.localeCompare(b.currency),
  );
  return { occasionId: id, categories, rows, totals };
}

/* ── Categories ─────────────────────────────────────────────────────────── */

export const MAX_BUDGET_CATEGORIES = 60;

const addCategoriesInput = z.object({
  occasionId: idSchema,
  categories: z
    .array(
      z.object({
        name: zText(80),
        presetKey: budgetPresetSchema.optional(),
        estimateMinor: zAmountOrUnknown.optional(),
        forecastMinor: zAmountOrUnknown.optional(),
        currency: zCurrency.optional(),
      }),
    )
    .min(1)
    .max(MAX_BUDGET_CATEGORIES),
});

/**
 * Adds categories (one typed by hand, or several one-tap defaults). A name that already exists
 * in the occasion is skipped, so a double tap adds nothing twice (Q4). Returns the new rows.
 */
export async function addCategories(ctx: Ctx, input: z.input<typeof addCategoriesInput>): Promise<BudgetCategory[]> {
  requireWriteCapable(ctx);
  const data = addCategoriesInput.parse(input);
  await requireFinance(ctx, data.occasionId);
  await assertOccasionWritable(ctx, data.occasionId);
  return inTx(ctx, async (tx) => {
    const existing = await loadCategories(tx, data.occasionId);
    if (existing.length + data.categories.length > MAX_BUDGET_CATEGORIES) {
      throw new AppError("LIMIT", "budget.errors.tooManyCategories", { params: { limit: MAX_BUDGET_CATEGORIES } });
    }
    const taken = new Set(existing.map((c) => c.name.toLowerCase()));
    let order = existing.reduce((m, c) => Math.max(m, c.sortOrder), 0);
    const created: BudgetCategory[] = [];
    for (const c of data.categories) {
      if (taken.has(c.name.toLowerCase())) {
        if (data.categories.length === 1) {
          throw new AppError("VALIDATION", "budget.errors.categoryExists", {
            fieldErrors: { name: ["budget.errors.categoryExists"] },
          });
        }
        continue;
      }
      taken.add(c.name.toLowerCase());
      const [row] = await tx.db
        .insert(budgetCategories)
        .values({
          occasionId: data.occasionId,
          name: c.name,
          presetKey: c.presetKey ?? null,
          estimateMinor: c.estimateMinor ?? null,
          forecastMinor: c.forecastMinor ?? null,
          currency: c.currency ?? DEFAULT_CURRENCY,
          sortOrder: ++order,
          createdAt: tx.now,
        })
        .returning();
      created.push(row!);
      await audit(tx, {
        action: "budget.category_added",
        objectType: "budget_category",
        objectId: row!.id,
        after: { name: row!.name, estimateMinor: row!.estimateMinor, forecastMinor: row!.forecastMinor },
        meta: { occasionId: data.occasionId },
      });
    }
    return created;
  });
}

const updateCategoryInput = z.object({
  categoryId: idSchema,
  name: zText(80).optional(),
  /** null = unknown (clears the amount); omit = leave as it is. */
  estimateMinor: zAmountOrUnknown.optional(),
  forecastMinor: zAmountOrUnknown.optional(),
});

async function loadCategory(ctx: Ctx, categoryId: string): Promise<BudgetCategory> {
  const [row] = await ctx.db.select().from(budgetCategories).where(eq(budgetCategories.id, categoryId));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

/** Renames a category or sets its estimate / forecast (the two ENTERED amounts). */
export async function updateCategory(ctx: Ctx, input: z.input<typeof updateCategoryInput>): Promise<BudgetCategory> {
  requireWriteCapable(ctx);
  const data = updateCategoryInput.parse(input);
  const before = await findCategoryForActor(ctx, data.categoryId);
  await assertOccasionWritable(ctx, before.occasionId);
  return inTx(ctx, async (tx) => {
    if (data.name && data.name.toLowerCase() !== before.name.toLowerCase()) {
      const clash = (await loadCategories(tx, before.occasionId)).some(
        (c) => c.id !== before.id && c.name.toLowerCase() === data.name!.toLowerCase(),
      );
      if (clash) {
        throw new AppError("VALIDATION", "budget.errors.categoryExists", {
          fieldErrors: { name: ["budget.errors.categoryExists"] },
        });
      }
    }
    const [after] = await tx.db
      .update(budgetCategories)
      .set({
        name: data.name ?? before.name,
        estimateMinor: data.estimateMinor === undefined ? before.estimateMinor : data.estimateMinor,
        forecastMinor: data.forecastMinor === undefined ? before.forecastMinor : data.forecastMinor,
      })
      .where(eq(budgetCategories.id, before.id))
      .returning();
    await audit(tx, {
      action: "budget.category_updated",
      objectType: "budget_category",
      objectId: before.id,
      before: { name: before.name, estimateMinor: before.estimateMinor, forecastMinor: before.forecastMinor },
      after: { name: after!.name, estimateMinor: after!.estimateMinor, forecastMinor: after!.forecastMinor },
      meta: { occasionId: before.occasionId },
    });
    return after!;
  });
}

/** Non-members and members without the finance grant never learn whether the id exists. */
async function findCategoryForActor(ctx: Ctx, categoryId: string): Promise<BudgetCategory> {
  const row = await loadCategory(ctx, idSchema.parse(categoryId));
  await requireFinance(ctx, row.occasionId);
  return row;
}

/**
 * Removes a category. Its expenses are kept and become uncategorised (they are still counted
 * in the totals). Idempotent.
 */
export async function removeCategory(ctx: Ctx, input: { categoryId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const id = idSchema.parse(input.categoryId);
  const [row] = await ctx.db.select().from(budgetCategories).where(eq(budgetCategories.id, id));
  if (!row) {
    // idempotent for someone who could have removed it; otherwise say nothing
    return;
  }
  await requireFinance(ctx, row.occasionId);
  await assertOccasionWritable(ctx, row.occasionId);
  await inTx(ctx, async (tx) => {
    // expenses.category_id is ON DELETE SET NULL; category_id is not a guarded fact column
    const gone = await tx.db.delete(budgetCategories).where(eq(budgetCategories.id, id)).returning({ id: budgetCategories.id });
    if (gone.length === 0) return;
    await audit(tx, {
      action: "budget.category_removed",
      objectType: "budget_category",
      objectId: id,
      before: { name: row.name, estimateMinor: row.estimateMinor, forecastMinor: row.forecastMinor },
      meta: { occasionId: row.occasionId },
    });
  });
}

/* ── Alerts: overview + daily digest, finance-grant holders only (B12) ──── */

export type BudgetAlerts = {
  overruns: Array<{ categoryId: string; name: string; overrunMinor: number; currency: string }>;
  unpaidApproved: { count: number; totals: Array<{ currency: string; amountMinor: number }> };
};

/** Categories whose forecast is above their estimate, and approved expenses not paid yet. */
export async function getBudgetAlerts(ctx: Ctx, occasionId: string): Promise<BudgetAlerts> {
  const id = idSchema.parse(occasionId);
  await requireFinance(ctx, id);
  const budget = await buildBudget(ctx, id);
  const unpaid = await ctx.db
    .select({
      currency: expenses.currency,
      amount: sql<string>`coalesce(sum(${expenses.amountMinor}), 0)`,
      count: sql<number>`count(*)::int`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.occasionId, id),
        isNull(expenses.retainedAt),
        eq(expenses.approvalState, "approved"),
        eq(expenses.paymentState, "unpaid"),
      ),
    )
    .groupBy(expenses.currency);
  return {
    overruns: budget.rows
      .filter((r) => r.overrunMinor !== null && r.categoryId !== null)
      .map((r) => ({ categoryId: r.categoryId!, name: r.name ?? "", overrunMinor: r.overrunMinor!, currency: r.currency })),
    unpaidApproved: {
      count: unpaid.reduce((n, u) => n + u.count, 0),
      totals: unpaid.map((u) => ({ currency: u.currency, amountMinor: Number(u.amount) })),
    },
  };
}

/** "1.990 RON" without @ed/i18n (core has no i18n dependency): digest and CSV text only. */
export function plainMoney(minor: number, currency: string): string {
  const neg = minor < 0;
  const abs = Math.abs(minor);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = abs % 100;
  return `${neg ? "-" : ""}${whole}${frac ? `,${String(frac).padStart(2, "0")}` : ""} ${currency}`;
}

async function alertLines(ctx: Ctx, occasionId: string): Promise<OverviewText[]> {
  const alerts = await getBudgetAlerts(ctx, occasionId);
  const lines: OverviewText[] = alerts.overruns.slice(0, 5).map((o) => ({
    key: "budget.alerts.overrun",
    params: { category: o.name, amount: plainMoney(o.overrunMinor, o.currency) },
  }));
  if (alerts.overruns.length > 5) {
    lines.push({ key: "budget.alerts.moreOverruns", params: { count: alerts.overruns.length - 5 } });
  }
  for (const t of alerts.unpaidApproved.totals) {
    lines.push({ key: "budget.alerts.unpaidApproved", params: { amount: plainMoney(t.amountMinor, t.currency) } });
  }
  return lines;
}

/* ── CSV export ─────────────────────────────────────────────────────────── */

const CSV_HEAD = {
  ro: ["Categorie", "Monedă", "Estimat", "Angajat", "Facturat", "Plătit", "Prognoză", "Cheltuieli"],
  en: ["Category", "Currency", "Estimate", "Committed", "Invoiced", "Paid", "Forecast", "Expenses"],
} as const;
const CSV_WORDS = {
  ro: { unknown: "necunoscut", uncategorised: "Fără categorie", total: "Total" },
  en: { unknown: "unknown", uncategorised: "No category", total: "Total" },
} as const;

const major = (minor: number): string => (minor / 100).toFixed(2);

/** Budget as CSV: the five amounts in five columns; unknown is the word, never 0. */
export async function exportBudgetCsv(ctx: Ctx, occasionId: string): Promise<string> {
  const budget = await getBudget(ctx, occasionId);
  const w = CSV_WORDS[ctx.locale];
  const cell = (v: number | null) => (v === null ? w.unknown : major(v));
  const rows = budget.rows.map((r) => [
    r.name ?? w.uncategorised,
    r.currency,
    r.categoryId === null ? "" : cell(r.estimateMinor),
    major(r.committedMinor),
    major(r.invoicedMinor),
    major(r.paidMinor),
    r.categoryId === null ? "" : cell(r.forecastMinor),
    r.expenseCount,
  ]);
  for (const t of budget.totals) {
    rows.push([w.total, t.currency, cell(t.estimateMinor), major(t.committedMinor), major(t.invoicedMinor), major(t.paidMinor), cell(t.forecastMinor), ""]);
  }
  return toCsv([...CSV_HEAD[ctx.locale]], rows);
}
void csvCell;

/* ── Registrations ──────────────────────────────────────────────────────── */

function register(): void {
  registerExport({
    key: "budget-csv",
    titleKey: "budget.export.title",
    descriptionKey: "budget.export.description",
    grant: "finance",
    run: async (ctx, occasionId) => {
      const [o] = await ctx.db.select({ title: occasions.title }).from(occasions).where(eq(occasions.id, occasionId));
      return { filename: `buget-${fileSlug(o?.title ?? "")}.csv`, mime: "text/csv; charset=utf-8", content: await exportBudgetCsv(ctx, occasionId) };
    },
  });
  registerDigestSection({
    key: "finance",
    titleKey: "budget.alerts.title",
    // requireFinance inside getBudgetAlerts throws FORBIDDEN for everyone else → section omitted
    forMember: (ctx, _member, occasionId) => alertLines(ctx, occasionId),
  });
  registerOverviewSection({
    key: "finance",
    forMember: async (ctx, member, occasionId) => {
      if (!member.grants.finance) return null;
      const lines = await alertLines(ctx, occasionId);
      return lines.length > 0 ? { titleKey: "budget.alerts.title", lines, slug: "budget" } : null;
    },
  });
}
register();

export function fileSlug(title: string): string {
  const s = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "ocazie";
}

export function registerJobs(): void {
  register();
}
