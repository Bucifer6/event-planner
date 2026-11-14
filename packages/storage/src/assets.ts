import { createHash } from "node:crypto";
import { audit } from "@ed/core/audit";
import { actorAccountId, actorRef, requireSystem, type Ctx } from "@ed/core/context";
import { registerRetentionRule } from "@ed/core/retention";
import { inTx } from "@ed/core/tx";
import {
  and,
  assetOwnerTypeSchema,
  assets,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  sql,
  storageUsage,
  type AssetOwnerType,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { newId } from "@ed/shared/ids";
import { addDays, addHours } from "@ed/shared/time";
import { z } from "zod";
import { MAX_FILE_BYTES, processUpload, type ProcessedFile } from "./pipeline";
import { getScanner, ScannerUnavailableError } from "./scan";
import { signAssetLink, verifyAssetLink } from "./sign";
import { getStorageTransport, type Bucket } from "./transport";

export type Asset = typeof assets.$inferSelect;
export type AssetOwner = { ownerType: AssetOwnerType; ownerId: string };

const MIB = 1024 * 1024;

/** Fair use (Q6: 100 MiB per occasion; Q9: 200 MiB per business). Counted at upload time. */
export const FAIR_USE_BYTES: Record<AssetOwnerType, number> = {
  occasion: 100 * MIB,
  business: 200 * MIB,
  // Not fixed by the PRD (account-owned files are small: e.g. a profile image).
  account: 100 * MIB,
};

// ── Who may read / write an owner's assets ─────────────────────────────────────────────
// Each domain registers the rule for its owner type once (module load or registerJobs()):
//
//   registerAssetAccess("occasion", {
//     canRead:  async (ctx, asset) => isMember(ctx, asset.ownerId),
//     canWrite: async (ctx, owner) => isMember(ctx, owner.ownerId, { roles: ["owner", "planner"] }),
//   });
//
// Until a rule exists for an owner type, only the system actor has access (private by default).

export type AssetAccess = {
  canRead: (ctx: Ctx, asset: Asset) => Promise<boolean>;
  /** Upload to and delete from this owner. */
  canWrite: (ctx: Ctx, owner: AssetOwner) => Promise<boolean>;
};

const g = globalThis as unknown as { __edAssetAccess?: Map<AssetOwnerType, AssetAccess> };
const accessRules: Map<AssetOwnerType, AssetAccess> = (g.__edAssetAccess ??= new Map());

export function registerAssetAccess(ownerType: AssetOwnerType, access: AssetAccess): void {
  accessRules.set(assetOwnerTypeSchema.parse(ownerType), access);
}

// An account's own files: that account only.
if (!accessRules.has("account")) {
  registerAssetAccess("account", {
    canRead: async (ctx, asset) => actorAccountId(ctx.actor) === asset.ownerId,
    canWrite: async (ctx, owner) =>
      ctx.actor.kind === "account" && ctx.actor.accountId === owner.ownerId,
  });
}

async function requireWrite(ctx: Ctx, owner: AssetOwner): Promise<void> {
  if (ctx.actor.kind === "system") return;
  // MCP is read/propose only (MCP3): it never uploads or deletes.
  if (ctx.actor.kind === "mcp") throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  const rule = accessRules.get(owner.ownerType);
  if (!rule || !(await rule.canWrite(ctx, owner))) {
    throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  }
}

async function requireRead(ctx: Ctx, asset: Asset): Promise<void> {
  if (ctx.actor.kind === "system") return;
  const rule = accessRules.get(asset.ownerType);
  // NOT_FOUND, not FORBIDDEN: do not reveal that the asset exists
  if (!rule || !(await rule.canRead(ctx, asset))) {
    throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  }
}

// ── Upload ─────────────────────────────────────────────────────────────────────────────

const ownerSchema = z.object({ ownerType: assetOwnerTypeSchema, ownerId: z.string().min(1).max(64) });

const uploadInput = ownerSchema.extend({
  file: z.object({
    name: z.string().max(500),
    bytes: z.instanceof(Buffer),
    /** Declared type. Informational only: the real type comes from the file's bytes. */
    mime: z.string().max(200).optional(),
  }),
  /** PDFs are accepted only where the calling feature says so (drawings, quotes). */
  allowPdf: z.boolean().optional(),
});
export type UploadAssetInput = z.input<typeof uploadInput>;

export type UploadOptions = {
  /** Override the owner limit (tests). */
  limitBytes?: number;
};

function cleanName(name: string, ext: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
     
    .replace(/[\u0000-\u001f\u007f"<>|:*?]/g, "")
    .trim()
    .slice(0, 120);
  return base || `file.${ext}`;
}

export function formatMib(bytes: number): string {
  return `${(bytes / MIB).toFixed(bytes >= 10 * MIB ? 0 : 1)} MiB`;
}

function bucketFor(kind: Asset["kind"]): Bucket {
  return kind === "pdf" ? "media" : "private";
}

async function scanOrThrow(bytes: Buffer): Promise<"clean" | "infected"> {
  try {
    return await getScanner().scan(bytes);
  } catch (e) {
    if (e instanceof ScannerUnavailableError) {
      // Nothing is stored and nothing becomes visible without a scan (SEC4).
      throw new AppError("CONFLICT", "platform.upload.scanUnavailable");
    }
    throw e;
  }
}

/**
 * Reserves room in the owner's fair-use counter and writes the asset row — one transaction,
 * with the counter row locked, so parallel uploads cannot overshoot the limit.
 */
async function commitAsset(
  ctx: Ctx,
  owner: AssetOwner,
  values: Omit<typeof assets.$inferInsert, "ownerType" | "ownerId">,
  bytes: number,
  limitBytes: number,
  replacePendingId?: string,
): Promise<Asset> {
  return inTx(ctx, async (tx) => {
    await tx.db.insert(storageUsage).values({ ...owner, bytes: 0, files: 0 }).onConflictDoNothing();
    const locked = await tx.db.execute<{ bytes: string }>(
      sql`select bytes from storage_usage where owner_type = ${owner.ownerType} and owner_id = ${owner.ownerId} for update`,
    );
    const used = Number(locked.rows[0]?.bytes ?? 0);
    if (used + bytes > limitBytes) {
      // Q9: say which asset to remove; delete nothing.
      const [largest] = await tx.db
        .select({ id: assets.id, name: assets.name, bytes: assets.bytes })
        .from(assets)
        .where(
          and(
            eq(assets.ownerType, owner.ownerType),
            eq(assets.ownerId, owner.ownerId),
            isNull(assets.deletedAt),
            eq(assets.scanState, "clean"),
          ),
        )
        .orderBy(desc(assets.bytes))
        .limit(1);
      throw new AppError("LIMIT", largest ? "platform.upload.overLimit" : "platform.upload.overLimitEmpty", {
        params: {
          limit: formatMib(limitBytes),
          used: formatMib(used),
          asset: largest?.name ?? "",
          assetSize: largest ? formatMib(largest.bytes) : "",
        },
        largestAsset: largest ?? null,
        fieldErrors: { file: [largest ? "platform.upload.overLimitField" : "platform.upload.overLimitEmpty"] },
      });
    }
    const row = replacePendingId
      ? (
          await tx.db
            .update(assets)
            .set(values)
            .where(and(eq(assets.id, replacePendingId), eq(assets.scanState, "pending")))
            .returning()
        )[0]
      : (await tx.db.insert(assets).values({ ...owner, ...values }).returning())[0];
    if (!row) throw new AppError("CONFLICT", "common.errors.CONFLICT");
    await tx.db
      .update(storageUsage)
      .set({ bytes: sql`${storageUsage.bytes} + ${bytes}`, files: sql`${storageUsage.files} + 1`, updatedAt: ctx.now })
      .where(and(eq(storageUsage.ownerType, owner.ownerType), eq(storageUsage.ownerId, owner.ownerId)));
    await audit(tx, {
      action: "asset.uploaded",
      objectType: "asset",
      objectId: row.id,
      meta: { ownerType: owner.ownerType, ownerId: owner.ownerId, kind: row.kind, bytes },
    });
    return row;
  });
}

/** Keeps a trace of a refused infected file (no bytes are stored, it is never visible). */
async function recordInfected(ctx: Ctx, owner: AssetOwner, name: string, original: Buffer, file: ProcessedFile) {
  const id = newId();
  await ctx.db.insert(assets).values({
    id,
    ...owner,
    kind: file.type.kind,
    mime: file.type.mime,
    name,
    bytes: 0,
    sha256: createHash("sha256").update(original).digest("hex"),
    storageKey: "",
    scanState: "infected",
    visibleAt: null,
    createdBy: actorRef(ctx.actor).id,
    createdAt: ctx.now,
    deletedAt: ctx.now,
    purgedAt: ctx.now,
  });
  await audit(ctx, { action: "asset.infected", objectType: "asset", objectId: id, meta: { ...owner } });
}

async function ingest(
  ctx: Ctx,
  owner: AssetOwner,
  rawName: string,
  original: Buffer,
  allowPdf: boolean,
  opts: UploadOptions,
  pendingId?: string,
): Promise<Asset> {
  const file = await processUpload(original, { allowPdf });
  const name = cleanName(rawName, file.type.ext);
  // The scanner sees what was uploaded AND what will be served.
  const verdicts = [await scanOrThrow(original)];
  if (file.bytes !== original) verdicts.push(await scanOrThrow(file.bytes));
  if (verdicts.includes("infected")) {
    await recordInfected(ctx, owner, name, original, file);
    throw new AppError("VALIDATION", "platform.upload.infected", {
      fieldErrors: { file: ["platform.upload.infected"] },
    });
  }
  const id = pendingId ?? newId();
  const key = `assets/${owner.ownerType}/${owner.ownerId.toLowerCase().replace(/[^a-z0-9]/g, "")}/${id}.${file.type.ext}`;
  const bucket = bucketFor(file.type.kind);
  const transport = await getStorageTransport();
  await transport.put(bucket, key, file.bytes, file.type.mime);
  try {
    return await commitAsset(
      ctx,
      owner,
      {
        id,
        kind: file.type.kind,
        mime: file.type.mime,
        name,
        bytes: file.bytes.length,
        sha256: createHash("sha256").update(file.bytes).digest("hex"),
        storageKey: key,
        scanState: "clean",
        visibleAt: ctx.now,
        createdBy: actorRef(ctx.actor).id,
        createdAt: ctx.now,
      },
      file.bytes.length,
      opts.limitBytes ?? FAIR_USE_BYTES[owner.ownerType],
      pendingId,
    );
  } catch (e) {
    await transport.delete(bucket, key).catch(() => {});
    throw e;
  }
}

/**
 * The upload pipeline (SEC4, Q6, Q9): access check → type by magic bytes → PNG/JPG re-encoded
 * (metadata and embedded content gone) → malware scan → fair-use counter → stored. The asset
 * is visible only when all of that succeeded. Errors are AppErrors with a `file` field error;
 * an over-limit error (code LIMIT) names the largest existing asset and deletes nothing.
 */
export async function uploadAsset(
  ctx: Ctx,
  input: UploadAssetInput,
  opts: UploadOptions = {},
): Promise<Asset> {
  const data = uploadInput.parse(input);
  const owner: AssetOwner = { ownerType: data.ownerType, ownerId: data.ownerId };
  await requireWrite(ctx, owner);
  return ingest(ctx, owner, data.file.name, data.file.bytes, data.allowPdf ?? false, opts);
}

// ── Direct (signed) uploads to the object store ────────────────────────────────────────

const signedInput = ownerSchema.extend({
  name: z.string().max(500),
  /** Declared size; the real size is checked again when the upload is completed. */
  bytes: z.number().int().positive(),
  mime: z.enum(["image/png", "image/jpeg", "application/pdf"]),
  allowPdf: z.boolean().optional(),
});

export type SignedUpload = { assetId: string; uploadUrl: string; expiresAt: Date };

/**
 * Issues a signed PUT URL for a direct browser → object store upload (S3 transport only;
 * with the local transport use uploadAsset through the web upload route). The object lands
 * in a quarantine key and is invisible until completeSignedUpload() ran the same pipeline.
 */
export async function createSignedUpload(
  ctx: Ctx,
  input: z.input<typeof signedInput>,
): Promise<SignedUpload> {
  const data = signedInput.parse(input);
  const owner: AssetOwner = { ownerType: data.ownerType, ownerId: data.ownerId };
  await requireWrite(ctx, owner);
  if (data.bytes > MAX_FILE_BYTES) {
    throw new AppError("VALIDATION", "platform.upload.tooLarge", {
      fieldErrors: { file: ["platform.upload.tooLarge"] },
    });
  }
  if (data.mime === "application/pdf" && !data.allowPdf) {
    throw new AppError("VALIDATION", "platform.upload.type", { fieldErrors: { file: ["platform.upload.type"] } });
  }
  const transport = await getStorageTransport();
  if (!transport.presignPut) throw new AppError("CONFLICT", "platform.upload.directUnavailable");
  const id = newId();
  const key = `incoming/${id}`;
  const kind = data.mime === "application/pdf" ? "pdf" : "image";
  await ctx.db.insert(assets).values({
    id,
    ...owner,
    kind,
    mime: data.mime,
    name: cleanName(data.name, kind === "pdf" ? "pdf" : "img"),
    bytes: 0,
    sha256: "",
    storageKey: key,
    scanState: "pending",
    visibleAt: null,
    createdBy: actorRef(ctx.actor).id,
    createdAt: ctx.now,
  });
  const expiresInSeconds = 600;
  const uploadUrl = await transport.presignPut("private", key, { contentType: data.mime, expiresInSeconds });
  return { assetId: id, uploadUrl, expiresAt: new Date(ctx.now.getTime() + expiresInSeconds * 1000) };
}

/** Runs the pipeline on a directly uploaded object and makes it visible if it passes. */
export async function completeSignedUpload(
  ctx: Ctx,
  input: { assetId: string; allowPdf?: boolean },
  opts: UploadOptions = {},
): Promise<Asset> {
  const [pending] = await ctx.db.select().from(assets).where(eq(assets.id, z.string().min(1).max(64).parse(input.assetId)));
  if (!pending) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const owner: AssetOwner = { ownerType: pending.ownerType, ownerId: pending.ownerId };
  await requireWrite(ctx, owner);
  if (pending.scanState !== "pending") {
    if (pending.scanState === "clean" && !pending.deletedAt) return pending; // repeat call (Q4)
    throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  }
  const transport = await getStorageTransport();
  let original: Buffer;
  try {
    original = await transport.get("private", pending.storageKey, MAX_FILE_BYTES);
  } catch {
    throw new AppError("VALIDATION", "platform.upload.tooLarge", {
      fieldErrors: { file: ["platform.upload.tooLarge"] },
    });
  }
  try {
    return await ingest(ctx, owner, pending.name, original, input.allowPdf ?? false, opts, pending.id);
  } finally {
    await transport.delete("private", pending.storageKey).catch(() => {});
  }
}

// ── Reading ────────────────────────────────────────────────────────────────────────────

function isVisible(a: Asset): boolean {
  return a.scanState === "clean" && a.visibleAt !== null && a.deletedAt === null;
}

async function loadVisible(ctx: Pick<Ctx, "db">, assetId: string): Promise<Asset> {
  const id = z.string().min(1).max(64).safeParse(assetId);
  const row = id.success
    ? (await ctx.db.select().from(assets).where(eq(assets.id, id.data)))[0]
    : undefined;
  if (!row || !isVisible(row)) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  return row;
}

/** A visible asset the actor may read (metadata only). */
export async function getAsset(ctx: Ctx, assetId: string): Promise<Asset> {
  const asset = await loadVisible(ctx, assetId);
  await requireRead(ctx, asset);
  return asset;
}

/** Visible assets of one owner, newest first, plus the usage counter. */
export async function listAssets(ctx: Ctx, owner: AssetOwner): Promise<Asset[]> {
  const o = ownerSchema.parse(owner);
  const rows = await ctx.db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.ownerType, o.ownerType),
        eq(assets.ownerId, o.ownerId),
        isNull(assets.deletedAt),
        eq(assets.scanState, "clean"),
        isNotNull(assets.visibleAt),
      ),
    )
    .orderBy(desc(assets.createdAt));
  const out: Asset[] = [];
  for (const row of rows) {
    try {
      await requireRead(ctx, row);
      out.push(row);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
  }
  return out;
}

export type StorageUsage = { bytes: number; files: number; limitBytes: number };

export async function getUsage(ctx: Ctx, owner: AssetOwner): Promise<StorageUsage> {
  const o = ownerSchema.parse(owner);
  await requireWrite(ctx, o);
  const [row] = await ctx.db
    .select()
    .from(storageUsage)
    .where(and(eq(storageUsage.ownerType, o.ownerType), eq(storageUsage.ownerId, o.ownerId)));
  return { bytes: row?.bytes ?? 0, files: row?.files ?? 0, limitBytes: FAIR_USE_BYTES[o.ownerType] };
}

export const DEFAULT_LINK_TTL_SECONDS = 600;
const MAX_LINK_TTL_SECONDS = 24 * 3600;

function baseUrl(kind: Asset["kind"]): string {
  // PDFs only ever from the media origin (SEC4); images from the app origin (CSP img-src 'self').
  const url = kind === "pdf" ? process.env.MEDIA_URL : process.env.APP_URL;
  if (!url) throw new Error(`Missing environment variable: ${kind === "pdf" ? "MEDIA_URL" : "APP_URL"}`);
  return url.replace(/\/+$/, "");
}

/**
 * A scoped, expiring link to a visible asset the actor may read (default 10 minutes).
 * Call it when rendering; do not store the result.
 */
export async function getAssetUrl(
  ctx: Ctx,
  assetId: string,
  opts: { ttlSeconds?: number } = {},
): Promise<string> {
  const asset = await getAsset(ctx, assetId);
  const ttl = Math.min(Math.max(opts.ttlSeconds ?? DEFAULT_LINK_TTL_SECONDS, 30), MAX_LINK_TTL_SECONDS);
  const exp = Math.floor(ctx.now.getTime() / 1000) + ttl;
  const ext = asset.kind === "pdf" ? "pdf" : asset.mime === "image/png" ? "png" : "jpg";
  return `${baseUrl(asset.kind)}/api/media/${asset.id}/file.${ext}?e=${exp}&s=${signAssetLink(asset.id, exp)}`;
}

/** RFC 5987 filename for Content-Disposition. */
function dispositionName(name: string, fallbackExt: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_") || `file.${fallbackExt}`;
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Response headers for serving an asset (SEC4). PDFs are ALWAYS a download — never rendered
 * in a page — and every asset is sandboxed and non-sniffable.
 */
export function mediaHeaders(asset: Pick<Asset, "kind" | "mime" | "name" | "bytes">): Record<string, string> {
  const pdf = asset.kind === "pdf";
  return {
    "Content-Type": pdf ? "application/pdf" : asset.mime === "image/png" ? "image/png" : "image/jpeg",
    "Content-Length": String(asset.bytes),
    "Content-Disposition": `${pdf ? "attachment" : "inline"}; ${dispositionName(asset.name, pdf ? "pdf" : "jpg")}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": pdf ? "same-origin" : "same-site",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "private, max-age=300",
    "X-Robots-Tag": "noindex",
  };
}

export type ServedAsset = { asset: Asset; bytes: Buffer; headers: Record<string, string> };

/**
 * For the media route: checks the signed link and returns the bytes and headers. Anything
 * wrong (bad signature, expired, not visible, infected, deleted) is the same NOT_FOUND.
 */
export async function openSignedAsset(
  ctx: Pick<Ctx, "db" | "now">,
  link: { assetId: string; expires: number; signature: string },
): Promise<ServedAsset> {
  if (!verifyAssetLink(link.assetId, link.expires, link.signature, ctx.now)) {
    throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  }
  const asset = await loadVisible(ctx, link.assetId);
  const transport = await getStorageTransport();
  const bytes = await transport.get(bucketFor(asset.kind), asset.storageKey);
  return { asset, bytes, headers: { ...mediaHeaders(asset), "Content-Length": String(bytes.length) } };
}

// ── Deleting ───────────────────────────────────────────────────────────────────────────

/** How long a deleted asset's object is kept before it is purged (INF10: 30-day recovery). */
export const DELETED_ASSET_DAYS = 30;

/**
 * Removes an asset (the caller's UI asks for confirmation first — nothing is ever deleted
 * automatically, Q9). The link stops working at once and the space is freed; the object is
 * purged 30 days later. Idempotent.
 */
export async function deleteAsset(ctx: Ctx, assetId: string): Promise<void> {
  const [row] = await ctx.db.select().from(assets).where(eq(assets.id, z.string().min(1).max(64).parse(assetId)));
  if (!row) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireWrite(ctx, { ownerType: row.ownerType, ownerId: row.ownerId });
  await inTx(ctx, async (tx) => {
    const gone = await tx.db
      .update(assets)
      .set({ deletedAt: ctx.now })
      .where(and(eq(assets.id, row.id), isNull(assets.deletedAt), eq(assets.scanState, "clean")))
      .returning({ id: assets.id });
    if (gone.length === 0) return;
    await tx.db
      .update(storageUsage)
      .set({
        bytes: sql`greatest(${storageUsage.bytes} - ${row.bytes}, 0)`,
        files: sql`greatest(${storageUsage.files} - 1, 0)`,
        updatedAt: ctx.now,
      })
      .where(and(eq(storageUsage.ownerType, row.ownerType), eq(storageUsage.ownerId, row.ownerId)));
    await audit(tx, {
      action: "asset.deleted",
      objectType: "asset",
      objectId: row.id,
      meta: { ownerType: row.ownerType, ownerId: row.ownerId, bytes: row.bytes },
    });
  });
}

/**
 * Removes every asset of an owner (system only) — for the domain's own deletion flow when an
 * occasion, business or account is finally deleted.
 */
export async function deleteOwnerAssets(ctx: Ctx, owner: AssetOwner): Promise<number> {
  requireSystem(ctx);
  const o = ownerSchema.parse(owner);
  const rows = await ctx.db
    .select({ id: assets.id })
    .from(assets)
    .where(and(eq(assets.ownerType, o.ownerType), eq(assets.ownerId, o.ownerId), isNull(assets.deletedAt)));
  for (const r of rows) await deleteAsset(ctx, r.id);
  return rows.length;
}

// ── Retention ──────────────────────────────────────────────────────────────────────────

function registerRules(): void {
  registerRetentionRule({
    name: "assets-deleted-objects",
    run: async (ctx) => {
      const rows = await ctx.db
        .select()
        .from(assets)
        .where(
          and(
            isNotNull(assets.deletedAt),
            isNull(assets.purgedAt),
            lt(assets.deletedAt, addDays(ctx.now, -DELETED_ASSET_DAYS)),
          ),
        )
        .limit(500);
      const transport = await getStorageTransport();
      let n = 0;
      for (const row of rows) {
        if (row.storageKey) await transport.delete(bucketFor(row.kind), row.storageKey);
        await ctx.db.update(assets).set({ purgedAt: ctx.now }).where(eq(assets.id, row.id));
        n++;
      }
      return n;
    },
  });
  registerRetentionRule({
    // direct uploads that were started and never completed
    name: "assets-abandoned-uploads",
    run: async (ctx) => {
      const rows = await ctx.db
        .select()
        .from(assets)
        .where(and(eq(assets.scanState, "pending"), lt(assets.createdAt, addHours(ctx.now, -24))))
        .limit(500);
      const transport = await getStorageTransport();
      for (const row of rows) {
        if (row.storageKey) await transport.delete("private", row.storageKey);
        await ctx.db.delete(assets).where(and(eq(assets.id, row.id), eq(assets.scanState, "pending")));
      }
      return rows.length;
    },
  });
}
registerRules();

/** Called by @ed/jobs/registry in the worker. */
export function registerJobs(): void {
  registerRules();
}

// ── Upload purposes (what the generic web upload route accepts) ────────────────────────
// The browser never decides the owner type or whether PDFs are allowed: it names a purpose
// that a domain registered.
//
//   registerUploadPurpose("business.drawing", { ownerType: "business", allowPdf: true });

export type UploadPurpose = { ownerType: AssetOwnerType; allowPdf: boolean };
const gp = globalThis as unknown as { __edUploadPurposes?: Map<string, UploadPurpose> };
const purposes: Map<string, UploadPurpose> = (gp.__edUploadPurposes ??= new Map());

export function registerUploadPurpose(name: string, purpose: UploadPurpose): void {
  if (!/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9_-]+)*$/.test(name)) throw new Error("Invalid upload purpose");
  purposes.set(name, { ownerType: assetOwnerTypeSchema.parse(purpose.ownerType), allowPdf: purpose.allowPdf });
}
export function getUploadPurpose(name: string): UploadPurpose | undefined {
  return purposes.get(name);
}
if (!purposes.has("account.image")) registerUploadPurpose("account.image", { ownerType: "account", allowPdf: false });
