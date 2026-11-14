import { describe, expect, it } from "vitest";
import { percentOf, splitByWeights, splitEvenly, sumMinor, toMajor, toMinor } from "../src/money";

describe("money", () => {
  it("converts major <-> minor without float drift", () => {
    expect(toMinor(19.9)).toBe(1990);
    expect(toMinor("1990")).toBe(199000);
    expect(toMinor("240,79")).toBe(24079);
    expect(toMinor(0.1 + 0.2)).toBe(30);
    expect(toMinor("-1.005")).toBe(-101);
    expect(toMajor(24079)).toBe(240.79);
    expect(() => toMinor("abc")).toThrow(RangeError);
  });

  it("splitEvenly sums exactly", () => {
    expect(splitEvenly(100, 3)).toEqual([34, 33, 33]);
    expect(splitEvenly(-100, 3)).toEqual([-34, -33, -33]);
    expect(splitEvenly(0, 4)).toEqual([0, 0, 0, 0]);
    expect(splitEvenly(2, 5)).toEqual([1, 1, 0, 0, 0]);
    for (const total of [1, 7, 99, 100, 1990, 24079, 999_999_999, -12345]) {
      for (const parts of [1, 2, 3, 7, 11, 100]) {
        const shares = splitEvenly(total, parts);
        expect(shares).toHaveLength(parts);
        expect(sumMinor(shares)).toBe(total);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      }
    }
    expect(() => splitEvenly(100, 0)).toThrow(RangeError);
    expect(() => splitEvenly(10.5, 2)).toThrow(RangeError);
  });

  it("splitByWeights sums exactly", () => {
    expect(splitByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitByWeights(1000, [2, 1, 1])).toEqual([500, 250, 250]);
    expect(sumMinor(splitByWeights(24079, [3, 5, 9, 0, 1]))).toBe(24079);
    expect(() => splitByWeights(100, [0, 0])).toThrow(RangeError);
  });

  it("percentOf computes TVA from the PRD example (199 RON + 21% = 240.79 RON)", () => {
    expect(19900 + percentOf(19900, 2100)).toBe(24079);
  });
});
