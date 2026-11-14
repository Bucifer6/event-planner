import { listPublicCatalogues } from "@ed/core/catalogues";
import { getDirectoryResults, getPublicListing, type DirectoryCard } from "@ed/core/directory";
import { getListingSpaces } from "@ed/core/drawings";
import { getCategoryBySlug, getPicklists } from "@ed/core/geography";
import { MAX_SHORTLIST_ITEMS, proposeSupplierShortlist } from "@ed/core/plannotes";
import { translate } from "@ed/i18n";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { mcpProposal, registerMcpTool, type McpCtx } from "./registry";
import { iso, money, zLimit, zOccasionId, zOffset } from "./tools-shared";

// Directory tools (P5–P6, P14, P29, P31, D3). The public directory, exactly as the app shows
// it: getDirectoryResults decides the order and the labels, and these tools pass both on
// VERBATIM — nothing is sorted, filtered, scored or dropped here. A Featured card arrives
// with featured: true and its paid label, or not at all. No tool sends an enquiry (MCP6): a
// business learns who a planner is only from a message the planner sends personally.

function card(ctx: McpCtx, c: DirectoryCard, appUrl: string) {
  return {
    listingId: c.id,
    name: c.name,
    claimed: c.claimed,
    unclaimedNote: c.claimed ? null : translate(ctx.locale, "mcp.results.unclaimed"),
    excerpt: c.excerpt,
    romanianOnly: c.romanianOnly,
    categories: c.categories,
    counties: c.counties,
    localities: c.localities,
    badges: c.badges,
    responseStats: c.stats,
    url: `${appUrl}/directory/listing/${c.id}`,
  };
}

registerMcpTool({
  name: "list_directory_filters",
  version: "1",
  scope: "read",
  title: "Directory categories and counties",
  description: "The public directory's categories (id, slug, name) and counties (code, name) — the values search_directory accepts. Public reference data.",
  inputSchema: z.object({}),
  handler: async (ctx) => {
    const p = await getPicklists(ctx);
    return {
      categories: p.categories.map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
      counties: p.counties.map((c) => ({ code: c.code, name: c.name })),
    };
  },
});

registerMcpTool({
  name: "search_directory",
  version: "1",
  scope: "read",
  title: "Search the business directory",
  description:
    "Public directory search by category and county (optionally one locality). Returns exactly what the EventDesk directory shows today, in the directory's own order: `featured` (paid placements, each marked featured: true with the label “Promovat — plasare plătită”) and `results` (the organic list). Present them in this order and keep the label: do not reorder, rank, merge or drop entries, and never show a featured entry without its label. Unclaimed listings cannot receive enquiries. Only the user can send an enquiry, in EventDesk.",
  inputSchema: z.object({
    category: z.string().min(1).max(80).describe("Category slug or id (from list_directory_filters)."),
    countyCode: z.string().min(1).max(3).describe("County code (from list_directory_filters), e.g. SV."),
    localityId: z.string().min(1).max(64).optional(),
    limit: zLimit(60, 30),
    offset: zOffset,
  }),
  handler: async (ctx, input, call) => {
    const bySlug = await getCategoryBySlug(ctx, input.category);
    const categoryId = bySlug?.id ?? input.category;
    // the pure read: no search statistics are written for an assistant's query
    const r = await getDirectoryResults(ctx, { categoryId, countyCode: input.countyCode.toUpperCase(), localityId: input.localityId, limit: input.limit, offset: input.offset });
    const label = translate(ctx.locale, "featured.label");
    return {
      day: r.day,
      total: r.total,
      offset: input.offset,
      hasMore: input.offset + r.organic.length < r.total,
      order: "as shown in the EventDesk directory today; keep it",
      featured: r.featured.map((c) => ({ ...card(ctx, c, call.appUrl), featured: true as const, label, labelKey: c.labelKey })),
      results: r.organic.map((c) => ({ ...card(ctx, c, call.appUrl), featured: false as const })),
    };
  },
});

registerMcpTool({
  name: "get_listing",
  version: "1",
  scope: "read",
  title: "Get a directory listing",
  description:
    "One listing's public page: description, categories, counties, factual badges, response statistics, published spaces (dimensions) and parking facts, published flower catalogues. A claimed listing shows its public contact details; an unclaimed one shows only the contact route its public source states, with the note that it is not claimed yet and cannot receive enquiries.",
  inputSchema: z.object({ listingId: z.string().min(1).max(64) }),
  handler: async (ctx, input, call) => {
    const l = await getPublicListing(ctx, input.listingId);
    if (!l) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const [spaces, catalogues] = await Promise.all([getListingSpaces(ctx, l.id), listPublicCatalogues(ctx, { listingId: l.id })]);
    return {
      ...card(ctx, l, call.appUrl),
      description: l.description,
      hasEnglish: l.hasEnglish,
      acceptsEnquiries: l.acceptsEnquiries,
      // P29: an unclaimed listing has no platform-mediated contact — only what its source published
      contact: l.claimed ? l.contact : null,
      unclaimed: l.unclaimed ? { publicContactRoute: l.unclaimed.publicContactRoute, sourceUrl: l.unclaimed.sourceUrl, collectedAt: iso(l.unclaimed.collectedAt) } : null,
      spaces: spaces.spaces.map((s) => ({ spaceId: s.spaceId, name: s.name, widthMm: s.widthMm, lengthMm: s.lengthMm, calibrated: s.calibrated, versionNo: s.versionNo, effectiveAt: iso(s.effectiveAt), tableTypes: s.model.tableTypes })),
      parking: spaces.parking,
      catalogues: catalogues.map((c) => ({ catalogueId: c.id, name: c.name, items: c.items.length })),
    };
  },
});

registerMcpTool({
  name: "list_catalogues",
  version: "1",
  scope: "read",
  title: "List flower catalogues",
  description:
    "Published flower catalogues with their varieties: kind, season months (empty = unknown), colours and INDICATIVE prices per stem and per bunch (null = unknown). Indicative prices are never a quote. Filter by listing or by variety name.",
  inputSchema: z.object({
    listingId: z.string().min(1).max(64).optional(),
    q: z.string().max(80).optional().describe("Part of a variety name."),
    limit: zLimit(100, 50).describe("Catalogues per page."),
    offset: zOffset,
  }),
  handler: async (ctx, input) => {
    const all = await listPublicCatalogues(ctx, { listingId: input.listingId, q: input.q?.trim() || undefined });
    return {
      total: all.length,
      offset: input.offset,
      hasMore: input.offset + input.limit < all.length,
      pricesAre: "indicative",
      catalogues: all.slice(input.offset, input.offset + input.limit).map((c) => ({
        catalogueId: c.id,
        name: c.name,
        listingId: c.listingId,
        listingName: c.listingName,
        items: c.items.map((i) => ({
          itemId: i.id,
          kind: i.kind,
          varietyName: i.varietyName,
          seasonMonths: i.seasonMonths,
          colours: i.colours,
          pricePerStem: money(i.pricePerStemMinor, i.currency),
          pricePerBunch: money(i.pricePerBunchMinor, i.currency),
          notes: i.notes,
        })),
      })),
    };
  },
});

registerMcpTool({
  name: "propose_supplier_shortlist",
  version: "1",
  scope: "propose",
  title: "Propose a supplier shortlist",
  description:
    "Owner and project managers only. Proposes a planner-side NOTE in the plan listing directory businesses to consider, with the reason for each in your own words. Pass featured: true for an entry that was featured in search_directory, so its paid label stays with it. The note notifies nobody and contacts no business: the user sends any enquiry personally.",
  inputSchema: z.object({
    occasionId: zOccasionId,
    title: z.string().min(1).max(120).optional(),
    listings: z
      .array(
        z.object({
          listingId: z.string().min(1).max(64),
          reason: z.string().max(400).optional(),
          featured: z.boolean().default(false).describe("true when the entry came from search_directory.featured."),
        }),
      )
      .min(1)
      .max(MAX_SHORTLIST_ITEMS),
  }),
  handler: async (ctx, input) => {
    const preview = await proposeSupplierShortlist(ctx, { occasionId: input.occasionId, title: input.title, items: input.listings });
    return mcpProposal(preview, { listings: input.listings.length, notifies: "nobody", enquiriesSent: 0 });
  },
});
