import { createHmac, timingSafeEqual } from "node:crypto";

// Scoped, expiring read links (INF3): /api/media/<assetId>/<name>?e=<unix seconds>&s=<hmac>.
// The link is the capability (the media origin has no cookies), so it is short-lived.

function key(): Buffer {
  const secret = process.env.STORAGE_URL_SECRET || process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("Missing environment variable: SESSION_SECRET");
  }
  return createHmac("sha256", secret).update("ed-storage-url-v1").digest();
}

export function signAssetLink(assetId: string, expiresAtSeconds: number): string {
  return createHmac("sha256", key()).update(`${assetId}.${expiresAtSeconds}`).digest("base64url");
}

export function verifyAssetLink(
  assetId: string,
  expiresAtSeconds: number,
  signature: string,
  now: Date,
): boolean {
  if (!Number.isSafeInteger(expiresAtSeconds) || expiresAtSeconds * 1000 < now.getTime()) return false;
  const expected = Buffer.from(signAssetLink(assetId, expiresAtSeconds));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
