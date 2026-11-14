import { describe, expect, it } from "vitest";
import {
  addMonths,
  addZonedDays,
  bucharestDateKey,
  bucharestOffsetMinutes,
  bucharestParts,
  bucharestToUtc,
  startOfBucharestDay,
  zonedToUtc,
} from "../src/time";

describe("time", () => {
  it("addMonths clamps to the month end and crosses years", () => {
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T10:00:00.000Z",
    );
    expect(addMonths(new Date("2024-01-31T10:00:00Z"), 1).toISOString()).toBe(
      "2024-02-29T10:00:00.000Z",
    );
    expect(addMonths(new Date("2026-11-15T00:00:00Z"), 3).toISOString()).toBe(
      "2027-02-15T00:00:00.000Z",
    );
    expect(addMonths(new Date("2026-03-31T00:00:00Z"), -12).toISOString()).toBe(
      "2025-03-31T00:00:00.000Z",
    );
    expect(addMonths(new Date("2026-03-31T00:00:00Z"), -1).toISOString()).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("knows Bucharest offsets and wall-clock parts", () => {
    expect(bucharestOffsetMinutes(new Date("2026-01-15T12:00:00Z"))).toBe(120);
    expect(bucharestOffsetMinutes(new Date("2026-07-15T12:00:00Z"))).toBe(180);
    expect(bucharestParts(new Date("2026-06-13T21:30:00Z"))).toMatchObject({
      year: 2026,
      month: 6,
      day: 14,
      hour: 0,
      minute: 30,
      weekday: 7,
    });
    expect(bucharestDateKey(new Date("2026-12-31T22:00:00Z"))).toBe("2027-01-01");
  });

  it("converts Bucharest wall time to UTC across DST", () => {
    expect(bucharestToUtc({ year: 2026, month: 1, day: 10, hour: 18 }).toISOString()).toBe(
      "2026-01-10T16:00:00.000Z",
    );
    expect(bucharestToUtc({ year: 2026, month: 7, day: 10, hour: 18 }).toISOString()).toBe(
      "2026-07-10T15:00:00.000Z",
    );
    // skipped hour (03:30 does not exist on 29 March 2026) -> lands after the jump
    expect(
      bucharestToUtc({ year: 2026, month: 3, day: 29, hour: 3, minute: 30 }).toISOString(),
    ).toBe("2026-03-29T01:30:00.000Z");
    // ambiguous hour (03:30 happens twice on 25 October 2026) -> the earlier instant
    expect(
      bucharestToUtc({ year: 2026, month: 10, day: 25, hour: 3, minute: 30 }).toISOString(),
    ).toBe("2026-10-25T00:30:00.000Z");
    expect(zonedToUtc({ year: 2026, month: 6, day: 1, hour: 12 }, "UTC").toISOString()).toBe(
      "2026-06-01T12:00:00.000Z",
    );
  });

  it("startOfBucharestDay and addZonedDays keep local time over DST changes", () => {
    expect(startOfBucharestDay(new Date("2026-06-14T10:00:00Z")).toISOString()).toBe(
      "2026-06-13T21:00:00.000Z",
    );
    const before = new Date("2026-03-28T16:00:00Z"); // 18:00 local, day before the jump
    expect(addZonedDays(before, 1).toISOString()).toBe("2026-03-29T15:00:00.000Z"); // still 18:00 local
  });
});
