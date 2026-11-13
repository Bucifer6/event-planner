import "server-only";
import { isAppError } from "@ed/shared/errors";
import { notFound } from "next/navigation";

/**
 * Runs a core read for a page. A non-member (NOT_FOUND) and a member without the needed role
 * or grant (FORBIDDEN) both get the same "not found" page — a page never confirms that
 * something exists to someone who may not see it (D2).
 */
export async function orNotFound<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (e) {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  }
}

/** "2026-06" → { year, month } or null. */
export function parseMonth(value: string | undefined): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month };
}

export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function dayKey(year: number, month: number, day: number): string {
  return `${monthKey(year, month)}-${String(day).padStart(2, "0")}`;
}
