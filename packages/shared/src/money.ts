// Money is integer minor units (bani) + a currency code. Never floats, never 0 for "unknown"
// (unknown is null and is handled by the caller).

export const DEFAULT_CURRENCY = "RON";
export type Currency = string;
export type Money = { amount: number; currency: Currency };

const MINOR_DIGITS: Record<string, number> = { RON: 2, EUR: 2, USD: 2, GBP: 2, HUF: 2 };

export function minorDigits(currency: Currency = DEFAULT_CURRENCY): number {
  return MINOR_DIGITS[currency] ?? 2;
}

function assertMinor(n: number): void {
  if (!Number.isSafeInteger(n))
    throw new RangeError("money amounts must be safe integers (minor units)");
}

/** 19.9 -> 1990, "1990.5" -> 199050. Rounds half away from zero to the minor unit. */
export function toMinor(major: number | string, currency: Currency = DEFAULT_CURRENCY): number {
  const digits = minorDigits(currency);
  const s = typeof major === "number" ? major.toFixed(digits + 4) : major.trim().replace(",", ".");
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new RangeError("not a decimal amount");
  const neg = m[1] === "-";
  const frac = (m[3] ?? "").padEnd(digits + 1, "0");
  let minor = Number(m[2]) * 10 ** digits + Number(frac.slice(0, digits) || "0");
  if (Number(frac[digits]) >= 5) minor += 1;
  assertMinor(minor);
  return neg && minor !== 0 ? -minor : minor;
}

/** 199050 -> 1990.5 (display/maths convenience only; never store the result). */
export function toMajor(minor: number, currency: Currency = DEFAULT_CURRENCY): number {
  assertMinor(minor);
  return minor / 10 ** minorDigits(currency);
}

export function sumMinor(amounts: readonly number[]): number {
  let total = 0;
  for (const a of amounts) {
    assertMinor(a);
    total += a;
  }
  assertMinor(total);
  return total;
}

/**
 * Split `total` into `parts` integer shares that sum EXACTLY to `total`.
 * The remainder is spread one minor unit at a time over the first shares:
 * splitEvenly(100, 3) -> [34, 33, 33]; splitEvenly(-100, 3) -> [-34, -33, -33].
 */
export function splitEvenly(total: number, parts: number): number[] {
  assertMinor(total);
  if (!Number.isInteger(parts) || parts <= 0)
    throw new RangeError("parts must be a positive integer");
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;
  // "+ 0" normalises -0 to 0
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1 : 0)) + 0);
}

/**
 * Split `total` proportionally to integer `weights` (largest-remainder method); sums exactly.
 */
export function splitByWeights(total: number, weights: readonly number[]): number[] {
  assertMinor(total);
  if (weights.length === 0) throw new RangeError("weights must not be empty");
  let weightSum = 0n;
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0)
      throw new RangeError("weights must be non-negative integers");
    weightSum += BigInt(w);
  }
  if (weightSum === 0n) throw new RangeError("weights must not all be zero");
  const sign = total < 0 ? -1 : 1;
  const abs = BigInt(Math.abs(total));
  const shares = weights.map((w) => (abs * BigInt(w)) / weightSum);
  const remainders = weights.map((w, i) => ({ i, r: (abs * BigInt(w)) % weightSum }));
  let left = abs - shares.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    shares[i] = (shares[i] ?? 0n) + 1n;
    left -= 1n;
  }
  return shares.map((s) => sign * Number(s) + 0);
}

/** Basis-point percentage of an amount, rounded half away from zero. 2100 bp = 21% (TVA). */
export function percentOf(minor: number, basisPoints: number): number {
  assertMinor(minor);
  if (!Number.isSafeInteger(basisPoints)) throw new RangeError("basisPoints must be an integer");
  const product = BigInt(minor) * BigInt(basisPoints);
  const neg = product < 0n;
  const abs = neg ? -product : product;
  const rounded = (abs + 5000n) / 10000n;
  return Number(neg ? -rounded : rounded) + 0;
}
