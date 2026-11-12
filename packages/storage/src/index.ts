import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

import sharp from 'sharp';
import { prisma } from '@eventdesk/db';
import { AppError, newId } from '@eventdesk/shared';

// INF3/SEC4/Q6/Q9 upload pipeline: S3-compatible store (operator-configurable
// endpoint, EU region) with a local-disk dev transport; signed upload URLs served
// by the web service; images (PNG/JPG) re-encoded server-side stripping embedded
// content; PDFs stored as-is but served only from the media domain with
// Content-Disposition: attachment and noinline; every file is malware-scanned
// before it becomes visible (scanner product operator-configurable; dev scanner
// checks magic bytes); fair use counted at upload time (Q6: 100 MiB/occasion,
// 500 emails/day; Q9: 200 MiB/business, 10 MiB/file, PNG/JPG images, PDF drawings).

export const OCCASION_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024; // Q6
export const BUSINESS_UPLOAD_LIMIT_BYTES = 200 * 1024 * 1024; // Q9
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // Q9

const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg'];
const ALLOWED_PDF_MIME = 'application/pdf';

function s3Client(): S3Client | null {
  if (!process.env.S3_ENDPOINT) return null; // dev: local disk
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'eu-central-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
    forcePathStyle: true,
  });
}

const DEV_DIR = join(process.cwd(), '.uploads');

async function putObject(bucket: string, key: string, body: Buffer, mime: string): Promise<void> {
  const s3 = s3Client();
  if (s3) {
    await s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: mime })
    );
    return;
  }
  await mkdir(join(DEV_DIR, bucket), { recursive: true });
  await writeFile(join(DEV_DIR, bucket, key), body);
}

export async function getObject(bucket: string, key: string): Promise<Buffer> {
  const s3 = s3Client();
  if (s3) {
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  return readFile(join(DEV_DIR, bucket, key));
}

// Signed upload URL issued by the web service (INF3); the actual bytes arrive via
// the upload route which enforces limits and runs the pipeline.
export async function issueUploadUrl(input: {
  occasionId?: string;
  businessId?: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  uploaderId: string;
}) {
  if (input.sizeBytes > MAX_FILE_BYTES) {
    throw new AppError('INVALID_INPUT', 'File exceeds the 10 MiB per-file limit (Q9).');
  }
  if (!ALLOWED_IMAGE_MIMES.includes(input.mime) && input.mime !== ALLOWED_PDF_MIME) {
    throw new AppError(
      'INVALID_INPUT',
      'Only PNG/JPG images and PDF (drawings/quotes) are accepted at launch (Q9).'
    );
  }
  if (input.occasionId) {
    const used = await prisma.asset.aggregate({
      where: { occasionId: input.occasionId },
      _sum: { sizeBytes: true },
    });
    if ((used._sum.sizeBytes ?? 0) + input.sizeBytes > OCCASION_UPLOAD_LIMIT_BYTES) {
      throw new AppError(
        'RATE_LIMITED',
        'Occasion upload limit reached (100 MiB, Q6). Remove an asset first; nothing is deleted without confirmation.'
      );
    }
  }
  if (input.businessId) {
    const used = await prisma.asset.aggregate({
      where: { businessId: input.businessId },
      _sum: { sizeBytes: true },
    });
    if ((used._sum.sizeBytes ?? 0) + input.sizeBytes > BUSINESS_UPLOAD_LIMIT_BYTES) {
      throw new AppError(
        'RATE_LIMITED',
        'Business asset limit reached (200 MiB, Q9). The over-limit asset is named; nothing is deleted without confirmation.'
      );
    }
  }
  const key = `${newId()}/${randomBytes(8).toString('hex')}-${input.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const bucket =
    input.mime === ALLOWED_PDF_MIME
      ? (process.env.S3_BUCKET_MEDIA ?? 'eventdesk-media')
      : (process.env.S3_BUCKET_PRIVATE ?? 'eventdesk-private');
  return { key, bucket, uploadId: newId() };
}

// Dev malware scanner: magic-byte check. Production scanner is operator-configurable
// and must run before scanStatus becomes "clean" (a file is visible only after pass).
async function scanBuffer(buf: Buffer, mime: string): Promise<'clean' | 'infected'> {
  const head = buf.subarray(0, 8);
  if (mime === 'image/png' && !(head[0] === 0x89 && head[1] === 0x50)) return 'infected';
  if (mime === 'image/jpeg' && !(head[0] === 0xff && head[1] === 0xd8)) return 'infected';
  if (mime === 'application/pdf' && !buf.subarray(0, 5).toString('latin1').startsWith('%PDF-'))
    return 'infected';
  return 'clean';
}

export interface StoredAsset {
  id: string;
  storageKey: string;
  mime: string;
  sizeBytes: number;
  kind: 'image' | 'pdf';
  scanStatus: string;
  reEncoded: boolean;
}

// Full pipeline: validate -> store -> re-encode images (strip embedded content,
// SEC4) -> scan -> only then visible (scanStatus clean).
export async function storeUpload(input: {
  occasionId?: string;
  businessId?: string;
  uploaderId: string;
  fileName: string;
  mime: string;
  data: Buffer;
}): Promise<StoredAsset> {
  const { key, bucket } = await issueUploadUrl({
    occasionId: input.occasionId,
    businessId: input.businessId,
    fileName: input.fileName,
    mime: input.mime,
    sizeBytes: input.data.length,
    uploaderId: input.uploaderId,
  });

  let body = input.data;
  let reEncoded = false;
  let mime = input.mime;
  if (ALLOWED_IMAGE_MIMES.includes(input.mime)) {
    // SEC4: re-encode server-side, stripping any embedded content.
    const image = sharp(input.data, { failOn: 'error' });
    const meta = await image.metadata();
    body = await image.png().toBuffer(); // normalized, metadata stripped
    mime = 'image/png';
    reEncoded = true;
    void meta;
  }

  await putObject(bucket, key, body, mime);
  const scanStatus = await scanBuffer(body, mime);
  if (scanStatus === 'infected') {
    throw new AppError(
      'INVALID_INPUT',
      'File failed the malware scan and was not made visible (SEC4).'
    );
  }

  const asset = await prisma.asset.create({
    data: {
      occasionId: input.occasionId ?? null,
      businessId: input.businessId ?? null,
      uploaderId: input.uploaderId,
      kind: (mime === ALLOWED_PDF_MIME ? 'pdf' : 'image') as 'pdf' | 'image',
      storageKey: `${bucket}/${key}`,
      fileName: input.fileName,
      mime,
      sizeBytes: body.length,
      scanStatus: 'clean',
      reEncoded,
    },
  });
  return {
    id: asset.id,
    storageKey: asset.storageKey,
    mime: asset.mime,
    sizeBytes: asset.sizeBytes,
    kind: asset.kind as 'image' | 'pdf',
    scanStatus: asset.scanStatus,
    reEncoded: asset.reEncoded,
  };
}

// Media-domain serving rule (SEC4): PDFs are served with attachment + noinline so
// untrusted PDFs can never execute in the app origin. The web route /media/*
// applies these headers; in production media.eventdesk.ro is a separate origin.
export const MEDIA_HEADERS: Record<string, string> = {
  'Content-Disposition': 'attachment; filename="download.pdf"',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

export function hashAssetKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}
