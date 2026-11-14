import { createHash } from "node:crypto";
import {
  and,
  businesses,
  categories,
  counties,
  directoryLinkPrefs,
  eq,
  inArray,
  listingCategories,
  listingLocalities,
  listings,
  localities,
  occasions,
  sql,
  type OccasionKind,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { addDays, bucharestDateKey } from "@ed/shared/time";
import { zId } from "@ed/shared/zod";
import { getAssetUrl } from "@ed/storage";
import { z } from "zod";
import { requireMember } from "./access";
import { getBusinessBadges, registerJobs as registerBusinessJobs, type Badge } from "./business";
import { requireAccount, type Ctx } from "./context";
import {
  DIRECTORY_ADMIN_ROLES,
  getCategoryBySlug,
  listCategories,
  listCounties,
  localName,
  type CategoryView,
  type CountyView,
} from "./geography";
import { registerJobs as registerListingJobs } from "./listings";
import { getPublishedListingStats, registerJobs as registerListingStatsJobs, type PublishedListingStats } from "./listingstats";
import { requireStaffRole } from "./staff";
import { readDailyStats, recordEvent } from "./stats";

// The Honest Directory (P5, P6, P7, P29, D3, D4, MON5).
//
//   getDirectoryResults(ctx, { categoryId, countyCode, localityId?, day? })
//       → { featured: [], organic: [...] }   THE one source for the web pages and for the
//         MCP `search_directory` tool (D3): both show exactly this, in exactly this order.
//   organicOrder(listingIds, day, searchKey)  the daily rotation. See the invariant below.
//   getPublicListing(ctx, id)                 one listing page.
//   suggestDirectoryLink(ctx, …)              P7: the dismissible task link (names no business).
//
// Everything here is a pure read except recordDirectorySearch / recordListingView and the
// link preferences, so read-only callers (MCP read tools) can use the queries as they are.

/* ── Organic order (P5, invariant 7) ───────────────────────────────────── */

/**
 * REVIEWED INVARIANT — "paid means position, never preference" (PRD principle 7, P5).
 *
 * The organic order is a deterministic daily rotation:
 *
 *     rank(listing) = sha256( day + "|" + listingId + "|" + searchKey )      (hex, ascending)
 *
 * where `day` is the UTC calendar day ("YYYY-MM-DD") and `searchKey` is
 * `<categoryId>|<countyCode>`. It is the same for every visitor on that day and different
 * the next day. The function's ONLY inputs are listing ids, the day and the search key: it
 * receives no listing or business row, so no plan, payment, subscription, badge, statistic
 * or age can take part — by construction, not by convention. Do not add a parameter here
 * without a new review of this invariant (test: packages/core/test/directory.test.ts).
 */
export function organicOrder(listingIds: readonly string[], day: string, searchKey: string): string[] {
  return listingIds
    .map((id) => ({ id, rank: createHash("sha256").update(`${day}|${id}|${searchKey}`).digest("hex") }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : 1))
    .map((x) => x.id);
}

/** The UTC day used for the rotation. */
export function rotationDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function directorySearchKey(categoryId: string, countyCode: string): string {
  return `${categoryId}|${countyCode}`;
}

/* ── Cards and results ─────────────────────────────────────────────────── */

export type DirectoryCard = {
  id: string;
  name: string;
  /** false = added by EventDesk from a public source and not claimed yet (P29). */
  claimed: boolean;
  /** Description in the request language; `romanianOnly` when English was asked and is missing (L4). */
  excerpt: string | null;
  romanianOnly: boolean;
  categories: Array<{ id: string; slug: string; name: string }>;
  counties: Array<{ code: string; name: string }>;
  localities: Array<{ id: string; countyCode: string; name: string }>;
  /** P4: at most the two factual badges. Always empty for unclaimed listings. */
  badges: Badge[];
  /** P31: null unless publishable. */
  stats: PublishedListingStats | null;
};

/**
 * RELEASE P (P13, P14): a Featured card. It exists ONLY in `DirectoryResults.featured`, and
 * always carries its honest label — `featured: true` + the i18n key of
 * "Promovat — plasare plătită" — so no caller can show it unlabelled.
 */
export type FeaturedCard = DirectoryCard & { featured: true; labelKey: "featured.label" };
export const FEATURED_LABEL_KEY = "featured.label" as const;
export const MAX_FEATURED = 3;

/**
 * RELEASE P (P13): where Featured comes from. @ed/core/featured registers the provider; with
 * none registered — and whenever the provider says so, i.e. always while monetization is OFF
 * (MON5) — `featured` is []. The provider returns listing ids ONLY and is called AFTER the
 * organic order is fixed: it cannot see, reorder or filter `organic` (invariant 7).
 */
export type FeaturedProvider = (ctx: Ctx, search: { categoryId: string; countyCode: string; localityId?: string }) => Promise<string[]>;
const featuredRegistry = globalThis as unknown as { __edFeaturedProvider?: FeaturedProvider };
export function setFeaturedProvider(fn: FeaturedProvider | null): void {
  featuredRegistry.__edFeaturedProvider = fn ?? undefined;
}

export type DirectoryResults = {
  /**
   * ALWAYS EMPTY while monetization is off (MON5): Featured placement does not exist. When it
   * is on: up to three labelled cards, random per request (P13) — see setFeaturedProvider.
   */
  featured: FeaturedCard[];
  organic: DirectoryCard[];
  /** Number of organic results before paging. */
  total: number;
  /** The rotation day used. */
  day: string;
};

function excerptOf(text: string | null, max = 180): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat || null;
  const cut = flat.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30))}…`;
}

/** Public visibility: live, and its business (if any) not suspended. */
const publiclyVisible = sql`${listings.status} = 'live' and (${listings.businessId} is null or exists (select 1 from businesses b where b.id = ${listings.businessId} and b.status <> 'suspended'))`;

async function loadCards(ctx: Ctx, ids: string[]): Promise<DirectoryCard[]> {
  if (ids.length === 0) return [];
  const rows = await ctx.db
    .select({ listing: listings, business: businesses })
    .from(listings)
    .leftJoin(businesses, eq(businesses.id, listings.businessId))
    .where(inArray(listings.id, ids));
  const cats = await ctx.db
    .select({ listingId: listingCategories.listingId, c: categories })
    .from(listingCategories)
    .innerJoin(categories, eq(categories.id, listingCategories.categoryId))
    .where(inArray(listingCategories.listingId, ids));
  const locs = await ctx.db
    .select({ listingId: listingLocalities.listingId, l: localities, county: counties })
    .from(listingLocalities)
    .innerJoin(localities, eq(localities.id, listingLocalities.localityId))
    .innerJoin(counties, eq(counties.code, listingLocalities.countyCode))
    .where(inArray(listingLocalities.listingId, ids));
  const byId = new Map(rows.map((r) => [r.listing.id, r]));
  const out: DirectoryCard[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) continue;
    const { listing, business } = r;
    const wantsEn = ctx.locale === "en";
    const text = wantsEn && listing.descriptionEn ? listing.descriptionEn : listing.descriptionRo;
    const myLocs = locs.filter((x) => x.listingId === id);
    const countyMap = new Map(myLocs.map((x) => [x.county.code, { code: x.county.code, name: localName(x.county, ctx.locale), order: x.county.sortOrder }]));
    out.push({
      id,
      name: listing.name,
      claimed: listing.claimed,
      excerpt: excerptOf(text),
      romanianOnly: wantsEn && !listing.descriptionEn && !!listing.descriptionRo,
      categories: cats
        .filter((x) => x.listingId === id)
        .sort((a, b) => a.c.sortOrder - b.c.sortOrder)
        .map((x) => ({ id: x.c.id, slug: x.c.slug, name: localName(x.c, ctx.locale) })),
      counties: [...countyMap.values()].sort((a, b) => a.order - b.order).map(({ code, name }) => ({ code, name })),
      localities: myLocs
        .sort((a, b) => a.l.sortOrder - b.l.sortOrder)
        .map((x) => ({ id: x.l.id, countyCode: x.l.countyCode, name: localName(x.l, ctx.locale) })),
      badges: listing.claimed && business ? getBusinessBadges(business, ctx.now) : [],
      stats: listing.claimed ? await getPublishedListingStats(ctx, id) : null,
    });
  }
  return out;
}

const resultsInput = z.object({
  categoryId: zId,
  countyCode: z.string().min(1).max(3),
  localityId: zId.optional(),
  /** UTC day "YYYY-MM-DD"; default today. */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(200).default(60),
  offset: z.number().int().min(0).default(0),
});

/**
 * Directory search (P5, P6). Public. Returns organic results in the daily rotation; a
 * locality search is the county search filtered, in the same order. `featured` is always
 * empty until P13 is implemented behind the monetization switch (MON5).
 */
export async function getDirectoryResults(ctx: Ctx, input: z.input<typeof resultsInput>): Promise<DirectoryResults> {
  const q = resultsInput.parse(input);
  const day = q.day ?? rotationDay(ctx.now);
  const matches = await ctx.db
    .selectDistinct({ id: listings.id })
    .from(listings)
    .innerJoin(listingCategories, and(eq(listingCategories.listingId, listings.id), eq(listingCategories.categoryId, q.categoryId)))
    .innerJoin(
      listingLocalities,
      and(
        eq(listingLocalities.listingId, listings.id),
        eq(listingLocalities.countyCode, q.countyCode),
        q.localityId ? eq(listingLocalities.localityId, q.localityId) : undefined,
      ),
    )
    .where(publiclyVisible);
  // The ONLY ordering step: ids + day + search key in, ids out (invariant 7).
  const ordered = organicOrder(
    matches.map((m) => m.id),
    day,
    directorySearchKey(q.categoryId, q.countyCode),
  );
  const organic = await loadCards(ctx, ordered.slice(q.offset, q.offset + q.limit));
  // RELEASE P (P13): Featured is fetched separately and placed BESIDE the organic list — the
  // lines above are untouched and `organic` is the same with or without it (test: featured.test.ts).
  const provider = featuredRegistry.__edFeaturedProvider;
  const featuredIds = provider ? (await provider(ctx, { categoryId: q.categoryId, countyCode: q.countyCode, localityId: q.localityId })).slice(0, MAX_FEATURED) : [];
  const featured: FeaturedCard[] = (await loadCards(ctx, featuredIds)).map((card) => ({ ...card, featured: true, labelKey: FEATURED_LABEL_KEY }));
  return { featured, organic, total: ordered.length, day };
}

/** D4 / INF11: counts one search in today's aggregate — category and county only, nothing about who searched. */
export async function recordDirectorySearch(ctx: Ctx, input: { categorySlug: string; countyCode: string }): Promise<void> {
  await recordEvent(ctx, "directory.search", { category: input.categorySlug, county: input.countyCode });
}

/** D4 / INF11: counts one listing page view in today's aggregate. */
export async function recordListingView(ctx: Ctx, listingId: string): Promise<void> {
  await recordEvent(ctx, "listing.view", { listing: listingId });
}

/* ── Listing page ──────────────────────────────────────────────────────── */

export type PublicListing = DirectoryCard & {
  description: string | null;
  /** Claimed listings only. */
  contact: { phone: string | null; email: string | null; website: string | null } | null;
  /** Unclaimed listings only (P29): the route exactly as the public source states it, and that source. */
  unclaimed: { publicContactRoute: string | null; sourceUrl: string | null; collectedAt: Date | null } | null;
  /** Short-lived signed image links, generated on the server. Never stored. */
  photos: Array<{ assetId: string; url: string }>;
  /** P29: only a claimed listing can receive enquiries (the later <EnquiryCta> checks this). */
  acceptsEnquiries: boolean;
  /** The language the listing was written in (L4): Romanian, with English when provided. */
  hasEnglish: boolean;
};

/** One public listing page, or null when it is not public (draft, pending, suspended, retired, unknown). */
export async function getPublicListing(ctx: Ctx, listingId: string): Promise<PublicListing | null> {
  if (!zId.safeParse(listingId).success) return null;
  const [row] = await ctx.db.select().from(listings).where(and(eq(listings.id, listingId), publiclyVisible));
  if (!row) return null;
  const [card] = await loadCards(ctx, [row.id]);
  if (!card) return null;
  const photos: PublicListing["photos"] = [];
  if (row.claimed) {
    for (const assetId of row.photoAssetIds) {
      try {
        photos.push({ assetId, url: await getAssetUrl(ctx, assetId, { ttlSeconds: 3600 }) });
      } catch (e) {
        if (!(e instanceof AppError)) throw e; // a removed photo simply does not show
      }
    }
  }
  const wantsEn = ctx.locale === "en";
  return {
    ...card,
    description: (wantsEn && row.descriptionEn ? row.descriptionEn : row.descriptionRo) || null,
    contact: row.claimed ? { phone: row.contactPhone, email: row.contactEmail, website: row.website } : null,
    unclaimed: row.claimed ? null : { publicContactRoute: row.publicContactRoute, sourceUrl: row.sourceUrl, collectedAt: row.collectedAt },
    photos,
    acceptsEnquiries: row.claimed,
    hasEnglish: !!row.descriptionEn,
  };
}

/* ── Index and counts ──────────────────────────────────────────────────── */

export type DirectoryIndex = {
  categories: CategoryView[];
  launchCounties: CountyView[];
  otherCounties: CountyView[];
};

/** Published categories and counties for the directory index and the search form. */
export async function getDirectoryIndex(ctx: Ctx): Promise<DirectoryIndex> {
  const [cats, cos] = await Promise.all([listCategories(ctx), listCounties(ctx)]);
  const published = cos.filter((c) => c.published);
  return {
    categories: cats.filter((c) => c.published),
    launchCounties: published.filter((c) => c.launchArea),
    otherCounties: published.filter((c) => !c.launchArea),
  };
}

/** Live public listings per category in one county (for "what exists here" lines). Counts only. */
export async function countListingsByCategory(ctx: Ctx, countyCode: string): Promise<Map<string, number>> {
  const rows = await ctx.db
    .select({ categoryId: listingCategories.categoryId, n: sql<number>`count(distinct ${listings.id})::int` })
    .from(listings)
    .innerJoin(listingCategories, eq(listingCategories.listingId, listings.id))
    .innerJoin(listingLocalities, and(eq(listingLocalities.listingId, listings.id), eq(listingLocalities.countyCode, countyCode)))
    .where(publiclyVisible)
    .groupBy(listingCategories.categoryId);
  return new Map(rows.map((r) => [r.categoryId, Number(r.n)]));
}

/* ── Pre-fill from an occasion (P6) and the task link (P7) ─────────────── */

const KIND_CATEGORIES: Record<OccasionKind, string[]> = {
  nunta: ["sali-de-evenimente", "fotografi", "videografi", "trupe", "dj", "floristi", "torturi-si-cofetarie", "coafura-si-make-up", "invitatii-si-tipografie", "masini-de-nunta"],
  botez: ["sali-de-evenimente", "fotografi", "torturi-si-cofetarie", "floristi", "animatori", "invitatii-si-tipografie"],
  aniversare: ["sali-de-evenimente", "catering", "torturi-si-cofetarie", "animatori", "dj", "decoratiuni-si-styling"],
  revelion: ["sali-de-evenimente", "catering", "dj", "trupe", "baruri-mobile", "sonorizare-av-si-lumini"],
  picnic: ["catering", "inchiriere-echipamente-de-petrecere", "inchiriere-corturi"],
  voiaj_solo: ["cazare"],
  voiaj_grup: ["cazare", "transport-autocare-si-microbuze"],
  blank: [],
};

/** Template task key → category slug. Travel kinds are left out: their tasks mean other things. */
const TASK_KEY_CATEGORY: Record<string, string> = {
  locatie: "sali-de-evenimente",
  restaurant: "sali-de-evenimente",
  "foto-video": "fotografi",
  fotograf: "fotografi",
  muzica: "trupe",
  "flori-decor": "floristi",
  tort: "torturi-si-cofetarie",
  "tort-marturii": "torturi-si-cofetarie",
  "invitatii-model": "invitatii-si-tipografie",
  "coafura-machiaj": "coafura-si-make-up",
  meniu: "catering",
  masini: "masini-de-nunta",
};

const TITLE_CATEGORY: Array<[RegExp, string]> = [
  [/fotograf/, "fotografi"],
  [/videograf|filmare/, "videografi"],
  [/\bdj\b/, "dj"],
  [/formati|trupa|lautar|\bband\b/, "trupe"],
  [/florar|florist|flori/, "floristi"],
  [/tort|cofetar|candy/, "torturi-si-cofetarie"],
  [/catering/, "catering"],
  [/\bcort/, "inchiriere-corturi"],
  [/\bsala\b|\bsali\b|locati|restaurant|venue/, "sali-de-evenimente"],
  [/coafur|machiaj|make-up/, "coafura-si-make-up"],
  [/autocar|microbuz/, "transport-autocare-si-microbuze"],
  [/cazare|hotel/, "cazare"],
  [/animator/, "animatori"],
  [/sonoriz|lumini/, "sonorizare-av-si-lumini"],
  [/decor/, "decoratiuni-si-styling"],
  [/barman|cocktail|\bbar\b/, "baruri-mobile"],
  [/limuzin|masina de nunta/, "masini-de-nunta"],
  [/securitate|paza\b/, "securitate-si-personal-de-evenimente"],
  [/tipograf|tipar/, "invitatii-si-tipografie"],
];

function fold(text: string): string {
  return text
    .replace(/[șş]/gi, "s")
    .replace(/[țţ]/gi, "t")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Finds the county (and locality) a free-text venue line names, by looking for seeded
 * locality and county names in it. Deterministic; returns null when nothing matches — the
 * area then simply stays unchosen (never guessed).
 */
export async function guessAreaFromText(ctx: Ctx, text: string | null | undefined): Promise<{ countyCode: string; localityId: string | null } | null> {
  const hay = ` ${fold(text ?? "").replace(/[^a-z0-9]+/g, " ")} `;
  if (hay.trim().length < 3) return null;
  const has = (name: string) => hay.includes(` ${fold(name).replace(/[^a-z0-9]+/g, " ")} `);
  const locs = await ctx.db.select().from(localities).where(eq(localities.active, true));
  const cos = await ctx.db.select().from(counties).where(eq(counties.active, true));
  const named = cos.filter((c) => has(c.nameRo) || has(c.nameEn));
  const hits = locs.filter((l) => has(l.nameRo)).sort((a, b) => b.nameRo.length - a.nameRo.length);
  // a locality name that exists in several counties is only trusted together with its county
  const best = hits.find((l) => named.some((c) => c.code === l.countyCode)) ?? hits.find((l) => hits.filter((o) => fold(o.nameRo) === fold(l.nameRo)).length === 1);
  if (best) return { countyCode: best.countyCode, localityId: best.id };
  return named[0] ? { countyCode: named[0].code, localityId: null } : null;
}

export type DirectoryPrefill = {
  occasionId: string;
  occasionTitle: string;
  /** Categories that usually matter for this kind of occasion, in order. Suggestions only. */
  suggestedCategorySlugs: string[];
  countyCode: string | null;
  localityId: string | null;
};

/** P6: what "Găsește firme" starts from when opened from an occasion. Members only. */
export async function getDirectoryPrefill(ctx: Ctx, occasionId: string): Promise<DirectoryPrefill> {
  await requireMember(ctx, occasionId);
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, occasionId));
  if (!o) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const area = await guessAreaFromText(ctx, [o.venueAddress, o.venueName].filter(Boolean).join(" "));
  return {
    occasionId: o.id,
    occasionTitle: o.title,
    suggestedCategorySlugs: KIND_CATEGORIES[o.kind] ?? [],
    countyCode: area?.countyCode ?? null,
    localityId: area?.localityId ?? null,
  };
}

export type DirectoryLinkSuggestion = {
  categorySlug: string;
  countyCode: string | null;
  /** Where the link goes. */
  href: string;
  /** "directory.taskLink.label" (category + area) or "directory.taskLink.labelNoArea". */
  labelKey: string;
  params: { category: string; area: string };
};

async function linkSwitchedOff(ctx: Ctx, accountId: string, occasionId: string): Promise<boolean> {
  const rows = await ctx.db
    .select({ id: directoryLinkPrefs.id })
    .from(directoryLinkPrefs)
    .where(
      sql`(${directoryLinkPrefs.scope} = 'account' and ${directoryLinkPrefs.subjectId} = ${accountId}) or (${directoryLinkPrefs.scope} = 'occasion' and ${directoryLinkPrefs.subjectId} = ${occasionId})`,
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * P7: the one dismissible link for a task — "Vezi firme de <categorie> în <zona>". It points
 * at a directory search and NAMES NO BUSINESS. Null when the task has no obvious category,
 * when the link is switched off for the account or the occasion, or for a non-account actor.
 */
export async function suggestDirectoryLink(
  ctx: Ctx,
  input: { occasionId: string; taskTitle?: string | null; templateTaskKey?: string | null },
): Promise<DirectoryLinkSuggestion | null> {
  const accountId = requireAccount(ctx);
  await requireMember(ctx, input.occasionId);
  const [o] = await ctx.db.select().from(occasions).where(eq(occasions.id, input.occasionId));
  if (!o) return null;
  const travel = o.kind === "voiaj_solo" || o.kind === "voiaj_grup";
  let slug = !travel && input.templateTaskKey ? TASK_KEY_CATEGORY[input.templateTaskKey] : undefined;
  if (!slug && input.taskTitle) {
    const title = fold(input.taskTitle);
    slug = TITLE_CATEGORY.find(([re]) => re.test(title))?.[1];
  }
  if (!slug) return null;
  if (await linkSwitchedOff(ctx, accountId, o.id)) return null;
  const category = await getCategoryBySlug(ctx, slug);
  if (!category || !category.active || !category.published) return null;
  const area = await guessAreaFromText(ctx, [o.venueAddress, o.venueName].filter(Boolean).join(" "));
  const [county] = area ? await ctx.db.select().from(counties).where(eq(counties.code, area.countyCode)) : [];
  const usable = county && county.active && county.published ? county : null;
  return {
    categorySlug: category.slug,
    countyCode: usable?.code ?? null,
    href: usable ? `/directory/${category.slug}/${usable.slug}?occasion=${o.id}` : `/directory?occasion=${o.id}&category=${category.slug}`,
    labelKey: usable ? "directory.taskLink.label" : "directory.taskLink.labelNoArea",
    params: { category: category.name.toLocaleLowerCase(ctx.locale === "en" ? "en" : "ro"), area: usable ? localName(usable, ctx.locale) : "" },
  };
}

const linkScope = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("account") }),
  z.object({ scope: z.literal("occasion"), occasionId: zId }),
]);

/** P7: switches the task link off — for this account everywhere, or for one occasion (managers). */
export async function dismissDirectoryLink(ctx: Ctx, input: z.input<typeof linkScope>): Promise<void> {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const data = linkScope.parse(input);
  if (data.scope === "occasion") await requireMember(ctx, data.occasionId, { manage: true });
  await ctx.db
    .insert(directoryLinkPrefs)
    .values({ scope: data.scope, subjectId: data.scope === "account" ? accountId : data.occasionId, setByAccountId: accountId, dismissedAt: ctx.now })
    .onConflictDoNothing({ target: [directoryLinkPrefs.scope, directoryLinkPrefs.subjectId] });
}

/** P7: switches the task link back on. */
export async function restoreDirectoryLink(ctx: Ctx, input: z.input<typeof linkScope>): Promise<void> {
  const accountId = requireAccount(ctx);
  if (ctx.actor.kind !== "account") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const data = linkScope.parse(input);
  if (data.scope === "occasion") await requireMember(ctx, data.occasionId, { manage: true });
  await ctx.db
    .delete(directoryLinkPrefs)
    .where(and(eq(directoryLinkPrefs.scope, data.scope), eq(directoryLinkPrefs.subjectId, data.scope === "account" ? accountId : data.occasionId)));
}

export async function getDirectoryLinkPrefs(ctx: Ctx, occasionId?: string): Promise<{ accountOff: boolean; occasionOff: boolean }> {
  const accountId = requireAccount(ctx);
  const rows = await ctx.db
    .select({ scope: directoryLinkPrefs.scope, subjectId: directoryLinkPrefs.subjectId })
    .from(directoryLinkPrefs)
    .where(inArray(directoryLinkPrefs.subjectId, occasionId ? [accountId, occasionId] : [accountId]));
  return {
    accountOff: rows.some((r) => r.scope === "account" && r.subjectId === accountId),
    occasionOff: !!occasionId && rows.some((r) => r.scope === "occasion" && r.subjectId === occasionId),
  };
}

/* ── Console statistics (W4, D4) ───────────────────────────────────────── */

export type DirectoryStats = {
  from: string;
  to: string;
  days: string[];
  /** One row per category × county that had a search in the period or has a live listing. */
  rows: Array<{
    categorySlug: string;
    categoryName: string;
    countyCode: string;
    countyName: string;
    liveListings: number;
    searches: number;
    searchesByDay: Record<string, number>;
  }>;
  totalSearches: number;
};

/**
 * W4: searches per category × county per day and live listings per pair — daily totals from
 * stats_daily, which holds no visitor identifier (D4, INF11).
 */
export async function getDirectoryStats(ctx: Ctx, input: { days?: number } = {}): Promise<DirectoryStats> {
  requireStaffRole(ctx, ...DIRECTORY_ADMIN_ROLES);
  const span = Math.min(Math.max(input.days ?? 14, 1), 90);
  const to = bucharestDateKey(ctx.now);
  const from = bucharestDateKey(addDays(ctx.now, -(span - 1)));
  const days: string[] = [];
  for (let i = span - 1; i >= 0; i--) days.push(bucharestDateKey(addDays(ctx.now, -i)));
  const stats = await readDailyStats(ctx, { metric: "directory.search", from, to });
  const cats = await ctx.db.select().from(categories);
  const cos = await ctx.db.select().from(counties);
  const live = await ctx.db
    .select({ categoryId: listingCategories.categoryId, countyCode: listingLocalities.countyCode, n: sql<number>`count(distinct ${listings.id})::int` })
    .from(listings)
    .innerJoin(listingCategories, eq(listingCategories.listingId, listings.id))
    .innerJoin(listingLocalities, eq(listingLocalities.listingId, listings.id))
    .where(eq(listings.status, "live"))
    .groupBy(listingCategories.categoryId, listingLocalities.countyCode);
  const rows = new Map<string, DirectoryStats["rows"][number]>();
  const rowFor = (categorySlug: string, countyCode: string) => {
    const key = `${categorySlug}|${countyCode}`;
    let row = rows.get(key);
    if (!row) {
      const c = cats.find((x) => x.slug === categorySlug);
      const co = cos.find((x) => x.code === countyCode);
      row = {
        categorySlug,
        categoryName: c ? localName(c, ctx.locale) : categorySlug,
        countyCode,
        countyName: co ? localName(co, ctx.locale) : countyCode,
        liveListings: 0,
        searches: 0,
        searchesByDay: {},
      };
      rows.set(key, row);
    }
    return row;
  };
  for (const l of live) {
    const c = cats.find((x) => x.id === l.categoryId);
    if (c) rowFor(c.slug, l.countyCode).liveListings = Number(l.n);
  }
  let totalSearches = 0;
  for (const s of stats) {
    const { category, county } = s.dimensions;
    if (!category || !county) continue;
    const row = rowFor(category, county);
    row.searches += s.value;
    row.searchesByDay[s.day] = (row.searchesByDay[s.day] ?? 0) + s.value;
    totalSearches += s.value;
  }
  return {
    from,
    to,
    days,
    rows: [...rows.values()].sort((a, b) => b.searches - a.searches || b.liveListings - a.liveListings || a.categoryName.localeCompare(b.categoryName, "ro")),
    totalSearches,
  };
}

/** Called by @ed/jobs/registry in the worker: registers every Release P directory rule and job. */
export function registerJobs(): void {
  registerBusinessJobs();
  registerListingJobs();
  registerListingStatsJobs();
}
