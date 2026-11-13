import {
  and,
  asc,
  categories,
  count,
  counties,
  desc,
  DISCOVERY_SOURCE_KINDS,
  discoveryBatches,
  discoveryDrafts,
  discoveryRuns,
  discoverySources,
  discoverySuppressions,
  eq,
  inArray,
  isNotNull,
  isNull,
  listingLocalities,
  listingRevisions,
  listings,
  localities,
  lt,
  ne,
  objectionRecords,
  OBJECTION_KINDS,
  sql,
  type DiscoveryBatchAction,
  type DiscoveryDraftState,
  type DiscoverySourceConfig,
  type DiscoverySourceKind,
  type ObjectionKind,
  type ObjectionState,
} from "@ed/db";
import { registerTemplate, sendEmail } from "@ed/email";
import { defineJob, enqueue } from "@ed/jobs";
import { AppError } from "@ed/shared/errors";
import { hashToken, randomToken } from "@ed/shared/ids";
import { safeFetch, SsrfError } from "@ed/shared/ssrf";
import { addDays } from "@ed/shared/time";
import { zId } from "@ed/shared/zod";
import { z } from "zod";
import { audit } from "./audit";
import { type Ctx } from "./context";
import { DISCOVERY_USER_AGENT, fetchRobotsAllowed } from "./fetching";
import { createUnclaimedListing } from "./listings";
import { decideRevision } from "./moderation";
import { checkPublicForm } from "./ratelimit";
import { registerRetentionRule } from "./retention";
import { requireStaffRole } from "./staff";
import { recordEvent } from "./stats";
import { inTx } from "./tx";

// Business discovery (BD1–BD7, W5).
//
// WHAT A SOURCE IS. Real source formats are the operator's: a licensed dataset arrives under
// a contract, ONRC publishes exports on its own terms. So this module implements
//   · licensed_dataset — a CSV or JSON file the operator pastes in or points to (https);
//   · business_page    — a list of public pages the operator enters, one business each; ONLY
//                        the page's own schema.org JSON-LD and meta tags are read;
//   · onrc_public      — an ADAPTER SEAM (registerOnrcAdapter). No ONRC API is invented here:
//                        until the operator's adapter is registered, a run records that and
//                        produces nothing.
//
// RULES ENFORCED HERE
//   BD2  a draft is never public: it is a row in discovery_drafts, nothing else reads it.
//   BD3  dedup by normalised name + place and by public identifiers (email, phone, site,
//        registration number). A suspected duplicate is QUEUED (state duplicate_review) for
//        a person; nothing is ever merged automatically.
//   BD4  approval creates the unclaimed listing (createUnclaimedListing) and approves its
//        moderation record, which cites the source.
//   BD5  exactly ONE claim invitation, by email, only to an address the source itself
//        publishes; none otherwise. Nothing else is ever sent to a discovered contact.
//   BD6  removal / objection: recorded, due within 30 days; honouring one retires the listing
//        at once and suppresses the business's dedupe keys so it is never discovered again.
//   BD7  per-source rate limit and kill switch (checked before every item and every request);
//        every run is logged.
//   SEC6 every outbound request goes through safeFetch (SSRF guard, size and time caps) and
//        robots.txt is honoured (fetchRobotsAllowed).

export { DISCOVERY_SOURCE_KINDS, OBJECTION_KINDS };
export type { DiscoveryDraftState, DiscoverySourceConfig, DiscoverySourceKind, ObjectionKind, ObjectionState };
export type DiscoverySource = typeof discoverySources.$inferSelect;
export type DiscoveryRun = typeof discoveryRuns.$inferSelect;
export type DiscoveryDraft = typeof discoveryDrafts.$inferSelect;
export type ObjectionRecord = typeof objectionRecords.$inferSelect;

export const DISCOVERY_ROLES = ["listing_moderator", "platform_admin"] as const;
export const OBJECTION_ROLES = ["listing_moderator", "platform_admin", "privacy_owner"] as const;
export const DISCOVERY_RUN_JOB = "discovery.run";
export const CLAIM_INVITATION_JOB = "discovery.claim-invitation";
export const OBJECTION_DUE_DAYS = 30;
export const OBJECTION_RETENTION_DAYS = 3 * 365;
export const REJECTED_DRAFT_RETENTION_DAYS = 90;
export const MAX_ITEMS_PER_RUN = 5000;
export const MAX_PAGE_URLS = 200;
export const MAX_INLINE_BYTES = 2 * 1024 * 1024;
const PAGE_MAX_BYTES = 1024 * 1024;
const DATASET_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

const asSystem = (ctx: Ctx): Ctx => ({ ...ctx, actor: { kind: "system" } });

/* ── Normalisation and dedupe keys (BD3) ───────────────────────────────── */

const LEGAL_FORMS = /\b(s\.?\s?c\.?|s\.?\s?r\.?\s?l\.?(-d)?|s\.?\s?a\.?|p\.?\s?f\.?\s?a\.?|i\.?\s?i\.?|i\.?\s?f\.?|srl|sa|pfa)\b/g;

export function stripDiacritics(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** "S.C. Florăria Ana S.R.L." → "floraria ana". */
export function normaliseName(name: string): string {
  return stripDiacritics(name)
    .toLowerCase()
    .replace(LEGAL_FORMS, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const normalisePlace = (text: string) => stripDiacritics(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function siteOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export type Candidate = {
  name: string;
  categoryText?: string | null;
  county?: string | null;
  locality?: string | null;
  /** The contact route as the source states it (phone, address, page). */
  contactRoute?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Public registration number (CUI / J-number). */
  identifier?: string | null;
  /** The business's own page, when the source gives one. */
  website?: string | null;
  sourceUrl: string;
};

/** The plain dedupe keys of a candidate. Stored and compared as SHA-256 only. */
export function dedupeKeysFor(c: { name: string; localityKey?: string | null; email?: string | null; phone?: string | null; identifier?: string | null; website?: string | null }): string[] {
  const keys: string[] = [];
  const name = normaliseName(c.name);
  if (name) keys.push(`n:${name}|${c.localityKey ?? ""}`);
  if (c.email) keys.push(`e:${c.email.trim().toLowerCase()}`);
  const phone = (c.phone ?? "").replace(/\D/g, "").replace(/^(0040|40)/, "0");
  if (phone.length >= 9) keys.push(`p:${phone}`);
  const ident = (c.identifier ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (ident.length >= 4) keys.push(`i:${ident}`);
  const site = siteOf(c.website);
  if (site) keys.push(`s:${site}`);
  return keys.map(hashToken);
}

/* ── Parsers ───────────────────────────────────────────────────────────── */

/** Minimal RFC 4180 reader: quoted fields, "" escapes, `,` or `;` delimiter (auto), header row. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const body = text.replace(/^﻿/, "");
  const firstLine = body.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (quoted) {
      if (ch === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  const header = (rows.shift() ?? []).map((h) => stripDiacritics(h).trim().toLowerCase());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const pick = (row: Record<string, unknown>, ...names: string[]): string | null => {
  for (const n of names) {
    const v = row[n];
    if (typeof v === "string" && v.trim() !== "") return v.trim().slice(0, 500);
    if (typeof v === "number") return String(v);
  }
  return null;
};

/**
 * A licensed dataset → candidates. Columns (CSV header or JSON keys; Romanian or English):
 * name|nume|denumire · category|categorie · county|judet · locality|localitate|oras ·
 * contact|adresa|address · email · phone|telefon · identifier|cui|cif · website|site ·
 * url|source_url (the public page the row comes from; defaults to the dataset's own URL).
 */
export function parseDataset(format: "csv" | "json", text: string, fallbackUrl: string): Candidate[] {
  let rows: Array<Record<string, unknown>>;
  if (format === "json") {
    const parsed: unknown = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : ((parsed as { items?: unknown; data?: unknown })?.items ?? (parsed as { data?: unknown })?.data);
    if (!Array.isArray(list)) throw new Error("JSON dataset must be an array (or { items: [...] })");
    rows = list
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [stripDiacritics(k).trim().toLowerCase(), v])));
  } else rows = parseCsv(text);
  const out: Candidate[] = [];
  for (const row of rows) {
    const name = pick(row, "name", "nume", "denumire");
    if (!name) continue;
    const phone = pick(row, "phone", "telefon", "tel");
    const address = pick(row, "contact", "adresa", "address");
    const website = pick(row, "website", "site", "web");
    out.push({
      name: name.slice(0, 120),
      categoryText: pick(row, "category", "categorie"),
      county: pick(row, "county", "judet"),
      locality: pick(row, "locality", "localitate", "oras"),
      contactRoute: [phone, address].filter(Boolean).join(" · ") || website,
      email: pick(row, "email", "e-mail"),
      phone,
      identifier: pick(row, "identifier", "cui", "cif"),
      website,
      sourceUrl: pick(row, "url", "source_url", "sursa") ?? website ?? fallbackUrl,
    });
  }
  return out;
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function metaContent(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*>`, "i");
  const tag = re.exec(html)?.[0];
  const content = tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] : null;
  return content ? decodeEntities(content).slice(0, 300) : null;
}

type LdNode = Record<string, unknown>;
const BUSINESS_TYPES = /Business|Organization|Store|Florist|Restaurant|EventVenue|Place|Corporation|Service/i;

function ldNodes(html: string): LdNode[] {
  const out: LdNode[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let m = re.exec(html); m && out.length < 50; m = re.exec(html)) {
    try {
      const parsed: unknown = JSON.parse(m[1]!.trim());
      const stack: unknown[] = [parsed];
      while (stack.length && out.length < 50) {
        const node = stack.pop();
        if (Array.isArray(node)) stack.push(...node);
        else if (node && typeof node === "object") {
          out.push(node as LdNode);
          const graph = (node as LdNode)["@graph"];
          if (graph) stack.push(graph);
        }
      }
    } catch {
      // a page's broken JSON-LD is the page's problem; it simply yields nothing
    }
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, 300) : null);

/**
 * A business's own page → one candidate, read ONLY from its schema.org JSON-LD and its meta
 * tags (og:site_name, og:locality …). The visible text of the page is never scraped. Null
 * when the page states no name in either.
 */
export function extractFromPage(html: string, pageUrl: string): Candidate | null {
  const nodes = ldNodes(html);
  const types = (n: LdNode) => (Array.isArray(n["@type"]) ? n["@type"].join(" ") : String(n["@type"] ?? ""));
  const node = nodes.find((n) => BUSINESS_TYPES.test(types(n)) && str(n.name)) ?? null;
  const name = (node ? str(node.name) : null) ?? metaContent(html, "og:site_name");
  if (!name) return null;
  const address = node?.address;
  let addressText: string | null = null;
  let locality: string | null = null;
  let county: string | null = null;
  if (typeof address === "string") addressText = str(address);
  else if (address && typeof address === "object") {
    const a = address as LdNode;
    locality = str(a.addressLocality);
    county = str(a.addressRegion);
    addressText = [str(a.streetAddress), locality, county].filter(Boolean).join(", ") || null;
  }
  locality ??= metaContent(html, "og:locality") ?? metaContent(html, "business:contact_data:locality");
  county ??= metaContent(html, "og:region") ?? metaContent(html, "business:contact_data:region");
  const phone = (node ? str(node.telephone) : null) ?? metaContent(html, "business:contact_data:phone_number");
  const email = ((node ? str(node.email) : null) ?? metaContent(html, "business:contact_data:email"))?.replace(/^mailto:/i, "") ?? null;
  return {
    name: decodeEntities(name).slice(0, 120),
    categoryText: node ? types(node) : null,
    county,
    locality,
    contactRoute: [phone, addressText].filter(Boolean).join(" · ") || pageUrl,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.toLowerCase() : null,
    phone,
    identifier: node ? (str(node.taxID) ?? str(node.vatID)) : null,
    website: pageUrl,
    sourceUrl: pageUrl,
  };
}

/* ── Source configuration (BD7, W5) ────────────────────────────────────── */

/** https only, a public host name, no credentials — checked again by safeFetch at fetch time. */
function publicHttpsUrl(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) || /^\d+(\.\d+){3}$/.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const zLines = z.preprocess(
  (v) => (typeof v === "string" ? v.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : Array.isArray(v) ? v : []),
  z.array(z.string().max(1000)),
);
const zOptionalId = z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().max(64).optional());

export const discoverySourceInput = z.object({
  name: z.string().trim().min(2, "common.validation.required").max(120, "common.validation.tooLong"),
  kind: z.enum(DISCOVERY_SOURCE_KINDS, "common.validation.required"),
  /** Contract number, licence or the terms that allow using the source. */
  termsReference: z.string().trim().min(3, "discovery.errors.termsRequired").max(500, "common.validation.tooLong"),
  rateLimitPerHour: z.coerce.number("common.validation.invalid").int().min(1, "common.validation.tooSmall").max(3600, "common.validation.tooBig"),
  format: z.enum(["csv", "json"]).optional(),
  url: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().max(1000).optional()),
  inline: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().max(MAX_INLINE_BYTES, "discovery.errors.inlineTooLarge").optional()),
  urls: zLines.optional(),
  defaultCategoryId: zOptionalId,
  targetCategoryIds: zLines.optional(),
  targetCountyCodes: zLines.optional(),
});
export type DiscoverySourceInput = z.input<typeof discoverySourceInput>;

async function buildConfig(ctx: Ctx, data: z.output<typeof discoverySourceInput>): Promise<DiscoverySourceConfig> {
  const errors: Record<string, string[]> = {};
  const config: DiscoverySourceConfig = {};
  if (data.kind === "licensed_dataset") {
    config.format = data.format ?? "csv";
    if (data.url) {
      const url = publicHttpsUrl(data.url);
      if (!url) errors.url = ["discovery.errors.urlHttps"];
      else config.url = url;
    }
    if (data.inline) config.inline = data.inline;
    if (!config.url && !config.inline) errors.inline = ["discovery.errors.datasetRequired"];
  } else if (data.kind === "business_page") {
    const urls = [...new Set(data.urls ?? [])];
    if (urls.length === 0) errors.urls = ["discovery.errors.urlsRequired"];
    else if (urls.length > MAX_PAGE_URLS) errors.urls = ["discovery.errors.tooManyUrls"];
    else {
      const clean = urls.map(publicHttpsUrl);
      if (clean.some((u) => u === null)) errors.urls = ["discovery.errors.urlHttps"];
      else config.urls = clean as string[];
    }
  }
  if (data.defaultCategoryId) {
    const [c] = await ctx.db.select({ id: categories.id }).from(categories).where(eq(categories.id, data.defaultCategoryId));
    if (!c) errors.defaultCategoryId = ["listings.errors.unknownCategory"];
    else config.defaultCategoryId = c.id;
  }
  if (data.targetCategoryIds?.length) {
    const rows = await ctx.db.select({ id: categories.id }).from(categories).where(inArray(categories.id, data.targetCategoryIds));
    if (rows.length !== new Set(data.targetCategoryIds).size) errors.targetCategoryIds = ["listings.errors.unknownCategory"];
    else config.targetCategoryIds = rows.map((r) => r.id);
  }
  if (data.targetCountyCodes?.length) {
    const codes = [...new Set(data.targetCountyCodes.map((c) => c.toUpperCase()))];
    const rows = await ctx.db.select({ code: counties.code }).from(counties).where(inArray(counties.code, codes));
    if (rows.length !== codes.length) errors.targetCountyCodes = ["listings.errors.unknownCounty"];
    else config.targetCountyCodes = codes;
  }
  if (Object.keys(errors).length) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: errors });
  return config;
}

/** W5: adds a source. It starts PAUSED (kill switch off) — someone has to switch it on. */
export async function createDiscoverySource(ctx: Ctx, input: DiscoverySourceInput): Promise<DiscoverySource> {
  const staffId = requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const data = discoverySourceInput.parse(input);
  const config = await buildConfig(ctx, data);
  const [dup] = await ctx.db.select({ id: discoverySources.id }).from(discoverySources).where(eq(discoverySources.name, data.name));
  if (dup) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { name: ["discovery.errors.nameTaken"] } });
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(discoverySources)
      .values({ name: data.name, kind: data.kind, config, rateLimitPerHour: data.rateLimitPerHour, enabled: false, termsReference: data.termsReference, createdByStaffId: staffId, createdAt: tx.now })
      .returning();
    await audit(tx, { action: "discovery.source_created", objectType: "discovery_source", objectId: row!.id, after: { name: data.name, kind: data.kind, termsReference: data.termsReference, rateLimitPerHour: data.rateLimitPerHour } });
    return row!;
  });
}

/** W5: changes a source's settings (not its kind). */
export async function updateDiscoverySource(ctx: Ctx, input: DiscoverySourceInput & { id: string }): Promise<DiscoverySource> {
  requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const id = zId.parse(input.id);
  const [source] = await ctx.db.select().from(discoverySources).where(eq(discoverySources.id, id));
  if (!source) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const data = discoverySourceInput.parse({ ...input, kind: source.kind });
  const config = await buildConfig(ctx, data);
  const [dup] = await ctx.db.select({ id: discoverySources.id }).from(discoverySources).where(and(eq(discoverySources.name, data.name), ne(discoverySources.id, id)));
  if (dup) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: { name: ["discovery.errors.nameTaken"] } });
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .update(discoverySources)
      .set({ name: data.name, config, rateLimitPerHour: data.rateLimitPerHour, termsReference: data.termsReference })
      .where(eq(discoverySources.id, id))
      .returning();
    await audit(tx, {
      action: "discovery.source_updated",
      objectType: "discovery_source",
      objectId: id,
      before: { name: source.name, rateLimitPerHour: source.rateLimitPerHour, termsReference: source.termsReference },
      after: { name: data.name, rateLimitPerHour: data.rateLimitPerHour, termsReference: data.termsReference },
    });
    return row!;
  });
}

/** BD7 kill switch. Switching off takes effect at once: a running pass stops before its next item. */
export async function setDiscoverySourceEnabled(ctx: Ctx, input: { id: string; enabled: boolean }): Promise<void> {
  requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const data = z.object({ id: zId, enabled: z.boolean() }).parse(input);
  const rows = await ctx.db.update(discoverySources).set({ enabled: data.enabled }).where(eq(discoverySources.id, data.id)).returning({ id: discoverySources.id });
  if (!rows[0]) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await audit(ctx, { action: data.enabled ? "discovery.source_enabled" : "discovery.source_paused", objectType: "discovery_source", objectId: data.id });
}

export type DiscoverySourceRow = { source: DiscoverySource; lastRun: DiscoveryRun | null; pendingDrafts: number };

export async function listDiscoverySources(ctx: Ctx): Promise<DiscoverySourceRow[]> {
  requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const sources = await ctx.db.select().from(discoverySources).orderBy(asc(discoverySources.createdAt));
  const out: DiscoverySourceRow[] = [];
  for (const source of sources) {
    const [lastRun] = await ctx.db.select().from(discoveryRuns).where(eq(discoveryRuns.sourceId, source.id)).orderBy(desc(discoveryRuns.startedAt)).limit(1);
    const [n] = await ctx.db
      .select({ n: count() })
      .from(discoveryDrafts)
      .where(and(eq(discoveryDrafts.sourceId, source.id), inArray(discoveryDrafts.state, ["pending", "duplicate_review"])));
    out.push({ source, lastRun: lastRun ?? null, pendingDrafts: n?.n ?? 0 });
  }
  return out;
}

export async function getDiscoverySource(ctx: Ctx, id: string): Promise<DiscoverySource> {
  requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const [source] = zId.safeParse(id).success ? await ctx.db.select().from(discoverySources).where(eq(discoverySources.id, id)) : [];
  if (!source) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return source;
}

/** BD7: the run log, newest first. */
export async function listDiscoveryRuns(ctx: Ctx, input: { sourceId?: string; limit?: number } = {}): Promise<Array<DiscoveryRun & { sourceName: string }>> {
  requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const rows = await ctx.db
    .select({ run: discoveryRuns, sourceName: discoverySources.name })
    .from(discoveryRuns)
    .innerJoin(discoverySources, eq(discoverySources.id, discoveryRuns.sourceId))
    .where(input.sourceId ? eq(discoveryRuns.sourceId, input.sourceId) : undefined)
    .orderBy(desc(discoveryRuns.startedAt))
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
  return rows.map((r) => ({ ...r.run, sourceName: r.sourceName }));
}

/** W5 "run": queues one pass of the source for the worker. Refused while the source is paused. */
export async function requestDiscoveryRun(ctx: Ctx, input: { sourceId: string }): Promise<{ queued: boolean }> {
  const staffId = requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const source = await getDiscoverySource(ctx, input.sourceId);
  if (!source.enabled) throw new AppError("CONFLICT", "discovery.errors.paused");
  // one pass per source per minute at most, however often the button is pressed
  const bucket = Math.floor(ctx.now.getTime() / 60_000);
  const result = await enqueue(ctx, DISCOVERY_RUN_JOB, { sourceId: source.id, triggeredBy: `staff:${staffId}` }, { uniqueKey: `discovery-run:${source.id}:${bucket}`, maxAttempts: 1 });
  await audit(ctx, { action: "discovery.run_requested", objectType: "discovery_source", objectId: source.id });
  return { queued: !result.deduped };
}

/* ── Running a source ──────────────────────────────────────────────────── */

export type DiscoveryFetchResult = { status: number; body: Buffer | string };
export type DiscoveryFetcher = (url: string, opts: { maxBytes: number; timeoutMs: number }) => Promise<DiscoveryFetchResult>;
export type RunDeps = {
  /** Injectable for tests. Default: safeFetch (SSRF guard, size and time caps). */
  fetcher?: DiscoveryFetcher;
};

const guardedFetcher: DiscoveryFetcher = (url, opts) => safeFetch(url, { ...opts, headers: { "user-agent": DISCOVERY_USER_AGENT } });

/**
 * THE ONRC SEAM. The operator's adapter (written against whatever ONRC actually publishes
 * and permits at that time) is registered here; it receives the source and a guarded fetch
 * (rate limit + kill switch + SSRF guard + robots.txt already applied) and yields candidates.
 * Nothing in this repository talks to ONRC by itself.
 */
export type OnrcAdapter = (input: { source: DiscoverySource; fetch: (url: string) => Promise<string> }) => AsyncIterable<Candidate> | Promise<Candidate[]>;
const g = globalThis as unknown as { __edOnrcAdapter?: OnrcAdapter | null };
export function registerOnrcAdapter(adapter: OnrcAdapter | null): void {
  g.__edOnrcAdapter = adapter;
}

class StopRun extends Error {
  constructor(readonly reason: "kill_switch" | "rate_limit") {
    super(reason);
  }
}

/**
 * Takes one request out of the source's hourly allowance — atomically, and only while the
 * kill switch is on. Throws StopRun otherwise.
 */
async function takeRequestSlot(ctx: Ctx, sourceId: string): Promise<void> {
  const hourAgo = new Date(ctx.now.getTime() - 3_600_000);
  const rows = await ctx.db.execute<{ id: string }>(sql`
    update discovery_sources set
      rate_window_start = case when rate_window_start is null or rate_window_start <= ${hourAgo} then ${ctx.now} else rate_window_start end,
      rate_window_count = case when rate_window_start is null or rate_window_start <= ${hourAgo} then 1 else rate_window_count + 1 end
    where id = ${sourceId} and enabled
      and (rate_window_start is null or rate_window_start <= ${hourAgo} or rate_window_count < rate_limit_per_hour)
    returning id`);
  if (rows.rows[0]) return;
  const [s] = await ctx.db.select({ enabled: discoverySources.enabled }).from(discoverySources).where(eq(discoverySources.id, sourceId));
  throw new StopRun(s?.enabled ? "rate_limit" : "kill_switch");
}

async function isEnabled(ctx: Ctx, sourceId: string): Promise<boolean> {
  const [s] = await ctx.db.select({ enabled: discoverySources.enabled }).from(discoverySources).where(eq(discoverySources.id, sourceId));
  return !!s?.enabled;
}

type Picklists = {
  categories: Array<{ id: string; slug: string; nameRo: string; nameEn: string }>;
  counties: Array<{ code: string; nameRo: string; nameEn: string; slug: string }>;
  localities: Array<{ id: string; countyCode: string; nameRo: string; nameEn: string | null; slug: string }>;
};

async function loadPicklists(ctx: Ctx): Promise<Picklists> {
  const [cats, cos, locs] = await Promise.all([
    ctx.db.select({ id: categories.id, slug: categories.slug, nameRo: categories.nameRo, nameEn: categories.nameEn }).from(categories).where(eq(categories.active, true)),
    ctx.db.select({ code: counties.code, nameRo: counties.nameRo, nameEn: counties.nameEn, slug: counties.slug }).from(counties).where(eq(counties.active, true)),
    ctx.db.select({ id: localities.id, countyCode: localities.countyCode, nameRo: localities.nameRo, nameEn: localities.nameEn, slug: localities.slug }).from(localities).where(eq(localities.active, true)),
  ]);
  return { categories: cats, counties: cos, localities: locs };
}

const SCHEMA_TYPE_CATEGORY: Array<[RegExp, string]> = [
  [/florist/i, "floristi"],
  [/eventvenue/i, "sali-de-evenimente"],
  [/foodestablishment|caterer|restaurant/i, "catering"],
  [/bakery/i, "torturi-si-cofetarie"],
  [/lodging|hotel/i, "cazare"],
  [/beautysalon|hairsalon/i, "coafura-si-make-up"],
];

/** Guesses picklist rows from the source's own words. A guess — the moderator can correct it. */
export function guessPicklists(p: Picklists, c: Candidate, defaultCategoryId?: string): { categoryId: string | null; countyCode: string | null; localityId: string | null } {
  const eqName = (a: string, b: string) => normalisePlace(a) === normalisePlace(b);
  let categoryId: string | null = null;
  if (c.categoryText) {
    const text = c.categoryText;
    const direct = p.categories.find((cat) => eqName(cat.nameRo, text) || eqName(cat.nameEn, text) || cat.slug === normalisePlace(text).replace(/ /g, "-"));
    const bySchema = SCHEMA_TYPE_CATEGORY.find(([re]) => re.test(text));
    categoryId = direct?.id ?? (bySchema ? (p.categories.find((cat) => cat.slug === bySchema[1])?.id ?? null) : null);
  }
  categoryId ??= defaultCategoryId ?? null;
  const countyText = c.county ? c.county.replace(/^jude[tț]ul\s+/i, "") : null;
  let county = countyText ? (p.counties.find((co) => co.code === countyText.toUpperCase() || eqName(co.nameRo, countyText) || eqName(co.nameEn, countyText)) ?? null) : null;
  let localityId: string | null = null;
  if (c.locality) {
    const text = c.locality;
    const matches = p.localities.filter((l) => (eqName(l.nameRo, text) || (l.nameEn ? eqName(l.nameEn, text) : false)) && (!county || l.countyCode === county.code));
    // a locality name that exists in several counties is not guessed without the county
    if (matches.length === 1) {
      localityId = matches[0]!.id;
      county ??= p.counties.find((co) => co.code === matches[0]!.countyCode) ?? null;
    }
  }
  return { categoryId, countyCode: county?.code ?? null, localityId };
}

async function findListingDuplicate(ctx: Ctx, c: Candidate, localityId: string | null): Promise<string | null> {
  const name = normaliseName(c.name);
  if (c.email) {
    const [byEmail] = await ctx.db.select({ id: listings.id }).from(listings).where(and(eq(listings.contactEmail, c.email.toLowerCase()), ne(listings.status, "retired"))).limit(1);
    if (byEmail) return byEmail.id;
  }
  const site = siteOf(c.website);
  if (site) {
    const rows = await ctx.db.select({ id: listings.id, website: listings.website }).from(listings).where(and(isNotNull(listings.website), ne(listings.status, "retired"), sql`${listings.website} ilike ${"%" + site.replace(/[\\%_]/g, "\\$&") + "%"}`)).limit(20);
    const hit = rows.find((r) => siteOf(r.website) === site);
    if (hit) return hit.id;
  }
  if (!name) return null;
  const token = name.split(" ").find((w) => w.length >= 3) ?? name;
  const rows = localityId
    ? await ctx.db
        .select({ id: listings.id, name: listings.name })
        .from(listings)
        .innerJoin(listingLocalities, eq(listingLocalities.listingId, listings.id))
        .where(and(eq(listingLocalities.localityId, localityId), ne(listings.status, "retired")))
        .limit(2000)
    : await ctx.db
        .select({ id: listings.id, name: listings.name })
        .from(listings)
        .where(and(ne(listings.status, "retired"), sql`${listings.name} ilike ${"%" + token.replace(/[\\%_]/g, "\\$&") + "%"}`))
        .limit(500);
  return rows.find((r) => normaliseName(r.name) === name)?.id ?? null;
}

type RunCounters = { itemsSeen: number; draftsCreated: number; duplicatesQueued: number; skipped: number; errors: string[] };

async function ingest(ctx: Ctx, source: DiscoverySource, runId: string, picklists: Picklists, c: Candidate, counters: RunCounters): Promise<void> {
  counters.itemsSeen++;
  const guess = guessPicklists(picklists, c, source.config.defaultCategoryId);
  const targetCats = source.config.targetCategoryIds ?? [];
  const targetCounties = source.config.targetCountyCodes ?? [];
  // BD7 targeting: outside the chosen categories / areas → not collected at all
  if ((targetCats.length && (!guess.categoryId || !targetCats.includes(guess.categoryId))) || (targetCounties.length && (!guess.countyCode || !targetCounties.includes(guess.countyCode)))) {
    counters.skipped++;
    return;
  }
  const localityKey = guess.localityId ?? (c.locality ? normalisePlace(c.locality) : "");
  const keys = dedupeKeysFor({ ...c, localityKey });
  if (keys.length === 0) {
    counters.skipped++;
    return;
  }
  // BD6: a business that asked to be removed is never discovered again
  const [suppressed] = await ctx.db.select({ k: discoverySuppressions.keyHash }).from(discoverySuppressions).where(inArray(discoverySuppressions.keyHash, keys)).limit(1);
  if (suppressed) {
    counters.skipped++;
    return;
  }
  const overlap = sql`${discoveryDrafts.dedupeKeys} ?| array[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]`;
  const known = await ctx.db.select({ id: discoveryDrafts.id, sourceId: discoveryDrafts.sourceId, state: discoveryDrafts.state }).from(discoveryDrafts).where(overlap).orderBy(asc(discoveryDrafts.createdAt)).limit(5);
  // the same source saw it before (whatever was decided then): nothing new
  if (known.some((d) => d.sourceId === source.id)) {
    counters.skipped++;
    return;
  }
  const duplicateDraft = known[0] ?? null;
  const duplicateListingId = await findListingDuplicate(ctx, c, guess.localityId);
  const duplicate = duplicateDraft !== null || duplicateListingId !== null;
  await ctx.db.insert(discoveryDrafts).values({
    sourceId: source.id,
    runId,
    name: c.name,
    categoryGuessId: guess.categoryId,
    categoryGuessText: c.categoryText?.slice(0, 200) ?? null,
    countyCode: guess.countyCode,
    localityId: guess.localityId,
    areaText: [c.locality, c.county].filter(Boolean).join(", ").slice(0, 200) || null,
    publicContactRoute: (c.contactRoute || c.sourceUrl).slice(0, 500),
    publicEmail: c.email ? c.email.trim().toLowerCase().slice(0, 320) : null,
    sourceUrl: c.sourceUrl.slice(0, 1000),
    collectedAt: ctx.now,
    // BD3: queued for a person, never merged
    state: duplicate ? "duplicate_review" : "pending",
    dedupeKeys: keys,
    duplicateOfDraftId: duplicateDraft?.id ?? null,
    duplicateOfListingId: duplicateListingId,
    createdAt: ctx.now,
  });
  if (duplicate) counters.duplicatesQueued++;
  else counters.draftsCreated++;
}

/**
 * One pass over a source (worker job, or directly in tests with an injected fetcher).
 * Always writes a discovery_runs row (BD7). The kill switch and the hourly allowance are
 * checked before every item and every request; either one ends the pass where it stands.
 */
export async function runDiscoverySource(ctx: Ctx, input: { sourceId: string; triggeredBy: string }, deps: RunDeps = {}): Promise<DiscoveryRun> {
  if (ctx.actor.kind !== "system") requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const [source] = await ctx.db.select().from(discoverySources).where(eq(discoverySources.id, input.sourceId));
  if (!source) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const fetcher = deps.fetcher ?? guardedFetcher;
  const [run] = await ctx.db.insert(discoveryRuns).values({ sourceId: source.id, startedAt: ctx.now, triggeredBy: input.triggeredBy.slice(0, 100) }).returning();
  const counters: RunCounters = { itemsSeen: 0, draftsCreated: 0, duplicatesQueued: 0, skipped: 0, errors: [] };
  let stoppedReason: string | null = null;
  const note = (message: string) => {
    if (counters.errors.length < 50) counters.errors.push(message.slice(0, 300));
  };
  // robots.txt is fetched once per origin (it counts against the allowance); its rules are
  // then applied to every path of that origin
  const robotsBodies = new Map<string, DiscoveryFetchResult>();

  /** SEC6: allowance → robots.txt → guarded fetch with caps. Returns the body as text. */
  const guardedGet = async (url: string, maxBytes: number): Promise<string> => {
    const origin = new URL(url).origin;
    if (!robotsBodies.has(origin)) {
      await takeRequestSlot(ctx, source.id);
      let res: DiscoveryFetchResult;
      try {
        res = await fetcher(`${origin}/robots.txt`, { maxBytes: 256 * 1024, timeoutMs: 5000 });
      } catch (e) {
        if (e instanceof SsrfError) throw e;
        res = { status: 599, body: "" }; // unreachable = not allowed
      }
      robotsBodies.set(origin, res);
    }
    const allowed = await fetchRobotsAllowed(url, DISCOVERY_USER_AGENT, { fetcher: async () => robotsBodies.get(origin)! });
    if (!allowed) throw new Error("robots.txt does not allow it");
    await takeRequestSlot(ctx, source.id);
    const res = await fetcher(url, { maxBytes, timeoutMs: FETCH_TIMEOUT_MS });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    const body = typeof res.body === "string" ? res.body : res.body.toString("utf8");
    if (Buffer.byteLength(body) > maxBytes) throw new Error("response too large");
    return body;
  };

  try {
    if (!source.enabled) throw new StopRun("kill_switch");
    const picklists = await loadPicklists(ctx);
    const handle = async (c: Candidate) => {
      if (counters.itemsSeen >= MAX_ITEMS_PER_RUN) throw new StopRun("rate_limit");
      if (!(await isEnabled(ctx, source.id))) throw new StopRun("kill_switch");
      await ingest(ctx, source, run!.id, picklists, c, counters);
    };

    if (source.kind === "licensed_dataset") {
      const format = source.config.format ?? "csv";
      let text = source.config.inline ?? null;
      const fallbackUrl = source.config.url ?? `dataset:${source.name}`;
      if (text === null && source.config.url) text = await guardedGet(source.config.url, DATASET_MAX_BYTES);
      if (text === null) throw new Error("dataset has neither a URL nor content");
      for (const c of parseDataset(format, text, fallbackUrl)) await handle(c);
    } else if (source.kind === "business_page") {
      for (const url of source.config.urls ?? []) {
        if (!(await isEnabled(ctx, source.id))) throw new StopRun("kill_switch");
        // a page this source already turned into a draft is not requested again
        const [seen] = await ctx.db.select({ id: discoveryDrafts.id }).from(discoveryDrafts).where(and(eq(discoveryDrafts.sourceId, source.id), eq(discoveryDrafts.sourceUrl, url))).limit(1);
        if (seen) {
          counters.itemsSeen++;
          counters.skipped++;
          continue;
        }
        let html: string;
        try {
          html = await guardedGet(url, PAGE_MAX_BYTES);
        } catch (e) {
          if (e instanceof StopRun) throw e;
          counters.itemsSeen++;
          note(`${url}: ${e instanceof SsrfError ? `blocked (${e.reason})` : e instanceof Error ? e.message : "fetch failed"}`);
          continue;
        }
        const c = extractFromPage(html, url);
        if (!c) {
          counters.itemsSeen++;
          note(`${url}: no schema.org or meta name on the page`);
          continue;
        }
        await handle(c);
      }
    } else {
      const adapter = g.__edOnrcAdapter;
      if (!adapter) throw new Error("ONRC adapter not configured (operator-owned; see registerOnrcAdapter)");
      const produced = await adapter({ source, fetch: (url) => guardedGet(url, DATASET_MAX_BYTES) });
      for await (const c of produced as AsyncIterable<Candidate>) await handle(c);
    }
  } catch (e) {
    if (e instanceof StopRun) stoppedReason = e.reason;
    else note(e instanceof SsrfError ? `blocked (${e.reason})` : e instanceof Error ? e.message : "run failed");
  }

  const [done] = await ctx.db
    .update(discoveryRuns)
    .set({ finishedAt: new Date(Math.max(Date.now(), ctx.now.getTime())), itemsSeen: counters.itemsSeen, draftsCreated: counters.draftsCreated, duplicatesQueued: counters.duplicatesQueued, skipped: counters.skipped, errors: counters.errors, stoppedReason })
    .where(eq(discoveryRuns.id, run!.id))
    .returning();
  await recordEvent(ctx, "discovery.runs", { kind: source.kind });
  if (counters.draftsCreated + counters.duplicatesQueued > 0) await recordEvent(ctx, "discovery.drafts", { kind: source.kind }, counters.draftsCreated + counters.duplicatesQueued);
  await audit(ctx, {
    action: "discovery.run",
    objectType: "discovery_source",
    objectId: source.id,
    after: { runId: run!.id, itemsSeen: counters.itemsSeen, draftsCreated: counters.draftsCreated, duplicatesQueued: counters.duplicatesQueued, skipped: counters.skipped, errors: counters.errors.length, stoppedReason },
    meta: { triggeredBy: input.triggeredBy },
  });
  return done!;
}

/* ── Drafts review (W5, BD3, BD4) ──────────────────────────────────────── */

export type DraftRow = {
  draft: DiscoveryDraft;
  sourceName: string;
  categoryName: string | null;
  localityName: string | null;
  countyName: string | null;
  /** BD3: what it looks like a duplicate of. */
  duplicateOf: { kind: "listing" | "draft"; id: string; name: string } | null;
  /** Ready to approve: it has a category and a locality from the picklists. */
  approvable: boolean;
};

export async function listDiscoveryDrafts(ctx: Ctx, input: { state?: DiscoveryDraftState; sourceId?: string; limit?: number } = {}): Promise<DraftRow[]> {
  requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const state = input.state ?? "pending";
  const rows = await ctx.db
    .select({ draft: discoveryDrafts, sourceName: discoverySources.name, categoryRo: categories.nameRo, categoryEn: categories.nameEn, locRo: localities.nameRo, locEn: localities.nameEn, coRo: counties.nameRo, coEn: counties.nameEn })
    .from(discoveryDrafts)
    .innerJoin(discoverySources, eq(discoverySources.id, discoveryDrafts.sourceId))
    .leftJoin(categories, eq(categories.id, discoveryDrafts.categoryGuessId))
    .leftJoin(localities, eq(localities.id, discoveryDrafts.localityId))
    .leftJoin(counties, eq(counties.code, discoveryDrafts.countyCode))
    .where(and(eq(discoveryDrafts.state, state), input.sourceId ? eq(discoveryDrafts.sourceId, input.sourceId) : undefined))
    .orderBy(state === "pending" || state === "duplicate_review" ? asc(discoveryDrafts.createdAt) : desc(discoveryDrafts.decidedAt))
    .limit(Math.min(Math.max(input.limit ?? 200, 1), 500));
  const en = ctx.locale === "en";
  const out: DraftRow[] = [];
  for (const r of rows) {
    let duplicateOf: DraftRow["duplicateOf"] = null;
    if (r.draft.duplicateOfListingId) {
      const [l] = await ctx.db.select({ name: listings.name }).from(listings).where(eq(listings.id, r.draft.duplicateOfListingId));
      if (l) duplicateOf = { kind: "listing", id: r.draft.duplicateOfListingId, name: l.name };
    }
    if (!duplicateOf && r.draft.duplicateOfDraftId) {
      const [d] = await ctx.db.select({ name: discoveryDrafts.name }).from(discoveryDrafts).where(eq(discoveryDrafts.id, r.draft.duplicateOfDraftId));
      if (d) duplicateOf = { kind: "draft", id: r.draft.duplicateOfDraftId, name: d.name };
    }
    out.push({
      draft: r.draft,
      sourceName: r.sourceName,
      categoryName: r.categoryRo ? (en ? (r.categoryEn ?? r.categoryRo) : r.categoryRo) : null,
      localityName: r.locRo ? (en ? (r.locEn ?? r.locRo) : r.locRo) : null,
      countyName: r.coRo ? (en ? (r.coEn ?? r.coRo) : r.coRo) : null,
      duplicateOf,
      approvable: !!r.draft.categoryGuessId && !!r.draft.localityId,
    });
  }
  return out;
}

export async function countDiscoveryDrafts(ctx: Ctx): Promise<Record<DiscoveryDraftState, number>> {
  requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const rows = await ctx.db.select({ state: discoveryDrafts.state, n: count() }).from(discoveryDrafts).groupBy(discoveryDrafts.state);
  const out: Record<DiscoveryDraftState, number> = { pending: 0, approved: 0, rejected: 0, duplicate_review: 0 };
  for (const r of rows) out[r.state] = r.n;
  return out;
}

/** The moderator corrects the category / locality GUESS before approving. The facts from the source stay as collected. */
export async function setDiscoveryDraftPlace(ctx: Ctx, input: { id: string; categoryId: string; localityId: string }): Promise<void> {
  requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const data = z.object({ id: zId, categoryId: z.string().min(1, "common.validation.required").max(64), localityId: z.string().min(1, "common.validation.required").max(64) }).parse(input);
  const [cat] = await ctx.db.select({ id: categories.id }).from(categories).where(and(eq(categories.id, data.categoryId), eq(categories.active, true)));
  const [loc] = await ctx.db.select().from(localities).where(and(eq(localities.id, data.localityId), eq(localities.active, true)));
  const errors: Record<string, string[]> = {};
  if (!cat) errors.categoryId = ["listings.errors.unknownCategory"];
  if (!loc) errors.localityId = ["listings.errors.unknownLocality"];
  if (Object.keys(errors).length) throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors: errors });
  const rows = await ctx.db
    .update(discoveryDrafts)
    .set({ categoryGuessId: cat!.id, localityId: loc!.id, countyCode: loc!.countyCode })
    .where(and(eq(discoveryDrafts.id, data.id), inArray(discoveryDrafts.state, ["pending", "duplicate_review"])))
    .returning({ id: discoveryDrafts.id });
  if (!rows[0]) throw new AppError("CONFLICT", "discovery.errors.alreadyDecided");
  await audit(ctx, { action: "discovery.draft_place_set", objectType: "discovery_draft", objectId: data.id, after: { categoryId: cat!.id, localityId: loc!.id } });
}

const decideInput = z.object({
  draftIds: z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(zId).min(1, "discovery.errors.nothingSelected").max(200)),
  action: z.enum(["approve", "reject", "discard"], "common.validation.required"),
  /** W5: ONE recorded reason for the whole batch. */
  reason: z.string().trim().min(10, "discovery.errors.reasonRequired").max(1000, "common.validation.tooLong"),
});

/**
 * W5: one decision over a batch of drafts, with ONE recorded reason.
 *   approve — each draft becomes a live, minimal, unclaimed listing: createUnclaimedListing
 *             (submitted by the system, citing the source) and its moderation record approved
 *             by this moderator (BD4). Needs the listing_moderator role. If the source
 *             published an email address, the single claim invitation is queued (BD5).
 *   reject  — not a business we list / wrong data. discard — a duplicate or noise.
 *             Both leave nothing public; the rows are purged after 90 days (INF6).
 * All or nothing: a draft that cannot be approved (no category or locality yet) fails the batch.
 */
export async function decideDiscoveryDrafts(ctx: Ctx, input: z.input<typeof decideInput>): Promise<{ batchId: string; listingIds: string[] }> {
  const data = decideInput.parse(input);
  const staffId = data.action === "approve" ? requireStaffRole(ctx, "listing_moderator") : requireStaffRole(ctx, ...DISCOVERY_ROLES);
  const ids = [...new Set(data.draftIds)];
  return inTx(ctx, async (tx) => {
    const drafts = await tx.db.select().from(discoveryDrafts).where(inArray(discoveryDrafts.id, ids)).for("update");
    if (drafts.length !== ids.length) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    const decided = drafts.find((d) => d.state !== "pending" && d.state !== "duplicate_review");
    if (decided) throw new AppError("CONFLICT", "discovery.errors.alreadyDecided");
    const [batch] = await tx.db.insert(discoveryBatches).values({ action: data.action as DiscoveryBatchAction, reason: data.reason, staffId, draftCount: drafts.length, createdAt: tx.now }).returning();
    const listingIds: string[] = [];
    for (const draft of drafts) {
      if (data.action !== "approve") {
        await tx.db.update(discoveryDrafts).set({ state: "rejected", batchId: batch!.id, decidedAt: tx.now }).where(eq(discoveryDrafts.id, draft.id));
        continue;
      }
      if (!draft.categoryGuessId || !draft.localityId) throw new AppError("VALIDATION", "discovery.errors.draftIncomplete", { params: { name: draft.name } });
      const [source] = await tx.db.select({ name: discoverySources.name, termsReference: discoverySources.termsReference }).from(discoverySources).where(eq(discoverySources.id, draft.sourceId));
      // The system is the submitter (discovery found it); the moderator reviewing the batch is
      // the approver — the moderation record carries both and cites the source (BD4).
      const { listingId, revisionId } = await createUnclaimedListing(asSystem(tx), {
        name: draft.name,
        categoryIds: [draft.categoryGuessId],
        localityIds: [draft.localityId],
        publicContactRoute: draft.publicContactRoute,
        sourceUrl: draft.sourceUrl,
        collectedAt: draft.collectedAt,
        sourceNote: `${source?.name ?? "discovery"} — ${draft.sourceUrl} (${source?.termsReference ?? ""})`.slice(0, 1000),
      });
      await decideRevision(tx, { id: revisionId, decision: "approve", reason: data.reason });
      await tx.db.update(discoveryDrafts).set({ state: "approved", batchId: batch!.id, decidedAt: tx.now, listingId }).where(eq(discoveryDrafts.id, draft.id));
      // BD5: only when the source itself publishes an address; exactly once (see the job)
      if (draft.publicEmail) await enqueue(tx, CLAIM_INVITATION_JOB, { draftId: draft.id }, { uniqueKey: `claim-invitation:${draft.id}` });
      listingIds.push(listingId);
    }
    await audit(tx, { action: `discovery.batch_${data.action}`, objectType: "discovery_batch", objectId: batch!.id, after: { reason: data.reason, drafts: drafts.length, listingIds } });
    await recordEvent(tx, "discovery.decided", { action: data.action }, drafts.length);
    return { batchId: batch!.id, listingIds };
  });
}

/* ── The claim invitation (BD5) ────────────────────────────────────────── */

type InvitationParams = { listingName: string; sourceUrl: string; collectedOn: string; claimUrl: string; removeUrl: string };

function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/**
 * Sends THE claim invitation for an approved draft: once, only to the address the public
 * source lists, only while the listing is still unclaimed and public. A second call does
 * nothing. Returns whether an email went out.
 */
export async function sendClaimInvitation(ctx: Ctx, input: { draftId: string }): Promise<boolean> {
  if (ctx.actor.kind !== "system") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const [row] = await ctx.db
    .select({ draft: discoveryDrafts, listing: listings })
    .from(discoveryDrafts)
    .innerJoin(listings, eq(listings.id, discoveryDrafts.listingId))
    .where(eq(discoveryDrafts.id, input.draftId));
  if (!row || row.draft.state !== "approved" || !row.draft.publicEmail || row.draft.invitationSentAt) return false;
  if (row.listing.claimed || row.listing.status !== "live") return false;
  const token = randomToken();
  const claimed = await ctx.db
    .update(discoveryDrafts)
    .set({ invitationSentAt: ctx.now, invitationTokenHash: hashToken(token) })
    .where(and(eq(discoveryDrafts.id, row.draft.id), isNull(discoveryDrafts.invitationSentAt)))
    .returning({ id: discoveryDrafts.id });
  if (!claimed[0]) return false;
  try {
    const result = await sendEmail(ctx, {
      to: row.draft.publicEmail,
      template: "discovery.claim_invitation",
      locale: "ro",
      params: {
        listingName: row.listing.name,
        sourceUrl: row.draft.sourceUrl,
        collectedOn: new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" }).format(row.draft.collectedAt),
        claimUrl: `${appUrl()}/claim/${row.listing.id}`,
        removeUrl: `${appUrl()}/claim/${row.listing.id}/remove?t=${token}`,
      } satisfies InvitationParams,
    });
    await audit(ctx, { action: "discovery.claim_invitation", objectType: "listing", objectId: row.listing.id, meta: { draftId: row.draft.id, status: result.status } });
    return result.status === "sent";
  } catch (e) {
    // nothing went out: hand the single invitation back so the job's retry can send it
    await ctx.db.update(discoveryDrafts).set({ invitationSentAt: null, invitationTokenHash: null }).where(eq(discoveryDrafts.id, row.draft.id));
    throw e;
  }
}

/** FOR THE CLAIMING DOMAIN (P30): the address the public source lists for this listing, or null. */
export async function getListingPublicEmail(ctx: Pick<Ctx, "db">, listingId: string): Promise<string | null> {
  const [row] = await ctx.db
    .select({ email: discoveryDrafts.publicEmail })
    .from(discoveryDrafts)
    .where(and(eq(discoveryDrafts.listingId, listingId), eq(discoveryDrafts.state, "approved")))
    .limit(1);
  return row?.email ?? null;
}

/* ── Removal and objection (BD6) ───────────────────────────────────────── */

export type RemovalContext = { listingId: string; listingName: string; sourceUrl: string | null; viaInvitation: boolean };

/** What the public removal page shows. Null unless the listing is a public, unclaimed one. */
export async function getRemovalContext(ctx: Pick<Ctx, "db">, input: { listingId: string; token?: string | null }): Promise<RemovalContext | null> {
  if (!zId.safeParse(input.listingId).success) return null;
  const [l] = await ctx.db.select().from(listings).where(eq(listings.id, input.listingId));
  if (!l || l.claimed || l.status !== "live") return null;
  let viaInvitation = false;
  if (input.token) {
    const [d] = await ctx.db.select({ id: discoveryDrafts.id }).from(discoveryDrafts).where(and(eq(discoveryDrafts.listingId, l.id), eq(discoveryDrafts.invitationTokenHash, hashToken(input.token))));
    viaInvitation = !!d;
  }
  return { listingId: l.id, listingName: l.name, sourceUrl: l.sourceUrl, viaInvitation };
}

/** Retires the unclaimed listing at once and makes sure discovery never finds it again. */
async function honourRemoval(tx: Ctx, listingId: string, objectionId: string): Promise<boolean> {
  const [l] = await tx.db.select().from(listings).where(eq(listings.id, listingId)).for("update");
  if (!l || l.claimed) return false;
  if (l.status !== "retired") {
    await tx.db
      .update(listingRevisions)
      .set({ state: "withdrawn", decidedAt: tx.now })
      .where(and(eq(listingRevisions.subjectId, l.id), eq(listingRevisions.kind, "listing"), eq(listingRevisions.state, "pending")));
    await tx.db.update(listings).set({ status: "retired" }).where(eq(listings.id, l.id));
  }
  const drafts = await tx.db.select({ keys: discoveryDrafts.dedupeKeys }).from(discoveryDrafts).where(eq(discoveryDrafts.listingId, l.id));
  const locs = await tx.db.select({ id: listingLocalities.localityId }).from(listingLocalities).where(eq(listingLocalities.listingId, l.id));
  const keys = new Set<string>(drafts.flatMap((d) => d.keys));
  for (const loc of locs) for (const k of dedupeKeysFor({ name: l.name, localityKey: loc.id })) keys.add(k);
  for (const k of dedupeKeysFor({ name: l.name, localityKey: "" })) keys.add(k);
  if (keys.size) {
    await tx.db.insert(discoverySuppressions).values([...keys].map((keyHash) => ({ keyHash, objectionId, createdAt: tx.now }))).onConflictDoNothing();
  }
  await audit(tx, { action: "listing.removed_on_objection", objectType: "listing", objectId: l.id, before: { status: l.status }, after: { status: "retired" }, meta: { objectionId } });
  return true;
}

const objectionInput = z.object({
  listingId: zId,
  kind: z.enum(OBJECTION_KINDS, "common.validation.required"),
  message: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(2000, "common.validation.tooLong").optional()),
  contactEmail: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.email("common.validation.invalidEmail").trim().toLowerCase().max(320).optional()),
  /** From the invitation's removal link. */
  token: z.string().max(200).nullish(),
  honeypot: z.string().nullish(),
  renderedAt: z.union([z.string(), z.number(), z.date()]).nullish(),
});

/**
 * BD6: anyone can ask for an unclaimed listing to be removed or corrected, or object to it —
 * no account needed (bot guard: honeypot, time floor, per-IP and per-listing limits, SEC11).
 * Every request is recorded with a 30-day deadline. A removal or objection that arrives
 * through the invitation's own link comes from the published address, so it is honoured AT
 * ONCE: the listing is retired and suppressed. Others wait for a moderator (decideObjection).
 */
export async function submitObjection(ctx: Ctx, input: z.input<typeof objectionInput>): Promise<{ id: string; honoured: boolean }> {
  const data = objectionInput.parse(input);
  await checkPublicForm(ctx, { formKey: "listing_objection", linkKey: `listing:${data.listingId}`, honeypot: data.honeypot, renderedAt: data.renderedAt, perIpPerHour: 5, perLinkPerHour: 20 });
  const context = await getRemovalContext(ctx, { listingId: data.listingId, token: data.token });
  if (!context) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const immediate = context.viaInvitation && data.kind !== "correction";
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(objectionRecords)
      .values({
        listingId: context.listingId,
        listingName: context.listingName,
        kind: data.kind,
        message: data.message ?? null,
        contactEmail: data.contactEmail ?? null,
        viaInvitation: context.viaInvitation,
        state: "received",
        receivedAt: tx.now,
        dueAt: addDays(tx.now, OBJECTION_DUE_DAYS),
        createdAt: tx.now,
      })
      .returning({ id: objectionRecords.id });
    let honoured = false;
    if (immediate) {
      honoured = await honourRemoval(asSystem(tx), context.listingId, row!.id);
      if (honoured) {
        await tx.db.update(objectionRecords).set({ state: "honoured", handledAt: tx.now, handlingNote: "Honoured automatically: the request came through the invitation sent to the published address." }).where(eq(objectionRecords.id, row!.id));
      }
    }
    await audit(tx, { action: "objection.received", objectType: "objection", objectId: row!.id, after: { listingId: context.listingId, kind: data.kind, viaInvitation: context.viaInvitation, honoured } });
    await recordEvent(tx, "discovery.objections", { kind: data.kind });
    return { id: row!.id, honoured };
  });
}

export async function listObjections(ctx: Ctx, input: { state?: "open" | "handled" } = {}): Promise<Array<ObjectionRecord & { overdue: boolean; daysLeft: number }>> {
  requireStaffRole(ctx, ...OBJECTION_ROLES);
  const open = (input.state ?? "open") === "open";
  const rows = await ctx.db
    .select()
    .from(objectionRecords)
    .where(open ? eq(objectionRecords.state, "received") : ne(objectionRecords.state, "received"))
    .orderBy(open ? asc(objectionRecords.dueAt) : desc(objectionRecords.handledAt))
    .limit(200);
  return rows.map((r) => ({ ...r, overdue: r.state === "received" && r.dueAt.getTime() < ctx.now.getTime(), daysLeft: Math.ceil((r.dueAt.getTime() - ctx.now.getTime()) / 86_400_000) }));
}

const decideObjectionInput = z.object({
  id: zId,
  decision: z.enum(["honour", "decline"], "common.validation.required"),
  /** What was done and why — the evidence of handling (kept 3 years). */
  note: z.string().trim().min(10, "discovery.errors.reasonRequired").max(2000, "common.validation.tooLong"),
});

/**
 * A moderator handles a request (BD6). "honour" on a removal or objection retires the
 * listing at once and suppresses it from discovery; on a correction it records that the
 * correction was made. "decline" needs the reason. Either way the record keeps who and when.
 */
export async function decideObjection(ctx: Ctx, input: z.input<typeof decideObjectionInput>): Promise<void> {
  const staffId = requireStaffRole(ctx, ...OBJECTION_ROLES);
  const data = decideObjectionInput.parse(input);
  await inTx(ctx, async (tx) => {
    const [rec] = await tx.db.select().from(objectionRecords).where(eq(objectionRecords.id, data.id)).for("update");
    if (!rec) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (rec.state !== "received") throw new AppError("CONFLICT", "discovery.errors.alreadyDecided");
    if (data.decision === "honour" && rec.kind !== "correction") {
      const done = await honourRemoval(tx, rec.listingId, rec.id);
      if (!done) throw new AppError("CONFLICT", "discovery.errors.listingClaimed");
    }
    await tx.db
      .update(objectionRecords)
      .set({ state: data.decision === "honour" ? "honoured" : "declined", handledAt: tx.now, handledByStaffId: staffId, handlingNote: data.note })
      .where(eq(objectionRecords.id, rec.id));
    await audit(tx, { action: `objection.${data.decision === "honour" ? "honoured" : "declined"}`, objectType: "objection", objectId: rec.id, after: { note: data.note, listingId: rec.listingId } });
  });
}

/* ── Registrations ─────────────────────────────────────────────────────── */

function registerRules(): void {
  registerTemplate<InvitationParams>("discovery.claim_invitation", (p, { t }) => ({
    subject: t("discovery.email.invitation.subject", { listing: p.listingName }),
    blocks: [
      { kind: "text", text: t("discovery.email.invitation.who", { listing: p.listingName, source: p.sourceUrl, date: p.collectedOn }) },
      { kind: "text", text: t("discovery.email.invitation.what") },
      { kind: "button", label: t("discovery.email.invitation.claim"), url: p.claimUrl },
      { kind: "text", text: t("discovery.email.invitation.correct") },
      { kind: "text", text: t("discovery.email.invitation.remove", { url: p.removeUrl }) },
      { kind: "note", text: t("discovery.email.invitation.once") },
    ],
  }));

  // INF6: rejected or discarded drafts go after 90 days …
  registerRetentionRule({
    name: "discovery-rejected-drafts",
    run: async (ctx) => {
      const gone = await ctx.db
        .delete(discoveryDrafts)
        .where(and(eq(discoveryDrafts.state, "rejected"), lt(discoveryDrafts.decidedAt, addDays(ctx.now, -REJECTED_DRAFT_RETENTION_DAYS))))
        .returning({ id: discoveryDrafts.id });
      return gone.length;
    },
  });
  // … and handled removal / objection records after 3 years (the suppression keys stay: they
  // are hashes, and they are what keeps the business from being discovered again).
  registerRetentionRule({
    name: "objection-records",
    run: async (ctx) => {
      const gone = await ctx.db
        .delete(objectionRecords)
        .where(and(ne(objectionRecords.state, "received"), lt(objectionRecords.handledAt, addDays(ctx.now, -OBJECTION_RETENTION_DAYS))))
        .returning({ id: objectionRecords.id });
      return gone.length;
    },
  });
}
registerRules();

/** Called by @ed/jobs/registry in the worker. */
export function registerJobs(): void {
  registerRules();
  defineJob(
    DISCOVERY_RUN_JOB,
    z.object({ sourceId: z.string(), triggeredBy: z.string() }),
    async (ctx, p) => {
      await runDiscoverySource(ctx, p);
    },
    { maxAttempts: 1, leaseMs: 30 * 60_000 },
  );
  defineJob(CLAIM_INVITATION_JOB, z.object({ draftId: z.string() }), async (ctx, p) => {
    await sendClaimInvitation(ctx, p);
  });
}
