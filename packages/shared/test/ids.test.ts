import { describe, expect, it } from "vitest";
import { hashEquals, hashToken, newId, randomToken, sixDigitCode } from "../src/ids";
import { zId } from "../src/zod";

describe("ids", () => {
  it("newId gives unique cuid2 values that zId accepts", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(zId.safeParse(id).success).toBe(true);
  });

  it("randomToken is base64url with at least 128 bits", () => {
    const t = randomToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(Buffer.from(randomToken(16), "base64url")).toHaveLength(16);
    expect(() => randomToken(8)).toThrow(RangeError);
    expect(randomToken()).not.toBe(randomToken());
  });

  it("hashToken is sha256 hex", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashEquals(hashToken("a"), hashToken("a"))).toBe(true);
    expect(hashEquals(hashToken("a"), hashToken("b"))).toBe(false);
  });

  it("sixDigitCode is always six digits", () => {
    for (let i = 0; i < 2000; i++) expect(sixDigitCode()).toMatch(/^\d{6}$/);
  });
});
