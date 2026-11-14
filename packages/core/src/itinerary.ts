import { and, asc, eq, itineraryLegs, occasions, subgroups, type ItineraryKind, type WhatIfDeltaRow } from "@ed/db";
import { ITINERARY_KINDS } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { zonedParts, zonedToUtc } from "@ed/shared/time";
import { zOptionalText, zText } from "@ed/shared/zod";
import { z } from "zod";
import { requireMember, type Member } from "./access";
import { audit } from "./audit";
import { requireWriteCapable, type Ctx } from "./context";
import { registerExport, toCsv } from "./exports";
import { assertOccasionWritable } from "./lifecycle";
import { type LooseInput, canPlanTrip, isValidTimeZone, seesSubgroup, TRIP_PLANNER_ROLES, visibleSubgroups, zTimeZone } from "./subgroups";
import { createPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// RELEASE D (D-01): the itinerary across time zones.
//
// INF8: every instant is stored in UTC. A leg keeps, beside each instant, the IANA zone of the
// place where that moment happens (start_tz, end_tz); screens show each time in that TRIP zone
// and in Europe/Bucharest. Nothing here stores a local time, so DST changes are a display
// matter only — a flight may well "land before it departs" on the local clocks.
//
// Booking import (principle 3): pasted text or an .ics file is PARSED into candidate legs —
// only what is reliably there, nothing invented — and becomes a What-if preview
// ("itinerary.import"). Legs are created or changed only when the person confirms it.

export type ItineraryLeg = typeof itineraryLegs.$inferSelect;
export type { ItineraryKind };
export const BUCHAREST = "Europe/Bucharest";

const idSchema = z.string().min(1).max(64);

/* ── Wall-clock helpers (pure) ──────────────────────────────────────────── */

/** "2027-03-28T03:30" as typed in a datetime-local field, read in `tz` → the UTC instant. */
export function localToInstant(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [year, month, day, hour, minute] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  return zonedToUtc({ year, month, day, hour, minute, second: Number(m[6] ?? 0) }, tz);
}

/** The UTC instant as a datetime-local value in `tz` ("2027-03-28T04:30"). */
export function instantToLocal(d: Date, tz: string): string {
  const p = zonedParts(d, tz);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${two(p.month)}-${two(p.day)}T${two(p.hour)}:${two(p.minute)}`;
}

/** Minutes between two instants (what the traveller actually spends), never from local clocks. */
export function durationMinutes(start: Date, end: Date | null): number | null {
  return end ? Math.round((end.getTime() - start.getTime()) / 60_000) : null;
}

/** UTC offset of `tz` at instant `d`, in minutes (e.g. +180 for Bucharest in summer). */
export function offsetMinutes(d: Date, tz: string): number {
  const p = zonedParts(d, tz);
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
}

/* ── Reading ────────────────────────────────────────────────────────────── */

export type LegView = {
  id: string;
  kind: ItineraryKind;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  startTz: string;
  endTz: string;
  placeFrom: string | null;
  placeTo: string | null;
  reference: string | null;
  notes: string | null;
  subgroupId: string | null;
  subgroupName: string | null;
  durationMinutes: number | null;
  /** True when the local clock at arrival reads earlier than the local clock at departure. */
  arrivesBeforeLocalDeparture: boolean;
  canEdit: boolean;
};

export type Itinerary = {
  occasion: { id: string; title: string; timezone: string; status: string };
  legs: LegView[];
  /** The next leg that has not started yet (else the one under way), or null. */
  next: LegView | null;
  canPlan: boolean;
};

function localStamp(d: Date, tz: string): number {
  const p = zonedParts(d, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
}

function toView(leg: ItineraryLeg, groupName: Map<string, string>, canEdit: boolean): LegView {
  return {
    id: leg.id,
    kind: leg.kind,
    title: leg.title,
    startsAt: leg.startsAt,
    endsAt: leg.endsAt,
    startTz: leg.startTz,
    endTz: leg.endTz,
    placeFrom: leg.placeFrom,
    placeTo: leg.placeTo,
    reference: leg.reference,
    notes: leg.notes,
    subgroupId: leg.subgroupId,
    subgroupName: leg.subgroupId ? (groupName.get(leg.subgroupId) ?? null) : null,
    durationMinutes: durationMinutes(leg.startsAt, leg.endsAt),
    arrivesBeforeLocalDeparture: !!leg.endsAt && leg.endsAt.getTime() > leg.startsAt.getTime() && localStamp(leg.endsAt, leg.endTz) < localStamp(leg.startsAt, leg.startTz),
    canEdit,
  };
}

/** NO access check: every leg of the occasion in time order (rehearsal, exports). */
export async function listLegsUnchecked(ctx: Ctx, occasionId: string): Promise<ItineraryLeg[]> {
  return ctx.db.select().from(itineraryLegs).where(eq(itineraryLegs.occasionId, occasionId)).orderBy(asc(itineraryLegs.startsAt), asc(itineraryLegs.createdAt));
}

/**
 * The itinerary the actor may see — also the READ API for assistants (MCP): whole-trip legs
 * for every member, subgroup legs only for that subgroup's people and trip planners (D2).
 */
export async function getItinerary(ctx: Ctx, occasionId: string): Promise<Itinerary> {
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  const [occasion] = await ctx.db.select({ id: occasions.id, title: occasions.title, timezone: occasions.timezone, status: occasions.status }).from(occasions).where(eq(occasions.id, id));
  if (!occasion) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const visible = await visibleSubgroups(ctx, member);
  const [rows, groups] = await Promise.all([listLegsUnchecked(ctx, id), ctx.db.select({ id: subgroups.id, name: subgroups.name, lead: subgroups.leadMemberId }).from(subgroups).where(eq(subgroups.occasionId, id))]);
  const names = new Map(groups.map((g) => [g.id, g.name]));
  const leads = new Map(groups.map((g) => [g.id, g.lead]));
  const legs = rows.filter((l) => seesSubgroup(visible, l.subgroupId)).map((l) => toView(l, names, canEditLeg(member, l, leads)));
  const now = ctx.now.getTime();
  const next = legs.find((l) => l.startsAt.getTime() >= now) ?? legs.find((l) => l.endsAt !== null && l.endsAt.getTime() >= now) ?? null;
  return { occasion, legs, next, canPlan: canPlanTrip(member) };
}

/** Trip planners edit every leg; the lead of a subgroup edits that subgroup's legs. */
function canEditLeg(member: Member, leg: Pick<ItineraryLeg, "subgroupId">, leads: Map<string, string | null>): boolean {
  if (canPlanTrip(member)) return true;
  return leg.subgroupId !== null && leads.get(leg.subgroupId) === member.id;
}

/* ── Writing ────────────────────────────────────────────────────────────── */

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const legFields = {
  kind: z.enum(ITINERARY_KINDS).default("other"),
  title: zText(160),
  /** datetime-local value read in startTz, e.g. "2027-07-14T10:15". */
  startsLocal: z.string().trim().min(1, "common.validation.required").max(25),
  startTz: zTimeZone,
  endsLocal: z.preprocess(blank, z.string().trim().max(25).optional()),
  /** Defaults to startTz. */
  endTz: z.preprocess(blank, zTimeZone.optional()),
  placeFrom: zOptionalText(160),
  placeTo: zOptionalText(160),
  reference: zOptionalText(60),
  notes: zOptionalText(2000),
  subgroupId: z.preprocess(blank, idSchema.optional()),
};
const createLegInput = z.object({ occasionId: idSchema, ...legFields });
const updateLegInput = z.object({ legId: idSchema, ...legFields });

type LegData = z.output<typeof createLegInput>;
function legValues(data: Omit<LegData, "occasionId">) {
  const startsAt = localToInstant(data.startsLocal, data.startTz);
  if (!startsAt) throw new AppError("VALIDATION", "travel.errors.dateTime", { fieldErrors: { startsLocal: ["travel.errors.dateTime"] } });
  const endTz = data.endTz ?? data.startTz;
  let endsAt: Date | null = null;
  if (data.endsLocal) {
    endsAt = localToInstant(data.endsLocal, endTz);
    if (!endsAt) throw new AppError("VALIDATION", "travel.errors.dateTime", { fieldErrors: { endsLocal: ["travel.errors.dateTime"] } });
    // compared as INSTANTS: 23:30 in one zone may be "before" 22:00 in another on the clocks
    if (endsAt.getTime() < startsAt.getTime()) {
      throw new AppError("VALIDATION", "travel.errors.endBeforeStart", { fieldErrors: { endsLocal: ["travel.errors.endBeforeStart"] } });
    }
  }
  return {
    kind: data.kind,
    title: data.title,
    startsAt,
    endsAt,
    startTz: data.startTz,
    endTz,
    placeFrom: data.placeFrom ?? null,
    placeTo: data.placeTo ?? null,
    reference: data.reference ?? null,
    notes: data.notes ?? null,
    subgroupId: data.subgroupId ?? null,
  };
}

async function requireLegWriter(ctx: Ctx, occasionId: string, subgroupId: string | null): Promise<Member> {
  const member = await requireMember(ctx, occasionId);
  if (!canPlanTrip(member)) {
    const [g] = subgroupId ? await ctx.db.select({ lead: subgroups.leadMemberId }).from(subgroups).where(and(eq(subgroups.id, subgroupId), eq(subgroups.occasionId, occasionId))) : [];
    if (!g || g.lead !== member.id) throw new AppError("FORBIDDEN", "common.errors.FORBIDDEN");
  } else if (subgroupId) {
    const [g] = await ctx.db.select({ id: subgroups.id }).from(subgroups).where(and(eq(subgroups.id, subgroupId), eq(subgroups.occasionId, occasionId)));
    if (!g) throw new AppError("VALIDATION", "common.validation.invalid", { fieldErrors: { subgroupId: ["common.validation.invalid"] } });
  }
  await assertOccasionWritable(ctx, occasionId);
  return member;
}

export async function createLeg(ctx: Ctx, input: LooseInput<typeof createLegInput>): Promise<{ legId: string }> {
  requireWriteCapable(ctx);
  const data = createLegInput.parse(input);
  const values = legValues(data);
  const member = await requireLegWriter(ctx, data.occasionId, values.subgroupId);
  const [row] = await ctx.db
    .insert(itineraryLegs)
    .values({ occasionId: data.occasionId, ...values, createdByMemberId: member.viaBusiness ? null : member.id, createdAt: ctx.now })
    .returning({ id: itineraryLegs.id });
  await audit(ctx, { action: "itinerary.leg_created", objectType: "itinerary_leg", objectId: row!.id, after: { title: values.title, startsAt: values.startsAt.toISOString() } });
  return { legId: row!.id };
}

export async function updateLeg(ctx: Ctx, input: LooseInput<typeof updateLegInput>): Promise<void> {
  requireWriteCapable(ctx);
  const data = updateLegInput.parse(input);
  const [leg] = await ctx.db.select().from(itineraryLegs).where(eq(itineraryLegs.id, data.legId));
  if (!leg) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireLegWriter(ctx, leg.occasionId, leg.subgroupId);
  const values = legValues(data);
  if (values.subgroupId !== leg.subgroupId) await requireLegWriter(ctx, leg.occasionId, values.subgroupId);
  await ctx.db.update(itineraryLegs).set(values).where(eq(itineraryLegs.id, leg.id));
  await audit(ctx, {
    action: "itinerary.leg_updated",
    objectType: "itinerary_leg",
    objectId: leg.id,
    before: { title: leg.title, startsAt: leg.startsAt.toISOString() },
    after: { title: values.title, startsAt: values.startsAt.toISOString() },
  });
}

export async function deleteLeg(ctx: Ctx, input: { legId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const [leg] = await ctx.db.select().from(itineraryLegs).where(eq(itineraryLegs.id, idSchema.parse(input.legId)));
  if (!leg) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireLegWriter(ctx, leg.occasionId, leg.subgroupId);
  await ctx.db.delete(itineraryLegs).where(eq(itineraryLegs.id, leg.id));
  await audit(ctx, { action: "itinerary.leg_deleted", objectType: "itinerary_leg", objectId: leg.id, before: { title: leg.title } });
}

/* ── Booking import: parsing (pure — never invents) ─────────────────────── */

export type LegCandidate = {
  kind: ItineraryKind;
  /** null = nothing reliable to call it: the person fills it in. */
  title: string | null;
  /** ISO instants (UTC). */
  startsAt: string;
  endsAt: string | null;
  startTz: string;
  endTz: string;
  placeFrom: string | null;
  placeTo: string | null;
  reference: string | null;
  importKey: string | null;
  /** What could not be read and was left for the person: "title" | "endsAt" | "zone" | "place". */
  missing: string[];
};

export type ParseResult = { candidates: LegCandidate[]; /** Events seen but dropped because no date could be read. */ skipped: number };

const KIND_HINTS: Array<[RegExp, ItineraryKind]> = [
  [/\b(flight|zbor|vuelo|vol|flug|airlines?|airways|boarding)\b/i, "flight"],
  [/\b(train|tren|cfr|rail|bahn)\b/i, "train"],
  [/\b(bus|autocar|autobuz|coach|flixbus)\b/i, "bus"],
  [/\b(ferry|feribot|ferryboat)\b/i, "ferry"],
  [/\b(hotel|cazare|check-?in|pensiune|hostel|airbnb|apartament|stay|accommodation)\b/i, "stay"],
  [/\b(rent-?a-?car|car hire|car rental|închiriere|inchiriere)\b/i, "car"],
];
const FLIGHT_RE = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{2,4})\b/;
const REF_RE = /(?:confirmation|booking|reservation|rezervare|confirmare|pnr|record locator|cod(?:ul)?(?: de)?(?: rezervare| confirmare)?)\s*(?:code|number|no\.?|nr\.?|ref(?:erence)?)?\s*[:#]?\s*([A-Za-z0-9]{5,10})\b/gi;

/** A booking code right after its keyword. Only an ALL-CAPS code counts — an ordinary word after "booking" is not a code. */
function findReference(text: string): string | null {
  for (const m of text.matchAll(REF_RE)) {
    const code = m[1] ?? "";
    if (code === code.toUpperCase() && /[A-Z]/.test(code)) return code;
  }
  return null;
}

function guessKind(text: string): ItineraryKind {
  for (const [re, kind] of KIND_HINTS) if (re.test(text)) return kind;
  return "other";
}

function unescapeIcs(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();
}

function parseIcsDate(value: string, params: Record<string, string>, defaultTz: string): { at: Date; tz: string; assumed: boolean; dateOnly: boolean } | null {
  const v = value.trim();
  const full = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  const rawTz = (params.TZID ?? "").replace(/^"|"$/g, "");
  const known = rawTz !== "" && isValidTimeZone(rawTz);
  const tz = known ? rawTz : defaultTz;
  if (full) {
    const wall = { year: Number(full[1]), month: Number(full[2]), day: Number(full[3]), hour: Number(full[4]), minute: Number(full[5]), second: Number(full[6] ?? 0) };
    if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31 || wall.hour > 23 || wall.minute > 59) return null;
    if (full[7] === "Z") {
      return { at: new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second)), tz: defaultTz, assumed: true, dateOnly: false };
    }
    return { at: zonedToUtc(wall, tz), tz, assumed: !known, dateOnly: false };
  }
  if (dateOnly) {
    const wall = { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]), hour: 0, minute: 0, second: 0 };
    if (wall.month < 1 || wall.month > 12 || wall.day < 1 || wall.day > 31) return null;
    return { at: zonedToUtc(wall, tz), tz, assumed: !known, dateOnly: true };
  }
  return null;
}

/**
 * Tolerant .ics reader: VEVENTs with DTSTART / DTEND (TZID, Z, floating or date-only), SUMMARY,
 * LOCATION, UID, DESCRIPTION. Folded lines, CRLF or LF, unknown properties and broken events
 * are tolerated; an event without a readable start is counted in `skipped`.
 */
export function parseIcs(text: string, defaultTz: string = BUCHAREST): ParseResult {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n[ \t]/g, "").split("\n");
  const candidates: LegCandidate[] = [];
  let skipped = 0;
  let current: Record<string, { value: string; params: Record<string, string> }> | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^BEGIN:VEVENT$/i.test(line)) {
      current = {};
      continue;
    }
    if (/^END:VEVENT$/i.test(line)) {
      if (current) {
        const c = icsCandidate(current, defaultTz);
        if (c) candidates.push(c);
        else skipped += 1;
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const [name, ...paramParts] = line.slice(0, colon).split(";");
    const params: Record<string, string> = {};
    for (const p of paramParts) {
      const eqAt = p.indexOf("=");
      if (eqAt > 0) params[p.slice(0, eqAt).toUpperCase()] = p.slice(eqAt + 1);
    }
    const key = (name ?? "").toUpperCase();
    if (!(key in current)) current[key] = { value: line.slice(colon + 1), params };
  }
  return { candidates: candidates.slice(0, 200), skipped };
}

function icsCandidate(ev: Record<string, { value: string; params: Record<string, string> }>, defaultTz: string): LegCandidate | null {
  if (!ev.DTSTART) return null;
  const start = parseIcsDate(ev.DTSTART.value, ev.DTSTART.params, defaultTz);
  if (!start) return null;
  const end = ev.DTEND ? parseIcsDate(ev.DTEND.value, ev.DTEND.params, defaultTz) : null;
  const summary = ev.SUMMARY ? unescapeIcs(ev.SUMMARY.value).slice(0, 160) : "";
  const location = ev.LOCATION ? unescapeIcs(ev.LOCATION.value).slice(0, 160) : "";
  const description = ev.DESCRIPTION ? unescapeIcs(ev.DESCRIPTION.value) : "";
  const reference = findReference(`${summary}\n${description}`);
  const uid = ev.UID ? unescapeIcs(ev.UID.value).slice(0, 200) : null;
  const missing: string[] = [];
  if (summary === "") missing.push("title");
  if (!end || end.at.getTime() < start.at.getTime()) missing.push("endsAt");
  if (start.assumed || (end?.assumed ?? false)) missing.push("zone");
  if (location === "") missing.push("place");
  const validEnd = end && end.at.getTime() >= start.at.getTime() ? end : null;
  const kind = start.dateOnly ? (guessKind(summary) === "other" ? "stay" : guessKind(summary)) : guessKind(`${summary} ${description.slice(0, 200)}`);
  return {
    kind,
    title: summary === "" ? null : summary,
    startsAt: start.at.toISOString(),
    endsAt: validEnd ? validEnd.at.toISOString() : null,
    startTz: start.tz,
    endTz: validEnd ? validEnd.tz : start.tz,
    placeFrom: location === "" ? null : location,
    placeTo: null,
    reference,
    importKey: uid ? `ics:${uid}` : null,
    missing,
  };
}

const MONTHS: Record<string, number> = {
  jan: 1, ian: 1, feb: 2, mar: 3, apr: 4, may: 5, mai: 5, jun: 6, iun: 6, jul: 7, iul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, noi: 11, dec: 12,
};
const DATE_RES: RegExp[] = [
  /\b(\d{4})-(\d{2})-(\d{2})\b/g, // 2027-07-14
  /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g, // 14.07.2027 / 14/07/2027 (day first)
  /\b(\d{1,2})\s+([A-Za-zăâîșț]{3,10})\.?\s+(\d{4})\b/g, // 14 iulie 2027 / 14 Jul 2027
];
type Found = { index: number; year: number; month: number; day: number };

function findDates(line: string): Found[] {
  const out: Found[] = [];
  for (const [i, re] of DATE_RES.entries()) {
    for (const m of line.matchAll(re)) {
      let year: number, month: number, day: number;
      if (i === 0) [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
      else if (i === 1) [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
      else {
        const key = (m[2] ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").slice(0, 4);
        const mm = MONTHS[key] ?? MONTHS[key.slice(0, 3)];
        if (!mm) continue;
        [day, month, year] = [Number(m[1]), mm, Number(m[3])];
      }
      if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) continue;
      out.push({ index: m.index ?? 0, year, month, day });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function findTimes(line: string): Array<{ index: number; hour: number; minute: number }> {
  const out: Array<{ index: number; hour: number; minute: number }> = [];
  for (const m of line.matchAll(/(?<![\d.:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])\s*(am|pm)?/gi)) {
    // "14.07" in front of a year is a date, not a time
    if (/^[./]\d{4}/.test(line.slice((m.index ?? 0) + m[0].trimEnd().length))) continue;
    let hour = Number(m[1]);
    const ap = (m[3] ?? "").toLowerCase();
    if (ap === "pm" && hour < 12) hour += 12;
    if (ap === "am" && hour === 12) hour = 0;
    out.push({ index: m.index ?? 0, hour, minute: Number(m[2]) });
  }
  return out;
}

/**
 * Reads a pasted booking confirmation. Only what is reliable is extracted — dates, times,
 * flight numbers, a booking code after its keyword, "OTP → LHR"-style routes; everything else
 * is listed in `missing` for the person to fill in. Times carry no zone in such texts: they
 * are read in `defaultTz` and flagged ("zone") so the person checks them.
 */
export function parseConfirmationText(text: string, defaultTz: string = BUCHAREST): ParseResult {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter((l) => l !== "").slice(0, 400);
  const reference = findReference(text);
  const candidates: LegCandidate[] = [];
  let skipped = 0;
  let lastDate: Found | null = null;
  const used = new Set<number>();

  const build = (at: number, title: string | null, kind: ItineraryKind, importKey: (day: string) => string | null, route: RegExpExecArray | null) => {
    // the event's own line and the few after it; a date mentioned just before carries over
    const windowLines = lines.slice(at, at + 4);
    const dates: Found[] = [];
    const times: Array<{ hour: number; minute: number }> = [];
    for (const [off, l] of windowLines.entries()) {
      if (off > 0 && FLIGHT_RE.test(l) && /\b(flight|zbor)\b/i.test(l)) break; // the next flight starts here
      dates.push(...findDates(l));
      times.push(...findTimes(l));
      used.add(at + off);
    }
    const startDate = dates[0] ?? lastDate;
    if (!startDate || times.length === 0) {
      skipped += 1;
      return;
    }
    const endDate = dates[1] ?? startDate;
    const startsAt = zonedToUtc({ year: startDate.year, month: startDate.month, day: startDate.day, hour: times[0]!.hour, minute: times[0]!.minute, second: 0 }, defaultTz);
    let endsAt: Date | null = null;
    if (times[1]) {
      endsAt = zonedToUtc({ year: endDate.year, month: endDate.month, day: endDate.day, hour: times[1].hour, minute: times[1].minute, second: 0 }, defaultTz);
      // an arrival that reads earlier than the departure is not guessed at (next day? other zone?)
      if (endsAt.getTime() < startsAt.getTime()) endsAt = null;
    }
    const day = `${startDate.year}-${String(startDate.month).padStart(2, "0")}-${String(startDate.day).padStart(2, "0")}`;
    const missing = ["zone"];
    if (!title) missing.push("title");
    if (!endsAt) missing.push("endsAt");
    if (!route) missing.push("place");
    candidates.push({
      kind,
      title,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt ? endsAt.toISOString() : null,
      startTz: defaultTz,
      endTz: defaultTz,
      placeFrom: route?.[1] ?? null,
      placeTo: route?.[2] ?? null,
      reference,
      importKey: importKey(day),
      missing,
    });
  };

  for (const [i, line] of lines.entries()) {
    const d = findDates(line);
    const flight = FLIGHT_RE.exec(line);
    const isFlightLine = flight && (/\b(flight|zbor)\b/i.test(line) || /\b[A-Z]{3}\s*(?:→|->|–|-|to|spre)\s*[A-Z]{3}\b/.test(line));
    if (isFlightLine && flight) {
      const number = `${flight[1]} ${flight[2]}`;
      const route = /\b([A-Z]{3})\s*(?:→|->|–|-|to|spre)\s*([A-Z]{3})\b/.exec(lines.slice(i, i + 3).join(" "));
      build(i, number, "flight", (day) => `flight:${flight[1]}${flight[2]}:${day}`, route);
    }
    if (d.length > 0) lastDate = d[d.length - 1]!;
  }
  // No flight found: one candidate from the first line that has both a date and a time.
  if (candidates.length === 0) {
    const at = lines.findIndex((l, i) => !used.has(i) && findDates(l).length > 0 && findTimes(l).length > 0);
    if (at >= 0) {
      skipped = 0;
      lastDate = null;
      build(at, null, guessKind(text), () => (reference ? `ref:${reference}` : null), null);
    }
  }
  return { candidates: candidates.slice(0, 50), skipped };
}

/** .ics when it looks like one, otherwise a pasted confirmation. */
export function parseBooking(text: string, defaultTz: string = BUCHAREST): ParseResult {
  return /BEGIN:VCALENDAR|BEGIN:VEVENT/i.test(text) ? parseIcs(text, defaultTz) : parseConfirmationText(text, defaultTz);
}

/* ── Booking import: What-if ────────────────────────────────────────────── */

export const ITINERARY_IMPORT_KIND = "itinerary.import";

const candidateSchema = z.object({
  kind: z.enum(ITINERARY_KINDS),
  title: z.string().max(160).nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  startTz: zTimeZone,
  endTz: zTimeZone,
  placeFrom: z.string().max(160).nullable(),
  placeTo: z.string().max(160).nullable(),
  reference: z.string().max(60).nullable(),
  importKey: z.string().max(220).nullable(),
  missing: z.array(z.string().max(20)).max(8),
});
const importInput = z.object({ candidates: z.array(candidateSchema).min(1).max(200), skipped: z.number().int().min(0).max(10_000).default(0) });
type ImportInput = z.infer<typeof importInput>;

export type ImportPlanRow = { action: "create" | "change" | "skip"; candidate: LegCandidate; existing: ItineraryLeg | null };

const sameInstant = (a: Date | null, b: string | null) => (a === null ? b === null : b !== null && a.getTime() === new Date(b).getTime());

/**
 * What an import would do, against the legs as they are NOW. A candidate matches an existing
 * leg by its booking code (reference) or import key: identical → skip, different → change,
 * no match → create. The same candidate twice in one import is applied once.
 */
export async function planImport(ctx: Ctx, occasionId: string, candidates: LegCandidate[]): Promise<ImportPlanRow[]> {
  const existing = await listLegsUnchecked(ctx, occasionId);
  const seen = new Set<string>();
  const rows: ImportPlanRow[] = [];
  for (const c of candidates) {
    const dedupe = c.importKey ?? `${c.reference ?? ""}|${c.startsAt}|${c.title ?? ""}`;
    if (seen.has(dedupe)) {
      rows.push({ action: "skip", candidate: c, existing: null });
      continue;
    }
    seen.add(dedupe);
    const match =
      (c.importKey ? existing.find((l) => l.importKey === c.importKey) : undefined) ??
      // several legs can share one booking code (outbound + return): match code AND departure day
      (c.reference ? existing.find((l) => l.reference === c.reference && l.startsAt.toISOString().slice(0, 10) === c.startsAt.slice(0, 10)) : undefined) ??
      null;
    if (!match) rows.push({ action: "create", candidate: c, existing: null });
    else if (sameInstant(match.startsAt, c.startsAt) && sameInstant(match.endsAt, c.endsAt ?? (match.endsAt ? match.endsAt.toISOString() : null)) && (c.title === null || c.title === match.title)) {
      rows.push({ action: "skip", candidate: c, existing: match });
    } else rows.push({ action: "change", candidate: c, existing: match });
  }
  return rows;
}

const when = (iso: string | Date, tz: string) => {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const p = zonedParts(d, tz);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(p.day)}.${two(p.month)}.${p.year}, ${two(p.hour)}:${two(p.minute)} (${tz})`;
};

function importDelta(rows: ImportPlanRow[], skippedUnreadable: number): WhatIfDeltaRow[] {
  const delta: WhatIfDeltaRow[] = rows.slice(0, 300).map((r, i) => {
    const c = r.candidate;
    const what = c.title ?? { key: "travel.import.untitled" };
    const after = `${when(c.startsAt, c.startTz)}${c.endsAt ? ` → ${when(c.endsAt, c.endTz)}` : ""}`;
    const note = c.missing.length > 0 ? { noteKey: "travel.import.missingNote", noteParams: { count: c.missing.length } } : {};
    if (r.action === "create") return { key: `c${i}`, what, kindLabelKey: "travel.import.create", before: null, after, ...note };
    if (r.action === "change") {
      return { key: `c${i}`, what, kindLabelKey: "travel.import.change", before: `${when(r.existing!.startsAt, r.existing!.startTz)}${r.existing!.endsAt ? ` → ${when(r.existing!.endsAt, r.existing!.endTz)}` : ""}`, after, ...note };
    }
    return { key: `c${i}`, what, kindLabelKey: "travel.import.skip", before: after, after, noteKey: "travel.import.skipNote" };
  });
  if (skippedUnreadable > 0) delta.push({ key: "_unreadable", what: { key: "travel.import.unreadable", params: { count: skippedUnreadable } }, kindLabelKey: "travel.import.skip" });
  return delta;
}

registerWhatIf<ImportInput>(ITINERARY_IMPORT_KIND, {
  input: importInput,
  authorize: async (ctx, subject, action) => {
    await requireMember(ctx, subject.occasionId ?? "", action === "read" ? {} : { roles: TRIP_PLANNER_ROLES });
  },
  compute: async (ctx, input, subject) => {
    const rows = await planImport(ctx, subject.occasionId ?? "", input.candidates);
    return { title: { key: "travel.import.previewTitle", params: { count: rows.filter((r) => r.action !== "skip").length } }, delta: importDelta(rows, input.skipped) };
  },
  apply: async (tx, preview) => {
    const occasionId = preview.occasionId ?? "";
    const member = await requireMember(tx, occasionId, { roles: TRIP_PLANNER_ROLES });
    await assertOccasionWritable(tx, occasionId);
    // re-planned against the legs as they are now: a second confirm or a re-import never duplicates
    const rows = await planImport(tx, occasionId, preview.input.candidates);
    let created = 0;
    let changed = 0;
    for (const r of rows) {
      const c = r.candidate;
      const values = {
        startsAt: new Date(c.startsAt),
        endsAt: c.endsAt ? new Date(c.endsAt) : null,
        startTz: c.startTz,
        endTz: c.endTz,
      };
      if (r.action === "create") {
        await tx.db.insert(itineraryLegs).values({
          occasionId,
          kind: c.kind,
          // never invented: an unnamed import keeps a neutral placeholder the person replaces
          title: c.title ?? "—",
          ...values,
          placeFrom: c.placeFrom,
          placeTo: c.placeTo,
          reference: c.reference,
          importKey: c.importKey,
          createdByMemberId: member.viaBusiness ? null : member.id,
          createdAt: tx.now,
        });
        created += 1;
      } else if (r.action === "change" && r.existing) {
        await tx.db
          .update(itineraryLegs)
          .set({ ...values, endsAt: values.endsAt ?? r.existing.endsAt, ...(c.title ? { title: c.title } : {}), ...(c.placeFrom ? { placeFrom: c.placeFrom } : {}), ...(c.placeTo ? { placeTo: c.placeTo } : {}) })
          .where(eq(itineraryLegs.id, r.existing.id));
        changed += 1;
      }
    }
    await audit(tx, { action: "itinerary.imported", objectType: "occasion", objectId: occasionId, meta: { created, changed, skipped: rows.length - created - changed } });
  },
});

/**
 * Parses pasted text / an .ics file and opens the What-if preview. NOTHING is created here.
 * VALIDATION `travel.import.nothingFound` when no dated event could be read.
 */
export async function proposeItineraryImport(ctx: Ctx, input: { occasionId: string; text: string; defaultTz?: string }): Promise<WhatIfPreview> {
  const data = z.object({ occasionId: idSchema, text: z.string().min(1, "common.validation.required").max(300_000, "common.validation.tooLong"), defaultTz: zTimeZone.optional() }).parse(input);
  await requireMember(ctx, data.occasionId, { roles: TRIP_PLANNER_ROLES });
  await assertOccasionWritable(ctx, data.occasionId);
  const [occasion] = await ctx.db.select({ tz: occasions.timezone }).from(occasions).where(eq(occasions.id, data.occasionId));
  const parsed = parseBooking(data.text, data.defaultTz ?? occasion?.tz ?? BUCHAREST);
  if (parsed.candidates.length === 0) {
    throw new AppError("VALIDATION", "travel.import.nothingFound", { fieldErrors: { text: ["travel.import.nothingFound"] } });
  }
  return createPreview(ctx, {
    kind: ITINERARY_IMPORT_KIND,
    occasionId: data.occasionId,
    subjectType: "occasion",
    subjectId: data.occasionId,
    input: { candidates: parsed.candidates, skipped: parsed.skipped },
  });
}

/* ── Export ─────────────────────────────────────────────────────────────── */

registerExport({
  key: "itinerary",
  titleKey: "travel.exports.itinerary",
  descriptionKey: "travel.exports.itineraryDescription",
  run: async (ctx, occasionId) => {
    const it = await getItinerary(ctx, occasionId);
    const ro = ctx.locale !== "en";
    const head = ro
      ? ["Tip", "Titlu", "Plecare (ora locală)", "Fus plecare", "Plecare (București)", "Sosire (ora locală)", "Fus sosire", "Sosire (București)", "De la", "Până la", "Cod rezervare", "Grup"]
      : ["Kind", "Title", "Departs (local)", "Departure zone", "Departs (Bucharest)", "Arrives (local)", "Arrival zone", "Arrives (Bucharest)", "From", "To", "Booking code", "Group"];
    const local = (d: Date | null, tz: string) => (d ? instantToLocal(d, tz).replace("T", " ") : "");
    const rows = it.legs.map((l) => [l.kind, l.title, local(l.startsAt, l.startTz), l.startTz, local(l.startsAt, BUCHAREST), local(l.endsAt, l.endTz), l.endsAt ? l.endTz : "", local(l.endsAt, BUCHAREST), l.placeFrom, l.placeTo, l.reference, l.subgroupName]);
    return { filename: "itinerar.csv", mime: "text/csv; charset=utf-8", content: toCsv(head, rows) };
  },
});
