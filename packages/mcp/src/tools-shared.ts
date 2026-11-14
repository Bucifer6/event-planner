import { translate } from "@ed/i18n";
import { z } from "zod";
import type { McpCtx } from "./registry";

// Shared shapes of the tool catalogue. Results are compact JSON with stable field names:
// dates as ISO strings, days as "YYYY-MM-DD", money as { amountMinor, currency } and
// null = unknown (never 0 for an amount nobody entered).

export const zOccasionId = z.string().min(1).max(64).describe("Occasion id (from whoami or list_occasions).");
export const zDayInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Calendar day "YYYY-MM-DD" in the occasion\'s time zone.');
export const zLimit = (max: number, def: number) => z.number().int().min(1).max(max).default(def).describe(`Page size (1–${max}, default ${def}).`);
export const zOffset = z.number().int().min(0).max(100_000).default(0).describe("Rows to skip (paging).");

export type Money = { amountMinor: number; currency: string };

/** null = unknown. Amounts are minor units (bani for RON). */
export function money(minor: number | null | undefined, currency: string): Money | null {
  return minor === null || minor === undefined ? null : { amountMinor: Number(minor), currency };
}

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

type DeltaText = string | { key: string; params?: Record<string, string | number> } | null | undefined;

/** A What-if text (plain or i18n key) in the token owner's language. */
export function whatIfText(ctx: McpCtx, text: DeltaText): string | null {
  if (text === null || text === undefined) return null;
  return typeof text === "string" ? text : translate(ctx.locale, text.key, text.params);
}
