import { AppError } from "@ed/shared/errors";
import { toMinor } from "@ed/shared/money";

/**
 * A typed amount → minor units. Accepts Romanian and English habits: "1.250", "1250,50",
 * "1 250,5", "1,250.50", "1250.5". Returns null for an empty field (= unknown), and
 * "invalid" when it is not an amount.
 */
export function parseAmount(raw: string | undefined | null): number | null | "invalid" {
  const s = (raw ?? "").replace(/[\s  ]/g, "").replace(/(RON|lei)$/i, "");
  if (s === "") return null;
  if (!/^\d[\d.,]*$/.test(s)) return "invalid";
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let normal: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // both present: the last one is the decimal separator
    const dec = lastDot > lastComma ? "." : ",";
    const group = dec === "." ? "," : ".";
    normal = s.split(group).join("").replace(dec, ".");
  } else if (lastComma >= 0) {
    // only commas: "1250,50" is a decimal; "1,250" / "1,250,000" are English thousands
    normal = /^\d{1,3}(,\d{3})+$/.test(s) ? s.split(",").join("") : s.replace(",", ".");
    if ((normal.match(/\./g) ?? []).length > 1) return "invalid";
  } else if (lastDot >= 0) {
    // only dots: "1.250" / "1.250.000" are Romanian thousands; "1250.5" is a decimal
    normal = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.split(".").join("") : s;
    if ((normal.match(/\./g) ?? []).length > 1) return "invalid";
  } else {
    normal = s;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normal)) return "invalid";
  try {
    return toMinor(normal);
  } catch {
    return "invalid";
  }
}

/** Required amount > 0, or a VALIDATION error beside `field`. */
export function requireAmount(raw: string | undefined, field: string, ns: "budget" | "ledger" = "budget"): number {
  const v = parseAmount(raw);
  if (v === "invalid") throw new AppError("VALIDATION", "budget.errors.amountInvalid", { fieldErrors: { [field]: ["budget.errors.amountInvalid"] } });
  if (v === null || v <= 0) throw new AppError("VALIDATION", `${ns}.errors.amountRequired`, { fieldErrors: { [field]: [`${ns}.errors.amountRequired`] } });
  return v;
}

/** Optional amount ≥ 0: null when left empty (unknown). */
export function optionalAmount(raw: string | undefined, field: string): number | null {
  const v = parseAmount(raw);
  if (v === "invalid") throw new AppError("VALIDATION", "budget.errors.amountInvalid", { fieldErrors: { [field]: ["budget.errors.amountInvalid"] } });
  return v;
}

/** Minor units → the text to put back in an amount field ("1250,50" / "1250.50"). */
export function amountFieldValue(minor: number | null, locale: string): string {
  if (minor === null) return "";
  const whole = Math.floor(minor / 100);
  const frac = minor % 100;
  return frac ? `${whole}${locale === "en" ? "." : ","}${String(frac).padStart(2, "0")}` : String(whole);
}
