import {
  and,
  arrangementDesigns,
  arrangementQuoteRequests,
  arrangementVersions,
  ARRANGEMENT_FORMS,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  listings,
  occasions,
  sql,
  type ArrangementForm,
  type ArrangementLine,
  type ArrangementSource,
  type WhatIfDeltaRow,
} from "@ed/db";
import { translate } from "@ed/i18n";
import { formatMoney } from "@ed/i18n/format";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { isManager, requireMember } from "./access";
import { ARRANGEMENT_LIMITS, diffVersions, indicativeCost, type DesignChange, type IndicativeCost } from "./arrangementkit";
import { audit } from "./audit";
import { getCatalogueItem } from "./catalogues";
import { actorAccountId, type Ctx, type Locale } from "./context";
import { getQuoteLink, sendQuoteRequest, type QuoteLinkView } from "./enquiries";
import { assertOccasionWritable } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { getRsvpSummary } from "./rsvp";
import { PLANNING_ROLES } from "./suppliers";
import { instantToDay } from "./templates";
import { inTx } from "./tx";
import { createPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// VISUAL FLOWER ARRANGEMENT DESIGNER (C-13, F3–F6).
//
//   listArrangementDesigns(ctx, occasionId)       READ API (pages, MCP get tools): designs with stems + indicative cost
//   getArrangementDesign(ctx, designId, version?) READ API: one design, its lines, versions, quote state
//   saveArrangementDesign(ctx, input)             a new design, or a new immutable version of one
//   archiveArrangementDesign(ctx, { designId })
//   requestArrangementQuote(ctx, input)           "Cere ofertă" → @ed/core/enquiries sendQuoteRequest (F5)
//   proposeArrangementDesign(ctx, input)          What-if "arrangement.applyDesign" (MCP propose_arrangement_design)
//
// INDICATIVE COST, NEVER A QUOTE (F3, MCP5): the running cost is Σ stems × the price per stem a
// business PUBLISHED in its catalogue. It is always labelled "cost orientativ — nu este o
// ofertă". A variety without a published price per stem is not counted as 0: the total
// becomes "at least X, plus n items without a price" (principle 5).
//
// F5: a quote request carries the arrangement (a description written from the design + the
// design reference), the occasion date, the approximate guest count and the planner's
// message — nothing else. The indicative cost, other businesses' names and who else was asked
// are NOT sent (buildQuoteDescription is the whole description; a test pins the payload).
//
// F6: every request remembers the design version it carried; once a quote is accepted
// (@ed/core/enquiries getQuoteLink) a later version of the design shows as "design modificat
// după ofertă" with the item-by-item delta.

export { ARRANGEMENT_FORMS };
export type { ArrangementForm, ArrangementLine };
export type ArrangementDesign = typeof arrangementDesigns.$inferSelect;
export type ArrangementVersion = typeof arrangementVersions.$inferSelect;

export const ARRANGEMENT_KIND = "arrangement.applyDesign";
export const MAX_DESIGNS_PER_OCCASION = 40;

const zId = z.string().min(1).max(64);
const itemInput = z.object({
  catalogueItemId: zId,
  stems: z.number("common.validation.invalid").int().min(1, "arrangements.errors.stems").max(ARRANGEMENT_LIMITS.maxStemsPerLine, "arrangements.errors.stems"),
  colour: z.string().max(24).nullish(),
});
const designFields = {
  form: z.enum(ARRANGEMENT_FORMS),
  items: z.array(itemInput).min(1, "arrangements.errors.empty").max(ARRANGEMENT_LIMITS.maxLines, "arrangements.errors.tooMany"),
  note: z.string().trim().max(600, "common.validation.tooLong").nullish(),
};
const saveInput = z.object({
  occasionId: zId,
  /** Omit to start a new design. */
  designId: zId.nullish(),
  name: z.string().trim().min(1, "common.validation.required").max(80, "common.validation.tooLong"),
  ...designFields,
});
export type SaveArrangementInput = z.input<typeof saveInput>;

async function readAccess(ctx: Ctx, occasionId: string) {
  return requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
}

async function writeAccess(ctx: Ctx, occasionId: string): Promise<string> {
  await requireMember(ctx, occasionId, { manage: true });
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN"); // an assistant proposes, it never saves
  await assertOccasionWritable(ctx, occasionId);
  const accountId = actorAccountId(ctx.actor);
  if (!accountId) throw new AppError("UNAUTHENTICATED", "common.errors.UNAUTHENTICATED");
  return accountId;
}

/** Catalogue items → lines with what the catalogue says NOW (name, published price, season). Unknown ids are refused. */
async function resolveLines(ctx: Pick<Ctx, "db" | "now">, items: Array<z.output<typeof itemInput>>): Promise<ArrangementLine[]> {
  const merged = new Map<string, z.output<typeof itemInput>>();
  for (const it of items) {
    const prev = merged.get(it.catalogueItemId);
    merged.set(it.catalogueItemId, prev ? { ...prev, stems: Math.min(ARRANGEMENT_LIMITS.maxStemsPerLine, prev.stems + it.stems) } : it);
  }
  const names = new Map<string, string>();
  const lines: ArrangementLine[] = [];
  for (const it of merged.values()) {
    const item = await getCatalogueItem(ctx, it.catalogueItemId);
    if (!item) throw new AppError("VALIDATION", "arrangements.errors.itemGone", { fieldErrors: { items: ["arrangements.errors.itemGone"] } });
    if (!names.has(item.listingId)) {
      const [l] = await ctx.db.select({ name: listings.name }).from(listings).where(eq(listings.id, item.listingId));
      names.set(item.listingId, l?.name ?? "");
    }
    const colour = it.colour && (item.colours as string[]).includes(it.colour) ? it.colour : item.colours.length === 1 ? item.colours[0]! : null;
    lines.push({
      catalogueItemId: item.id,
      stems: it.stems,
      colour,
      varietyName: item.varietyName,
      kind: item.kind,
      listingId: item.listingId,
      listingName: names.get(item.listingId) ?? "",
      pricePerStemMinor: item.pricePerStemMinor,
      currency: item.currency,
      seasonMonths: item.seasonMonths,
    });
  }
  const total = lines.reduce((n, l) => n + l.stems, 0);
  if (total > ARRANGEMENT_LIMITS.maxStems) throw new AppError("VALIDATION", "arrangements.errors.tooManyStems", { fieldErrors: { items: ["arrangements.errors.tooManyStems"] }, params: { max: ARRANGEMENT_LIMITS.maxStems } });
  return lines;
}

const shape = (v: Pick<ArrangementVersion, "form" | "note" | "lines">) => ({ form: v.form, note: v.note, lines: v.lines.map((l) => ({ catalogueItemId: l.catalogueItemId, varietyName: l.varietyName, stems: l.stems, colour: l.colour })) });

async function insertVersion(
  tx: Ctx,
  input: { occasionId: string; designId: string | null; name: string; form: ArrangementForm; lines: ArrangementLine[]; note: string | null; source: ArrangementSource; accountId: string | null },
): Promise<{ designId: string; version: number; created: boolean }> {
  let design: ArrangementDesign | undefined;
  if (input.designId) {
    [design] = await tx.db
      .select()
      .from(arrangementDesigns)
      .where(and(eq(arrangementDesigns.id, input.designId), eq(arrangementDesigns.occasionId, input.occasionId)))
      .for("update");
    if (!design || design.archivedAt) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const [latest] = await tx.db
      .select()
      .from(arrangementVersions)
      .where(and(eq(arrangementVersions.designId, design.id), eq(arrangementVersions.version, design.currentVersion)));
    if (latest && diffVersions(shape(latest), { form: input.form, note: input.note, lines: input.lines }).length === 0) {
      if (design.name !== input.name) await tx.db.update(arrangementDesigns).set({ name: input.name }).where(eq(arrangementDesigns.id, design.id));
      return { designId: design.id, version: design.currentVersion, created: false };
    }
  } else {
    const [{ n } = { n: 0 }] = await tx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(arrangementDesigns)
      .where(and(eq(arrangementDesigns.occasionId, input.occasionId), isNull(arrangementDesigns.archivedAt)));
    if (n >= MAX_DESIGNS_PER_OCCASION) throw new AppError("LIMIT", "arrangements.errors.tooManyDesigns", { params: { max: MAX_DESIGNS_PER_OCCASION } });
    [design] = await tx.db.insert(arrangementDesigns).values({ occasionId: input.occasionId, name: input.name, createdByAccountId: input.accountId }).returning();
  }
  const version = design!.currentVersion + 1;
  await tx.db.insert(arrangementVersions).values({ designId: design!.id, occasionId: input.occasionId, version, form: input.form, lines: input.lines, note: input.note, source: input.source, createdByAccountId: input.accountId });
  await tx.db.update(arrangementDesigns).set({ currentVersion: version, name: input.name }).where(eq(arrangementDesigns.id, design!.id));
  await audit(tx, { action: "arrangement.saved", objectType: "arrangement_design", objectId: design!.id, after: { version, form: input.form, stems: input.lines.reduce((s, l) => s + l.stems, 0), source: input.source } });
  return { designId: design!.id, version, created: true };
}

/** Saves a design: a new one, or a NEW VERSION of an existing one (versions never change). Managers. */
export async function saveArrangementDesign(ctx: Ctx, input: SaveArrangementInput): Promise<{ designId: string; version: number; created: boolean }> {
  const data = saveInput.parse(input);
  const accountId = await writeAccess(ctx, data.occasionId);
  const lines = await resolveLines(ctx, data.items);
  return inTx(ctx, (tx) => insertVersion(tx, { occasionId: data.occasionId, designId: data.designId ?? null, name: data.name, form: data.form, lines, note: data.note || null, source: "planner", accountId }));
}

/** Takes a design out of the list (its versions and quote links stay). Managers. */
export async function archiveArrangementDesign(ctx: Ctx, input: { designId: string }): Promise<void> {
  const [d] = await ctx.db.select().from(arrangementDesigns).where(eq(arrangementDesigns.id, zId.parse(input.designId)));
  if (!d) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await writeAccess(ctx, d.occasionId);
  if (d.archivedAt) return;
  await inTx(ctx, async (tx) => {
    await tx.db.update(arrangementDesigns).set({ archivedAt: tx.now }).where(eq(arrangementDesigns.id, d.id));
    await audit(tx, { action: "arrangement.archived", objectType: "arrangement_design", objectId: d.id });
  });
}

/* ── Reads ─────────────────────────────────────────────────────────────── */

export type ArrangementListItem = {
  id: string;
  name: string;
  version: number;
  form: ArrangementForm;
  lines: ArrangementLine[];
  /** Indicative — never a quote. */
  cost: IndicativeCost;
  source: ArrangementSource;
  updatedAt: Date;
  quoteRequests: number;
};

/** READ API: the occasion's designs (current version each), with stems and indicative cost. Planning members. */
export async function listArrangementDesigns(ctx: Ctx, occasionId: string): Promise<ArrangementListItem[]> {
  await readAccess(ctx, occasionId);
  const rows = await ctx.db
    .select({ d: arrangementDesigns, v: arrangementVersions })
    .from(arrangementDesigns)
    .innerJoin(arrangementVersions, and(eq(arrangementVersions.designId, arrangementDesigns.id), eq(arrangementVersions.version, arrangementDesigns.currentVersion)))
    .where(and(eq(arrangementDesigns.occasionId, occasionId), isNull(arrangementDesigns.archivedAt)))
    .orderBy(desc(arrangementDesigns.updatedAt));
  const ids = rows.map((r) => r.d.id);
  const reqs = ids.length ? await ctx.db.select({ designId: arrangementQuoteRequests.designId }).from(arrangementQuoteRequests).where(inArray(arrangementQuoteRequests.designId, ids)) : [];
  return rows.map(({ d, v }) => ({ id: d.id, name: d.name, version: v.version, form: v.form, lines: v.lines, cost: indicativeCost(v.lines), source: v.source, updatedAt: d.updatedAt, quoteRequests: reqs.filter((r) => r.designId === d.id).length }));
}

export type ArrangementQuoteState = {
  enquiryId: string;
  listingId: string;
  listingName: string;
  /** The design version the request carried. */
  version: number;
  sentAt: Date;
  /** The accepted quote of that thread, if any (amounts only with the finance grant). */
  link: QuoteLinkView | null;
  /** F6: set when a quote was accepted for an older version than the current one. */
  changedSinceQuote: { quotedVersion: number; currentVersion: number; changes: DesignChange[] } | null;
};

export type ArrangementDesignView = {
  id: string;
  occasionId: string;
  name: string;
  currentVersion: number;
  /** The version asked for (the current one by default). */
  version: { version: number; form: ArrangementForm; lines: ArrangementLine[]; note: string | null; source: ArrangementSource; createdAt: Date };
  cost: IndicativeCost;
  versions: Array<{ version: number; createdAt: Date; source: ArrangementSource; stems: number }>;
  quotes: ArrangementQuoteState[];
  canManage: boolean;
};

/** READ API: one design with its lines, version history and quote state (F6). Planning members. */
export async function getArrangementDesign(ctx: Ctx, designId: string, version?: number | null): Promise<ArrangementDesignView> {
  const [d] = await ctx.db.select().from(arrangementDesigns).where(eq(arrangementDesigns.id, zId.parse(designId)));
  if (!d) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const member = await readAccess(ctx, d.occasionId);
  const all = await ctx.db.select().from(arrangementVersions).where(eq(arrangementVersions.designId, d.id)).orderBy(desc(arrangementVersions.version));
  const v = all.find((x) => x.version === (version ?? d.currentVersion));
  const current = all.find((x) => x.version === d.currentVersion);
  if (!v || !current) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const reqs = await ctx.db
    .select({ r: arrangementQuoteRequests, listingName: listings.name })
    .from(arrangementQuoteRequests)
    .leftJoin(listings, eq(listings.id, arrangementQuoteRequests.listingId))
    .where(eq(arrangementQuoteRequests.designId, d.id))
    .orderBy(asc(arrangementQuoteRequests.createdAt));
  const quotes: ArrangementQuoteState[] = [];
  for (const { r, listingName } of reqs) {
    const link = await getQuoteLink(ctx, { enquiryId: r.enquiryId }).catch(() => null);
    const quotedVersion = link?.current.designRef?.designId === d.id ? link.current.designRef.version : null;
    const quoted = quotedVersion ? all.find((x) => x.version === quotedVersion) : null;
    quotes.push({
      enquiryId: r.enquiryId,
      listingId: r.listingId,
      listingName: listingName ?? "",
      version: r.version,
      sentAt: r.createdAt,
      link,
      changedSinceQuote: quoted && quoted.version !== current.version ? { quotedVersion: quoted.version, currentVersion: current.version, changes: diffVersions(shape(quoted), shape(current)) } : null,
    });
  }
  return {
    id: d.id,
    occasionId: d.occasionId,
    name: d.name,
    currentVersion: d.currentVersion,
    version: { version: v.version, form: v.form, lines: v.lines, note: v.note, source: v.source, createdAt: v.createdAt },
    cost: indicativeCost(v.lines),
    versions: all.map((x) => ({ version: x.version, createdAt: x.createdAt, source: x.source, stems: x.lines.reduce((n, l) => n + l.stems, 0) })),
    quotes,
    canManage: isManager(member) && ctx.actor.kind !== "mcp",
  };
}

/* ── Words ─────────────────────────────────────────────────────────────── */

/** "≥ 1.240 RON + 2 articole fără preț" / "1.240 RON" / "necunoscut": the indicative cost in words. */
export function indicativeCostText(cost: IndicativeCost, locale: Locale): string {
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, `arrangements.cost.${key}`, params);
  if (cost.state === "empty") return t("empty");
  if (cost.state === "none") return t("unknown", { count: cost.unpricedLines });
  const sum = cost.known.map((k) => formatMoney(k.minor, k.currency, locale)).join(" + ");
  return cost.state === "partial" ? t("atLeast", { sum, count: cost.unpricedLines }) : sum;
}

/**
 * THE description a quote request carries (F5): the form, each variety with its stem count
 * and colour, and the planner's note. No prices, no business names, no ids.
 */
export function buildQuoteDescription(v: { form: ArrangementForm; lines: ArrangementLine[]; note: string | null }, name: string, locale: Locale): string {
  const t = (key: string, params?: Record<string, string | number>) => translate(locale, `arrangements.${key}`, params);
  const rows = v.lines.map((l) => {
    const colour = l.colour ? ` (${t(`colours.${l.colour}`)})` : "";
    return `– ${l.stems} × ${l.varietyName}${colour}`;
  });
  const total = v.lines.reduce((n, l) => n + l.stems, 0);
  return [`${name} — ${t(`forms.${v.form}`)}`, ...rows, t("quote.total", { count: total }), ...(v.note ? [t("quote.note", { note: v.note })] : [])].join("\n").slice(0, 4000);
}

/* ── Quote request (F5) ────────────────────────────────────────────────── */

const quoteInput = z.object({
  designId: zId,
  listingId: zId,
  message: z.string().trim().max(4000, "common.validation.tooLong").default(""),
  shareEmail: z.boolean().optional(),
  idempotencyKey: z.string().min(8).max(100),
});

/**
 * "Cere ofertă": sends the CURRENT version of the design to one florist or styling business
 * through the enquiry flow (same limits, same consent for the email). Managers only.
 */
export async function requestArrangementQuote(ctx: Ctx, input: z.input<typeof quoteInput>): Promise<{ enquiryId: string; version: number }> {
  const data = quoteInput.parse(input);
  const [d] = await ctx.db.select().from(arrangementDesigns).where(eq(arrangementDesigns.id, data.designId));
  if (!d || d.archivedAt) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await writeAccess(ctx, d.occasionId);
  const [v] = await ctx.db
    .select()
    .from(arrangementVersions)
    .where(and(eq(arrangementVersions.designId, d.id), eq(arrangementVersions.version, d.currentVersion)));
  if (!v) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, d.occasionId));
  const summary = await getRsvpSummary(ctx, d.occasionId);
  const guests = summary.attending.total > 0 ? summary.attending.total : summary.invited && summary.invited > 0 ? summary.invited : null;
  const sent = await sendQuoteRequest(ctx, {
    occasionId: d.occasionId,
    listingId: data.listingId,
    arrangement: { description: buildQuoteDescription(v, d.name, o?.locale === "en" ? "en" : "ro"), designRef: { designId: d.id, version: v.version } },
    date: o?.startsAt ? instantToDay(o.startsAt, o.timezone) : null,
    guests,
    message: data.message,
    shareEmail: data.shareEmail === true,
    idempotencyKey: data.idempotencyKey,
  });
  await ctx.db.insert(arrangementQuoteRequests).values({ occasionId: d.occasionId, designId: d.id, version: v.version, enquiryId: sent.enquiryId, listingId: data.listingId }).onConflictDoNothing();
  return { enquiryId: sent.enquiryId, version: v.version };
}

/* ── What-if "arrangement.applyDesign" (MCP propose_arrangement_design) ─ */

const proposeInput = z.object({
  /** An existing design to add a version to; omit for a new design. */
  designId: zId.nullish(),
  name: z.string().trim().min(1).max(80).default("Aranjament"),
  ...designFields,
});
export type ProposeArrangementInput = z.input<typeof proposeInput>;

const tx_ = (key: string, params?: Record<string, string | number>) => ({ key, params });

async function authorizeDesign(ctx: Ctx, occasionId: string | null, action: "create" | "read" | "confirm" | "discard"): Promise<void> {
  if (!occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  // proposing needs the same standing as writing: a guest-role member, a supplier or a read-only token cannot
  if (action === "read") await readAccess(ctx, occasionId);
  else await requireMember(ctx, occasionId, { manage: true });
}

registerWhatIf<z.output<typeof proposeInput>>(ARRANGEMENT_KIND, {
  input: proposeInput,
  authorize: (ctx, subject, action) => authorizeDesign(ctx, subject.occasionId, action),
  compute: async (ctx, input, subject) => {
    const occasionId = subject.occasionId!;
    const lines = await resolveLines(ctx, input.items);
    let before: ArrangementVersion | undefined;
    if (input.designId) {
      const [d] = await ctx.db
        .select()
        .from(arrangementDesigns)
        .where(and(eq(arrangementDesigns.id, input.designId), eq(arrangementDesigns.occasionId, occasionId)));
      if (!d || d.archivedAt) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
      [before] = await ctx.db
        .select()
        .from(arrangementVersions)
        .where(and(eq(arrangementVersions.designId, d.id), eq(arrangementVersions.version, d.currentVersion)));
    }
    const stems = (ls: ArrangementLine[]) => ls.reduce((n, l) => n + l.stems, 0);
    const delta: WhatIfDeltaRow[] = [
      { key: "form", what: tx_("arrangements.whatif.form"), before: before ? tx_(`arrangements.forms.${before.form}`) : undefined, after: tx_(`arrangements.forms.${input.form}`) },
      ...lines.map(
        (l): WhatIfDeltaRow => ({
          key: `item:${l.catalogueItemId}`,
          what: l.varietyName,
          before: before ? String(before.lines.find((x) => x.catalogueItemId === l.catalogueItemId)?.stems ?? 0) : undefined,
          after: tx_("arrangements.whatif.stems", { count: l.stems }),
        }),
      ),
      ...(before?.lines ?? [])
        .filter((x) => !lines.some((l) => l.catalogueItemId === x.catalogueItemId))
        .map((x): WhatIfDeltaRow => ({ key: `item:${x.catalogueItemId}`, what: x.varietyName, before: String(x.stems), after: tx_("arrangements.whatif.removed") })),
      { key: "stems", what: tx_("arrangements.whatif.total"), before: before ? String(stems(before.lines)) : undefined, after: String(stems(lines)) },
      {
        key: "cost",
        what: tx_("arrangements.whatif.cost"),
        before: before ? indicativeCostText(indicativeCost(before.lines), ctx.locale) : undefined,
        after: indicativeCostText(indicativeCost(lines), ctx.locale),
        noteKey: "arrangements.whatif.costNote", // "cost orientativ — nu este o ofertă"
      },
      ...(input.note ? [{ key: "note", what: tx_("arrangements.whatif.note"), before: before?.note ?? undefined, after: input.note } satisfies WhatIfDeltaRow] : []),
    ];
    return { title: tx_(input.designId ? "arrangements.whatif.titleUpdate" : "arrangements.whatif.titleNew", { name: input.name }), delta };
  },
  apply: async (tx, preview) => {
    const occasionId = preview.occasionId!;
    await assertOccasionWritable(tx, occasionId);
    const input = preview.input;
    const lines = await resolveLines(tx, input.items);
    await insertVersion(tx, {
      occasionId,
      designId: input.designId ?? null,
      name: input.name,
      form: input.form,
      lines,
      note: input.note || null,
      source: preview.proposedByKind === "mcp" ? "assistant" : "planner",
      accountId: actorAccountId(tx.actor) ?? null,
    });
  },
});

/** Proposes a design as a What-if preview (nothing is saved until a person confirms it in the app). */
export async function proposeArrangementDesign(ctx: Ctx, input: ProposeArrangementInput & { occasionId: string; source?: string }): Promise<{ preview: WhatIfPreview; cost: IndicativeCost; stems: number }> {
  const { occasionId, source, ...rest } = input;
  const data = proposeInput.parse(rest);
  const preview = await createPreview(ctx, { kind: ARRANGEMENT_KIND, occasionId, subjectType: "occasion", subjectId: occasionId, input: data, source });
  const lines = await resolveLines(ctx, data.items);
  return { preview, cost: indicativeCost(lines), stems: lines.reduce((n, l) => n + l.stems, 0) };
}

onOccasionPurge(async (tx, occasionId) => {
  // versions and quote-request links cascade from the designs
  await tx.db.delete(arrangementDesigns).where(eq(arrangementDesigns.occasionId, occasionId));
});
