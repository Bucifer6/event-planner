import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

// Where the bytes live (INF3). Two transports:
// - "local": files under STORAGE_DIR (development, tests, single-host installs)
// - "s3": any S3-compatible store; endpoint/region/buckets are operator decisions (env)
// Two buckets: "private" (images) and "media" (PDFs, served only from the media origin).
// Objects are never public: every read goes through the web media route with a signed link.

export type Bucket = "private" | "media";

export type StorageTransport = {
  name: string;
  put(bucket: Bucket, key: string, bytes: Buffer, contentType: string): Promise<void>;
  /** Rejects when the object is missing or larger than maxBytes. */
  get(bucket: Bucket, key: string, maxBytes?: number): Promise<Buffer>;
  delete(bucket: Bucket, key: string): Promise<void>;
  /** Signed PUT URL for a direct browser upload (S3 only). */
  presignPut?(bucket: Bucket, key: string, opts: { contentType: string; expiresInSeconds: number }): Promise<string>;
};

const KEY_RE = /^[a-z0-9][a-z0-9/_.-]{0,200}$/;
function assertKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("storage: invalid object key");
  }
}

export function createLocalTransport(dir: string): StorageTransport {
  const root = resolve(dir);
  const pathFor = (bucket: Bucket, key: string) => {
    assertKey(key);
    const p = resolve(join(root, bucket, key));
    if (!p.startsWith(root + sep)) throw new Error("storage: invalid object key");
    return p;
  };
  return {
    name: "local",
    async put(bucket, key, bytes) {
      const p = pathFor(bucket, key);
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, bytes, { mode: 0o600 });
    },
    async get(bucket, key, maxBytes) {
      const p = pathFor(bucket, key);
      if (maxBytes !== undefined && (await stat(p)).size > maxBytes) {
        throw new Error("storage: object too large");
      }
      return readFile(p);
    },
    async delete(bucket, key) {
      await rm(pathFor(bucket, key), { force: true });
    },
  };
}

export type S3Config = {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketPrivate: string;
  bucketMedia: string;
  forcePathStyle: boolean;
  /** Optional customer-managed key for SSE-KMS (INF12); otherwise the bucket default applies. */
  sseKmsKeyId?: string;
};

export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const bucketPrivate = env.S3_BUCKET_PRIVATE?.trim();
  if (!bucketPrivate) return null;
  const missing = ["S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET_MEDIA"].filter(
    (n) => !env[n]?.trim(),
  );
  // names only, never values (SEC13)
  if (missing.length > 0) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  return {
    endpoint: env.S3_ENDPOINT?.trim() || undefined,
    region: env.S3_REGION!.trim(),
    accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim(),
    bucketPrivate,
    bucketMedia: env.S3_BUCKET_MEDIA!.trim(),
    forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE === "true" : Boolean(env.S3_ENDPOINT),
    sseKmsKeyId: env.S3_SSE_KMS_KEY_ID?.trim() || undefined,
  };
}

export async function createS3Transport(config: S3Config): Promise<StorageTransport> {
  // Loaded lazily so development and tests never touch the AWS SDK.
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = await import(
    "@aws-sdk/client-s3"
  );
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const bucketName = (b: Bucket) => (b === "media" ? config.bucketMedia : config.bucketPrivate);
  const sse = config.sseKmsKeyId
    ? ({ ServerSideEncryption: "aws:kms", SSEKMSKeyId: config.sseKmsKeyId } as const)
    : {};
  return {
    name: "s3",
    async put(bucket, key, bytes, contentType) {
      assertKey(key);
      await client.send(
        new PutObjectCommand({
          Bucket: bucketName(bucket),
          Key: key,
          Body: bytes,
          ContentType: contentType,
          ...sse,
        }),
      );
    },
    async get(bucket, key, maxBytes) {
      assertKey(key);
      const res = await client.send(new GetObjectCommand({ Bucket: bucketName(bucket), Key: key }));
      if (maxBytes !== undefined && (res.ContentLength ?? 0) > maxBytes) {
        throw new Error("storage: object too large");
      }
      if (!res.Body) throw new Error("storage: empty object");
      return Buffer.from(await res.Body.transformToByteArray());
    },
    async delete(bucket, key) {
      assertKey(key);
      await client.send(new DeleteObjectCommand({ Bucket: bucketName(bucket), Key: key }));
    },
    async presignPut(bucket, key, opts) {
      assertKey(key);
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucketName(bucket),
          Key: key,
          ContentType: opts.contentType,
          ...sse,
        }),
        { expiresIn: opts.expiresInSeconds },
      );
    },
  };
}

const g = globalThis as unknown as { __edStorage?: Promise<StorageTransport> | null };

/** Replace the transport (tests, or an operator-specific implementation). */
export function setStorageTransport(transport: StorageTransport | null): void {
  g.__edStorage = transport ? Promise.resolve(transport) : null;
}

/**
 * The process-wide transport: S3 when S3_BUCKET_PRIVATE is set, otherwise local files in
 * STORAGE_DIR. In production the local transport must be chosen explicitly (STORAGE_DIR).
 */
export function getStorageTransport(): Promise<StorageTransport> {
  if (!g.__edStorage) {
    g.__edStorage = (async () => {
      const s3 = s3ConfigFromEnv();
      if (s3) return createS3Transport(s3);
      const dir = process.env.STORAGE_DIR?.trim();
      if (!dir && process.env.NODE_ENV === "production") {
        throw new Error("Missing environment variables: S3_BUCKET_PRIVATE or STORAGE_DIR");
      }
      return createLocalTransport(dir || join(tmpdir(), "eventdesk-storage"));
    })();
    g.__edStorage.catch(() => {
      g.__edStorage = null;
    });
  }
  return g.__edStorage;
}
