import { z } from "zod";
import { DEFAULT_CURRENCY } from "./money";

// Reusable zod pieces. Custom messages are i18n keys (see common.validation.*); the web
// action() wrapper translates them.

/** cuid2 primary key */
export const zId = z.string().regex(/^[a-z][a-z0-9]{7,31}$/, "common.validation.invalid");

/** Trimmed, required text with a length cap. */
export const zText = (max = 200) =>
  z.string().trim().min(1, "common.validation.required").max(max, "common.validation.tooLong");

/** Trimmed optional text: "" and whitespace become undefined. */
export const zOptionalText = (max = 2000) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(max, "common.validation.tooLong").optional(),
  );

/** Lower-cased, trimmed email. */
export const zEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "common.validation.tooLong")
  .pipe(z.email("common.validation.invalidEmail"));

/** Integer minor units (bani), may be negative. */
export const zMinor = z.number().int("common.validation.invalid").safe("common.validation.invalid");
/** Integer minor units >= 0. */
export const zMinorNonNegative = zMinor.min(0, "common.validation.tooSmall");

export const zCurrency = z
  .string()
  .regex(/^[A-Z]{3}$/, "common.validation.invalid")
  .default(DEFAULT_CURRENCY);

export const zLocale = z.enum(["ro", "en"]);

/** Client-generated idempotency key (Q4). */
export const zIdempotencyKey = z
  .string()
  .min(8, "common.validation.invalid")
  .max(200, "common.validation.invalid")
  .regex(/^[A-Za-z0-9_.:-]+$/, "common.validation.invalid");

/** Accepts a Date or an ISO string; yields a valid Date. */
export const zDate = z.coerce.date("common.validation.invalid");

/** HTML checkbox / "true" / "false" / boolean. */
export const zFormBoolean = z.preprocess(
  (v) =>
    v === "on" || v === "true" || v === "1"
      ? true
      : v === "false" || v === "0" || v === "" || v == null
        ? false
        : v,
  z.boolean(),
);

/** Text union + zod enum from one list (schema files: no pg enums). */
export function zEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values);
}
