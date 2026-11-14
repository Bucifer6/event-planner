import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountCtx, makeCtx, systemCtx } from "@ed/core/context";
import { runRetention } from "@ed/core/retention";
import { and, assets, auditLog, eq, storageUsage } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  completeSignedUpload,
  createLocalTransport,
  createSignedUpload,
  deleteAsset,
  EICAR_TEST_STRING,
  FAIR_USE_BYTES,
  getAsset,
  getAssetUrl,
  getScanner,
  getUsage,
  listAssets,
  MAX_FILE_BYTES,
  mediaHeaders,
  openSignedAsset,
  registerAssetAccess,
  setScanner,
  setStorageTransport,
  sniffType,
  uploadAsset,
  type StorageTransport,
} from "../src/index";

let t: TestDb;
let dir: string;
let local: StorageTransport;

const OWNER = "acc_owner";
const MEMBER = "acc_member";

beforeAll(async () => {
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-0123";
  process.env.APP_URL = "https://app.example.test";
  process.env.MEDIA_URL = "https://media.example.test";
  t = await setupTestDb();
  dir = await mkdtemp(join(tmpdir(), "ed-storage-test-"));
  local = createLocalTransport(dir);
  setStorageTransport(local);
  // the occasion/business domains register these in the real app
  const rule = {
    canRead: async (ctx: Parameters<Parameters<typeof registerAssetAccess>[1]["canRead"]>[0]) =>
      ctx.actor.kind === "account" && [OWNER, MEMBER].includes(ctx.actor.accountId),
    canWrite: async (ctx: Parameters<Parameters<typeof registerAssetAccess>[1]["canWrite"]>[0]) =>
      ctx.actor.kind === "account" && ctx.actor.accountId === OWNER,
  };
  registerAssetAccess("occasion", rule);
  registerAssetAccess("business", rule);
});
afterAll(async () => {
  setStorageTransport(null);
  setScanner(null);
  await rm(dir, { recursive: true, force: true });
  await t.close();
});

const owner = (now?: Date) => accountCtx(t.db, OWNER, { now });

const SECRET_MARK = "SECRET-GPS-45.6427N-25.5887E";

async function jpegWithExif(w = 64, h = 48): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 30, b: 60 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: SECRET_MARK, Artist: "Jane Private", ImageDescription: SECRET_MARK } })
    .toBuffer();
}
async function png(w = 40, h = 40): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 80, b: 160, alpha: 1 } } })
    .png()
    .withExif({ IFD0: { Copyright: SECRET_MARK } })
    .toBuffer();
}
/** Incompressible image so the stored size is predictable-ish and large. */
async function noisyJpeg(side: number): Promise<Buffer> {
  const raw = Buffer.alloc(side * side * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return sharp(raw, { raw: { width: side, height: side, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}
const pdf = (extra = "") =>
  Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/OpenAction<</S/JavaScript/JS(app.alert\\(1\\))>>>>endobj\n${extra}\n%%EOF\n`, "latin1");

const stored = (a: { kind: "image" | "pdf"; storageKey: string }) =>
  local.get(a.kind === "pdf" ? "media" : "private", a.storageKey);

describe("upload pipeline (SEC4)", () => {
  it("re-encodes JPEG and PNG: EXIF and anything appended to the file are gone", async () => {
    const original = Buffer.concat([await jpegWithExif(), Buffer.from("<script>alert(1)</script>PK\u0003\u0004")]);
    expect(original.includes(SECRET_MARK)).toBe(true);
    expect((await sharp(original).metadata()).exif).toBeDefined();

    const a = await uploadAsset(owner(), {
      ownerType: "occasion",
      ownerId: "occ_1",
      file: { name: "../../poza mea.JPG", bytes: original, mime: "text/html" },
    });
    expect(a).toMatchObject({ kind: "image", mime: "image/jpeg", scanState: "clean", name: "poza mea.JPG" });
    expect(a.visibleAt).not.toBeNull();
    const out = await stored(a);
    expect(out.equals(original)).toBe(false);
    expect(out.includes(SECRET_MARK)).toBe(false);
    expect(out.includes("Jane Private")).toBe(false);
    expect(out.includes("<script>")).toBe(false);
    const meta = await sharp(out).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([64, 48]);
    expect(a.bytes).toBe(out.length);

    const p = await uploadAsset(owner(), { ownerType: "occasion", ownerId: "occ_1", file: { name: "a.png", bytes: await png() } });
    const pout = await stored(p);
    expect(p.mime).toBe("image/png");
    expect(pout.includes(SECRET_MARK)).toBe(false);
    expect((await sharp(pout).metadata()).exif).toBeUndefined();
  });

  it("decides the type by magic bytes and refuses everything else", async () => {
    expect(sniffType(Buffer.from("GIF89a..."))).toBeNull();
    const up = (bytes: Buffer, name: string, allowPdf = false) =>
      uploadAsset(owner(), { ownerType: "occasion", ownerId: "occ_1", file: { name, bytes, mime: "image/png" }, allowPdf });
    await expect(up(Buffer.from("<svg onload=alert(1)>"), "x.png")).rejects.toMatchObject({ code: "VALIDATION", messageKey: "platform.upload.type" });
    await expect(up(Buffer.from("MZ\u0090\u0000 exe"), "x.jpg", true)).rejects.toMatchObject({ messageKey: "platform.upload.typeWithPdf" });
    // a PDF where PDFs are not allowed
    await expect(up(pdf(), "x.pdf")).rejects.toMatchObject({ messageKey: "platform.upload.type" });
    // PNG signature followed by garbage is not an image
    await expect(up(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("nope")]), "x.png")).rejects.toMatchObject({ messageKey: "platform.upload.unreadableImage" });
    await expect(up(Buffer.alloc(0), "x.png")).rejects.toMatchObject({ messageKey: "platform.upload.empty" });
    await expect(up(Buffer.concat([pdf(), Buffer.alloc(MAX_FILE_BYTES)]), "big.pdf", true)).rejects.toMatchObject({ messageKey: "platform.upload.tooLarge" });
  });

  it("stores PDFs as they are and serves them only as sandboxed downloads from the media origin", async () => {
    const bytes = pdf();
    const a = await uploadAsset(owner(), {
      ownerType: "business",
      ownerId: "biz_1",
      file: { name: 'ofertă "nuntă".pdf', bytes },
      allowPdf: true,
    });
    expect(a.kind).toBe("pdf");
    expect((await stored(a)).equals(bytes)).toBe(true);
    expect(a.storageKey.startsWith("assets/business/")).toBe(true);

    const url = new URL(await getAssetUrl(owner(), a.id));
    expect(url.origin).toBe("https://media.example.test");
    expect(url.pathname).toBe(`/api/media/${a.id}/file.pdf`);

    const served = await openSignedAsset(
      { db: t.db, now: new Date() },
      { assetId: a.id, expires: Number(url.searchParams.get("e")), signature: url.searchParams.get("s")! },
    );
    expect(served.bytes.equals(bytes)).toBe(true);
    const h = served.headers;
    expect(h["Content-Disposition"]).toMatch(/^attachment; filename="/);
    expect(h["Content-Disposition"]).not.toContain("inline");
    expect(h["Content-Disposition"]).toContain("filename*=UTF-8''ofert%C4%83");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Content-Security-Policy"]).toContain("sandbox");
    expect(h["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(h["Content-Type"]).toBe("application/pdf");
    // images are inline but equally sandboxed and non-sniffable
    const img = mediaHeaders({ kind: "image", mime: "image/png", name: "a.png", bytes: 1 });
    expect(img["Content-Disposition"]).toMatch(/^inline/);
    expect(img["X-Content-Type-Options"]).toBe("nosniff");
    expect(img["Content-Security-Policy"]).toContain("sandbox");
  });

  it("links are scoped and expire; a forged or old link is NOT_FOUND", async () => {
    const a = await uploadAsset(owner(), { ownerType: "occasion", ownerId: "occ_1", file: { name: "a.png", bytes: await png() } });
    const now = new Date("2026-06-01T10:00:00Z");
    const url = new URL(await getAssetUrl(owner(now), a.id, { ttlSeconds: 60 }));
    expect(url.origin).toBe("https://app.example.test"); // images stay on the app origin
    const link = { assetId: a.id, expires: Number(url.searchParams.get("e")), signature: url.searchParams.get("s")! };
    expect((await openSignedAsset({ db: t.db, now }, link)).asset.id).toBe(a.id);
    await expect(openSignedAsset({ db: t.db, now: new Date(now.getTime() + 61_000) }, link)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(openSignedAsset({ db: t.db, now }, { ...link, expires: link.expires + 3600 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(openSignedAsset({ db: t.db, now }, { ...link, assetId: "other" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(openSignedAsset({ db: t.db, now }, { ...link, signature: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the owner type's access rule decides who reads and who uploads", async () => {
    const a = await uploadAsset(owner(), { ownerType: "occasion", ownerId: "occ_1", file: { name: "a.png", bytes: await png() } });
    const member = accountCtx(t.db, MEMBER);
    const stranger = accountCtx(t.db, "acc_stranger");
    expect((await getAsset(member, a.id)).id).toBe(a.id);
    await expect(getAssetUrl(stranger, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listAssets(stranger, { ownerType: "occasion", ownerId: "occ_1" })).toEqual([]);
    const up = (ctx: ReturnType<typeof accountCtx>, ownerType: "occasion" | "account", ownerId: string) =>
      png().then((bytes) => uploadAsset(ctx, { ownerType, ownerId, file: { name: "a.png", bytes } }));
    await expect(up(member, "occasion", "occ_1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(up(stranger, "occasion", "occ_1")).rejects.toMatchObject({ code: "FORBIDDEN" });
    // an account's own files: only that account
    const mine = await up(stranger, "account", "acc_stranger");
    await expect(getAsset(owner(), mine.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(up(stranger, "account", OWNER)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // external assistants never upload
    const mcp = makeCtx(t.db, { kind: "mcp", accountId: OWNER, tokenId: "tok", scope: "read_propose" });
    await expect(up(mcp as never, "occasion", "occ_1")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("malware scan gate (SEC4)", () => {
  it("an infected file never becomes visible and no bytes are stored", async () => {
    const before = (await readdir(dir, { recursive: true })).length;
    const infected = pdf(EICAR_TEST_STRING);
    await expect(
      uploadAsset(owner(), { ownerType: "business", ownerId: "biz_scan", file: { name: "virus.pdf", bytes: infected }, allowPdf: true }),
    ).rejects.toMatchObject({ code: "VALIDATION", messageKey: "platform.upload.infected" });
    const rows = await t.db.select().from(assets).where(eq(assets.ownerId, "biz_scan"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ scanState: "infected", visibleAt: null, storageKey: "" });
    expect((await readdir(dir, { recursive: true })).length).toBe(before);
    // not listed, not linkable, not served, does not count towards fair use
    expect(await listAssets(owner(), { ownerType: "business", ownerId: "biz_scan" })).toEqual([]);
    await expect(getAssetUrl(owner(), rows[0]!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getAssetUrl(systemCtx(t.db), rows[0]!.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getUsage(owner(), { ownerType: "business", ownerId: "biz_scan" })).bytes).toBe(0);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.objectId, rows[0]!.id));
    expect(audits.map((a) => a.action)).toEqual(["asset.infected"]);
  });

  it("if the scanner cannot answer, nothing is stored or visible", async () => {
    setScanner({
      name: "down",
      scan: async () => {
        throw new (await import("../src/scan")).ScannerUnavailableError("down");
      },
    });
    try {
      await expect(
        uploadAsset(owner(), { ownerType: "business", ownerId: "biz_down", file: { name: "a.png", bytes: await png() } }),
      ).rejects.toMatchObject({ code: "CONFLICT", messageKey: "platform.upload.scanUnavailable" });
      expect(await t.db.select().from(assets).where(eq(assets.ownerId, "biz_down"))).toEqual([]);
    } finally {
      setScanner(null);
    }
  });

  it("production refuses to run without a configured scanner", () => {
    const prod = { NODE_ENV: "production", APP_URL: "https://app.eventdesk.ro" } as NodeJS.ProcessEnv;
    expect(() => getScanner({ ...prod, MALWARE_SCANNER: "none" })).toThrow(/scanner/i);
    expect(() => getScanner({ ...prod })).toThrow(/scanner/i);
    expect(getScanner({ ...prod, MALWARE_SCANNER: "command", MALWARE_SCANNER_COMMAND: "true" }).name).toBe("command");
    expect(getScanner({ NODE_ENV: "development" } as NodeJS.ProcessEnv).name).toBe("dev");
  });

  it("the command scanner seam maps exit codes to verdicts", async () => {
    const { commandScanner } = await import("../src/scan");
    expect(await commandScanner("true").scan(Buffer.from("x"))).toBe("clean");
    expect(await commandScanner("false").scan(Buffer.from("x"))).toBe("infected");
    await expect(commandScanner("exit 2 #").scan(Buffer.from("x"))).rejects.toThrow(/unavailable/i);
    expect(await commandScanner("grep -q EICAR && exit 1 || exit 0 <").scan(Buffer.from("clean"))).toBe("clean");
  });
});

describe("fair use (Q6, Q9)", () => {
  it("has the PRD limits", () => {
    expect(FAIR_USE_BYTES.occasion).toBe(100 * 1024 * 1024);
    expect(FAIR_USE_BYTES.business).toBe(200 * 1024 * 1024);
    expect(MAX_FILE_BYTES).toBe(10 * 1024 * 1024);
  });

  it("counts at upload; over the limit names the largest asset and deletes nothing", async () => {
    const o = { ownerType: "business" as const, ownerId: "biz_limit" };
    const small = await uploadAsset(owner(), { ...o, file: { name: "mic.jpg", bytes: await noisyJpeg(64) } });
    const big = await uploadAsset(owner(), { ...o, file: { name: "plan mare.jpg", bytes: await noisyJpeg(400) } });
    expect(big.bytes).toBeGreaterThan(small.bytes);
    const usage = await getUsage(owner(), o);
    expect(usage).toMatchObject({ bytes: small.bytes + big.bytes, files: 2, limitBytes: 200 * 1024 * 1024 });

    const limitBytes = usage.bytes + 1000; // room for 1000 more bytes only
    const next = await noisyJpeg(300);
    const err = await uploadAsset(owner(), { ...o, file: { name: "inca una.jpg", bytes: next } }, { limitBytes }).catch((e) => e);
    expect(err).toMatchObject({ code: "LIMIT", messageKey: "platform.upload.overLimit" });
    expect(err.details.params.asset).toBe("plan mare.jpg");
    expect(err.details.largestAsset).toMatchObject({ id: big.id, name: "plan mare.jpg", bytes: big.bytes });
    // nothing was deleted, nothing was added, the refused object is not left in the store
    expect((await listAssets(owner(), o)).map((a) => a.id).sort()).toEqual([small.id, big.id].sort());
    expect(await getUsage(owner(), o)).toMatchObject({ bytes: usage.bytes, files: 2 });
    expect(await stored(big)).toBeInstanceOf(Buffer);
    const files = await readdir(join(dir, "private", "assets", "business", "bizlimit"));
    expect(files).toHaveLength(2);

    // the user removes the named asset (their choice), then the upload fits
    await deleteAsset(owner(), big.id);
    await deleteAsset(owner(), big.id); // idempotent
    expect(await getUsage(owner(), o)).toMatchObject({ bytes: small.bytes, files: 1 });
    await expect(getAssetUrl(owner(), big.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ok = await uploadAsset(owner(), { ...o, file: { name: "inca una.jpg", bytes: next } }, { limitBytes });
    expect(ok.scanState).toBe("clean");

    // the deleted object is kept 30 days (recoverable), then purged by retention
    expect(await stored(big)).toBeInstanceOf(Buffer);
    await runRetention(systemCtx(t.db, { now: new Date(Date.now() + 31 * 86_400_000) }));
    await expect(stored(big)).rejects.toThrow();
    const [row] = await t.db.select().from(assets).where(eq(assets.id, big.id));
    expect(row!.purgedAt).not.toBeNull();
  });

  it("parallel uploads cannot overshoot the limit together", async () => {
    const o = { ownerType: "occasion" as const, ownerId: "occ_race" };
    const bytes = await noisyJpeg(200);
    const one = await uploadAsset(owner(), { ...o, file: { name: "0.jpg", bytes } });
    const limitBytes = one.bytes * 3; // room for two more
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => uploadAsset(owner(), { ...o, file: { name: `${i + 1}.jpg`, bytes } }, { limitBytes })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const [u] = await t.db.select().from(storageUsage).where(and(eq(storageUsage.ownerType, "occasion"), eq(storageUsage.ownerId, "occ_race")));
    expect(u).toMatchObject({ bytes: one.bytes * 3, files: 3 });
  });
});

describe("direct signed uploads", () => {
  it("the object is invisible until the same pipeline has passed", async () => {
    const puts = new Map<string, Buffer>();
    const fake: StorageTransport = {
      ...local,
      name: "fake-s3",
      presignPut: async (_b, key) => `https://s3.example.test/${key}?X-Amz-Signature=abc`,
      get: async (b, key, max) => (puts.has(key) ? puts.get(key)! : local.get(b, key, max)),
      delete: async (b, key) => {
        puts.delete(key);
        await local.delete(b, key);
      },
    };
    setStorageTransport(fake);
    try {
      const o = { ownerType: "occasion" as const, ownerId: "occ_direct" };
      const up = await createSignedUpload(owner(), { ...o, name: "direct.jpg", bytes: 5000, mime: "image/jpeg" });
      expect(up.uploadUrl).toContain(`incoming/${up.assetId}`);
      await expect(getAssetUrl(owner(), up.assetId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await listAssets(owner(), o)).toEqual([]);
      puts.set(`incoming/${up.assetId}`, await jpegWithExif()); // the browser PUTs the file
      const a = await completeSignedUpload(owner(), { assetId: up.assetId });
      expect(a).toMatchObject({ id: up.assetId, scanState: "clean", kind: "image" });
      expect((await stored(a)).includes(SECRET_MARK)).toBe(false);
      expect(puts.size).toBe(0); // quarantine object removed
      expect((await completeSignedUpload(owner(), { assetId: up.assetId })).id).toBe(a.id); // repeat = same
      expect((await getUsage(owner(), o)).files).toBe(1);

      // what was really uploaded decides, not what was declared: an infected "image"
      const bad = await createSignedUpload(owner(), { ...o, name: "x.jpg", bytes: 100, mime: "image/jpeg" });
      puts.set(`incoming/${bad.assetId}`, pdf(EICAR_TEST_STRING));
      await expect(completeSignedUpload(owner(), { assetId: bad.assetId })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(getAssetUrl(owner(), bad.assetId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(createSignedUpload(owner(), { ...o, name: "x.pdf", bytes: 100, mime: "application/pdf" })).rejects.toMatchObject({ code: "VALIDATION" });
      await expect(createSignedUpload(owner(), { ...o, name: "x.jpg", bytes: MAX_FILE_BYTES + 1, mime: "image/jpeg" })).rejects.toMatchObject({ code: "VALIDATION" });
    } finally {
      setStorageTransport(local);
    }
  });

  it("is refused on the local transport (use the web upload route there)", async () => {
    await expect(
      createSignedUpload(owner(), { ownerType: "occasion", ownerId: "occ_direct", name: "a.jpg", bytes: 10, mime: "image/jpeg" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
