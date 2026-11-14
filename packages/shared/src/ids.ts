import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";

/** Primary-key id (cuid2): never sequential (SEC2). */
export function newId(): string {
  return createId();
}

/**
 * URL-safe random token. Default 32 bytes = 256 bits; never below 16 bytes (128 bits, SEC2).
 * Store only hashToken(token) (SEC8).
 */
export function randomToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16) {
    throw new RangeError("randomToken needs at least 16 bytes (128 bits)");
  }
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 hex of a token or code. Tokens and codes are stored only in this form (SEC8). */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time comparison of two hashToken() outputs. */
export function hashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Six-digit sign-in code, uniformly random, leading zeros kept ("004217"). */
export function sixDigitCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
