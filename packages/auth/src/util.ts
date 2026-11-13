import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";
import type { DeviceType } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { hashToken } from "@ed/shared/ids";

export const CODE_TTL_MINUTES = 15;
export const CODE_TTL_MS = CODE_TTL_MINUTES * 60_000;
export const SESSION_MAX_MS = 30 * 24 * 60 * 60_000;
export const SESSION_IDLE_MS = 14 * 24 * 60 * 60_000;
export const SECOND_FACTOR_PENDING_MS = 15 * 60_000;
export const RECOVERY_CODE_COUNT = 10;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailLookupHash(email: string): string {
  return hashToken(normaliseEmail(email));
}

/** Codes are hashed together with their row id, so equal codes never share a hash. */
export function codeHash(rowId: string, code: string): string {
  return hashToken(`${rowId}:${code}`);
}

/** Keeps digits only ("123 456" -> "123456"). */
export function normaliseCode(code: string): string {
  return code.replace(/\D/g, "");
}

const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** "XXXXX-XXXXX", ~49 bits, no look-alike characters. */
export function newRecoveryCode(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += RECOVERY_ALPHABET[randomInt(0, RECOVERY_ALPHABET.length)];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

export function normaliseRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function recoveryCodeHash(accountId: string, code: string): string {
  return hashToken(`${accountId}:${normaliseRecoveryCode(code)}`);
}

const USERNAME_ALPHABET = "abcdefghjkmnpqrstvwxyz23456789";

/** Random username for anonymous accounts (S7): "ed-" + 10 characters. */
export function newUsername(): string {
  let s = "";
  for (let i = 0; i < 10; i++) s += USERNAME_ALPHABET[randomInt(0, USERNAME_ALPHABET.length)];
  return `ed-${s}`;
}

export function normaliseUsername(username: string): string {
  return username.trim().toLowerCase();
}

/** "Chrome · Android" style summary; the raw user-agent string is never stored. */
export function summariseUserAgent(ua: string | null | undefined): {
  deviceType: DeviceType;
  label: string | null;
} {
  if (!ua) return { deviceType: "unknown", label: null };
  const os = /iPhone|iPod/.test(ua)
    ? "iOS"
    : /iPad/.test(ua)
      ? "iPadOS"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /OPR\//.test(ua)
          ? "Opera"
          : /Chrome|CriOS/.test(ua)
            ? "Chrome"
            : /Safari/.test(ua)
              ? "Safari"
              : null;
  const deviceType: DeviceType = /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
    ? "tablet"
    : /Mobi|iPhone|iPod|Android/.test(ua)
      ? "phone"
      : os
        ? "desktop"
        : "unknown";
  const label = [browser, os].filter(Boolean).join(" · ") || null;
  return { deviceType, label };
}

/**
 * SEC1 timing band: every outcome of a sign-in request takes at least this long, so response
 * time says nothing about the address. 0 under NODE_ENV=test unless AUTH_TIMING_FLOOR_MS is set.
 */
export function timingFloorMs(): number {
  const configured = Number(process.env.AUTH_TIMING_FLOOR_MS);
  if (Number.isFinite(configured) && process.env.AUTH_TIMING_FLOOR_MS) return configured;
  return process.env.NODE_ENV === "test" ? 0 : 400;
}

export async function withTimingFloor<T>(fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const floor = timingFloorMs();
  try {
    return await fn();
  } finally {
    const left = floor - (Date.now() - started);
    if (left > 0) await new Promise((r) => setTimeout(r, left));
  }
}

function secretKey(purpose: string): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("Missing environment variable: SESSION_SECRET");
  }
  return createHash("sha256")
    .update(`${purpose}:${secret || "ed-dev-secret-not-for-production"}`)
    .digest();
}

/** AES-256-GCM, key derived from SESSION_SECRET. Output: base64url(iv | tag | ciphertext). */
export function seal(purpose: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(purpose), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal(purpose: string, sealed: string): string {
  const raw = Buffer.from(sealed, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(purpose), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

export function appUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** One generic failure for a wrong/expired/used/over-tried code (SEC1). */
export function codeInvalid(field = "code", key = "auth.errors.codeInvalid"): AppError {
  return new AppError("VALIDATION", key, { fieldErrors: { [field]: [key] } });
}

/** One identical failure for a wrong username OR a wrong password (S8). */
export function credentialsInvalid(): AppError {
  return new AppError("VALIDATION", "auth.errors.credentialsInvalid");
}
