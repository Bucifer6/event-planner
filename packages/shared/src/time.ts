// All timestamps are stored in UTC (INF8). Display is Europe/Bucharest; DST is handled only
// here and in @ed/i18n/format, through Intl — never with fixed offsets.

export const APP_TIME_ZONE = "Europe/Bucharest";

export const SECOND_MS = 1000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export function addSeconds(d: Date, n: number): Date {
  return new Date(d.getTime() + n * SECOND_MS);
}
export function addMinutes(d: Date, n: number): Date {
  return new Date(d.getTime() + n * MINUTE_MS);
}
export function addHours(d: Date, n: number): Date {
  return new Date(d.getTime() + n * HOUR_MS);
}
/** Adds exact 24h periods (UTC). For calendar days in a zone use addZonedDays. */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

export function daysInUtcMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** Calendar months in UTC, clamped to the month end: 31 Jan + 1 month = 28/29 Feb. */
export function addMonths(d: Date, n: number): Date {
  const monthIndex = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex - year * 12;
  const day = Math.min(d.getUTCDate(), daysInUtcMonth(year, month + 1));
  return new Date(
    Date.UTC(
      year,
      month,
      day,
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function isValidDate(d: unknown): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

export type ZonedParts = {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 1 = Monday ... 7 = Sunday (ISO) */
  weekday: number;
};

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** Wall-clock parts of an instant in an IANA zone. */
export function zonedParts(d: Date, timeZone: string = APP_TIME_ZONE): ZonedParts {
  const out: Record<string, string> = {};
  for (const p of dtf(timeZone).formatToParts(d)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour),
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? ""] ?? 0,
  };
}

/** Zone offset from UTC in minutes at that instant (Bucharest: 120 in winter, 180 in summer). */
export function zoneOffsetMinutes(d: Date, timeZone: string = APP_TIME_ZONE): number {
  const p = zonedParts(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / MINUTE_MS);
}

export type WallTime = {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
};

/**
 * Wall-clock time in a zone -> UTC instant.
 * A time skipped by the spring DST jump resolves to the instant after the jump; an ambiguous
 * autumn time resolves to the earlier (summer-time) instant.
 */
export function zonedToUtc(w: WallTime, timeZone: string = APP_TIME_ZONE): Date {
  const local = Date.UTC(w.year, w.month - 1, w.day, w.hour ?? 0, w.minute ?? 0, w.second ?? 0);
  // Try the offsets in force around that moment; prefer the earlier valid instant.
  const candidates = [local - DAY_MS, local + DAY_MS]
    .map((t) => zoneOffsetMinutes(new Date(t), timeZone))
    .sort((a, b) => b - a);
  for (const off of candidates) {
    const guess = new Date(local - off * MINUTE_MS);
    if (zoneOffsetMinutes(guess, timeZone) === off) return guess;
  }
  // Skipped local time: use the offset before the jump, which lands just after it.
  const before = zoneOffsetMinutes(new Date(local - DAY_MS), timeZone);
  return new Date(local - before * MINUTE_MS);
}

/** "2026-06-14" for that instant in the zone (useful as a per-day bucket key). */
export function zonedDateKey(d: Date, timeZone: string = APP_TIME_ZONE): string {
  const p = zonedParts(d, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** UTC instant of local midnight for the zone day containing `d`. */
export function startOfZonedDay(d: Date, timeZone: string = APP_TIME_ZONE): Date {
  const p = zonedParts(d, timeZone);
  return zonedToUtc({ year: p.year, month: p.month, day: p.day }, timeZone);
}

/** Calendar days in the zone, keeping the wall-clock time across DST changes. */
export function addZonedDays(d: Date, n: number, timeZone: string = APP_TIME_ZONE): Date {
  const p = zonedParts(d, timeZone);
  const shifted = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return new Date(
    zonedToUtc(
      {
        year: shifted.getUTCFullYear(),
        month: shifted.getUTCMonth() + 1,
        day: shifted.getUTCDate(),
        hour: p.hour,
        minute: p.minute,
        second: p.second,
      },
      timeZone,
    ).getTime() + d.getUTCMilliseconds(),
  );
}

// Europe/Bucharest shorthands
export const bucharestParts = (d: Date): ZonedParts => zonedParts(d, APP_TIME_ZONE);
export const bucharestToUtc = (w: WallTime): Date => zonedToUtc(w, APP_TIME_ZONE);
export const bucharestDateKey = (d: Date): string => zonedDateKey(d, APP_TIME_ZONE);
export const startOfBucharestDay = (d: Date): Date => startOfZonedDay(d, APP_TIME_ZONE);
export const bucharestOffsetMinutes = (d: Date): number => zoneOffsetMinutes(d, APP_TIME_ZONE);
