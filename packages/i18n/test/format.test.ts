import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatInteger,
  formatInZone,
  formatMoney,
  formatMoneyOrUnknown,
  formatTime,
  formatUnknown,
  formatWeekdayDate,
} from "../src/format";
import { hasMessage, translate } from "../src/load";

describe("formatMoney", () => {
  it("formats RON the Romanian and the English way", () => {
    expect(formatMoney(199000, "RON", "ro")).toBe("1.990 RON");
    expect(formatMoney(199000, "RON", "en")).toBe("1,990 RON");
    expect(formatMoney(19900, "RON", "ro")).toBe("199 RON");
    expect(formatMoney(24079, "RON", "ro")).toBe("240,79 RON");
    expect(formatMoney(24079, "RON", "en")).toBe("240.79 RON");
    expect(formatMoney(123456789005, "RON", "ro")).toBe("1.234.567.890,05 RON");
    expect(formatMoney(0, "RON", "ro")).toBe("0 RON");
    expect(formatMoney(-150000, "RON", "ro")).toBe("-1.500 RON");
    expect(formatMoney(5n, "EUR", "en")).toBe("0.05 EUR");
    expect(formatMoney(19900, "RON", "ro", { decimals: "always" })).toBe("199,00 RON");
  });

  it("unknown is a word, never zero", () => {
    expect(formatUnknown("ro")).toBe("necunoscut");
    expect(formatUnknown("en")).toBe("unknown");
    expect(formatMoneyOrUnknown(null, "RON", "ro")).toBe("necunoscut");
    expect(formatMoneyOrUnknown(0, "RON", "ro")).toBe("0 RON");
    expect(formatInteger(1234567, "ro")).toBe("1.234.567");
    expect(formatInteger(1234567, "en")).toBe("1,234,567");
  });
});

describe("dates (stored UTC, shown in Europe/Bucharest)", () => {
  const summer = new Date("2026-06-13T21:30:00Z"); // 14 June 00:30 in Bucharest (UTC+3)
  const winter = new Date("2026-01-05T22:15:00Z"); // 6 Jan 00:15 in Bucharest (UTC+2)

  it("formatDate", () => {
    expect(formatDate(summer, "ro")).toBe("14.06.2026");
    expect(formatDate(summer, "en")).toBe("14/06/2026");
    expect(formatDate(winter, "ro")).toBe("06.01.2026");
  });

  it("formatDateTime is 24h", () => {
    expect(formatDateTime(summer, "ro")).toBe("14.06.2026, 00:30");
    expect(formatDateTime(new Date("2026-06-14T15:05:00Z"), "en")).toBe("14/06/2026, 18:05");
    expect(formatTime(winter, "ro")).toBe("00:15");
  });

  it("formatWeekdayDate uses Romanian names with diacritics", () => {
    expect(formatWeekdayDate(summer, "ro")).toBe("duminică, 14 iunie 2026");
    expect(formatWeekdayDate(new Date("2026-06-13T10:00:00Z"), "ro")).toBe(
      "sâmbătă, 13 iunie 2026",
    );
    expect(formatWeekdayDate(new Date("2026-03-03T10:00:00Z"), "ro")).toBe("marți, 3 martie 2026");
    expect(formatWeekdayDate(summer, "en")).toBe("Sunday, 14 June 2026");
  });

  it("handles the spring DST boundary (29 March 2026, 03:00 -> 04:00)", () => {
    expect(formatDateTime(new Date("2026-03-29T00:59:59Z"), "ro")).toBe("29.03.2026, 02:59");
    expect(formatDateTime(new Date("2026-03-29T01:00:00Z"), "ro")).toBe("29.03.2026, 04:00");
  });

  it("handles the autumn DST boundary (25 October 2026, 04:00 -> 03:00)", () => {
    expect(formatDateTime(new Date("2026-10-25T00:59:00Z"), "ro")).toBe("25.10.2026, 03:59");
    expect(formatDateTime(new Date("2026-10-25T01:00:00Z"), "ro")).toBe("25.10.2026, 03:00");
    expect(formatDateTime(new Date("2026-10-24T21:30:00Z"), "ro")).toBe("25.10.2026, 00:30");
  });

  it("formatInZone works for other zones", () => {
    const d = new Date("2026-06-14T15:05:00Z");
    expect(formatInZone(d, "Europe/London", "en")).toBe("14/06/2026, 16:05");
    expect(formatInZone(d, "UTC", "ro")).toBe("14.06.2026, 15:05");
    expect(formatInZone(d, "America/New_York", "ro")).toBe("14.06.2026, 11:05");
  });
});

describe("translate", () => {
  it("looks up full keys, interpolates and falls back to the key", () => {
    expect(translate("ro", "common.actions.save")).toBe("Salvează");
    expect(translate("en", "common.actions.save")).toBe("Save");
    expect(translate("xx", "common.actions.cancel")).toBe("Anulează");
    expect(translate("en", "common.errors.retryAt", { time: "18:30" })).toBe(
      "You can try again after 18:30.",
    );
    expect(translate("ro", "common.nope.missing")).toBe("common.nope.missing");
    expect(hasMessage("ro", "common.errors.TAKEN")).toBe(true);
    expect(hasMessage("ro", "common.errors")).toBe(false);
  });
});
