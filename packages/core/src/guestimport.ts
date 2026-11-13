import { createHash } from "node:crypto";
import { asc, eq, guests, households, type WhatIfDeltaRow } from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { detectChildDetails, insertHousehold, nameKey } from "./guests";
import { createPreview, discardPreview, getPreview, registerWhatIf, type WhatIfPreview } from "./whatif";

// Guest list import from CSV or XLSX (A13).
//
//   file -> parseGuestFile() -> suggestMapping() -> proposeGuestImport()  = a What-if preview
//   holding the diff (create / change / skip). NOTHING is written until the planner applies
//   the preview; "Renunță" drops it and the list is untouched. Applying executes exactly the
//   stored plan — and refuses (CONFLICT, stale) if the guest list changed in between.
//
// One file row is one adult (and/or one household). Children are never imported: a column
// that describes a child (age, birth date) is refused with an explanation, and a count
// column for children is ignored — the number of children comes only from the RSVP.

export const IMPORT_KIND = "guests.import";
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_COLS = 30;
const PREVIEW_ROWS = 200;

export type ImportTable = { headers: string[]; rows: string[][] };

export const IMPORT_FIELDS = ["household", "name", "email", "language", "partySize", "notes"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** field -> column index (absent = not in the file) */
export type ImportMapping = Partial<Record<ImportField, number>>;

/* ── Parsing ─────────────────────────────────────────────────────────────── */

function decodeText(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // older Excel "CSV" exports on Romanian Windows
    text = new TextDecoder("windows-1250").decode(bytes);
  }
  return text.replace(/^\uFEFF/, "").normalize("NFC");
}

function detectSeparator(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = -1;
  for (const sep of [";", ",", "\t"]) {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === '"') quoted = !quoted;
      else if (ch === sep && !quoted) count++;
    }
    if (count > bestCount) {
      best = sep;
      bestCount = count;
    }
  }
  return best;
}

/** RFC 4180-style CSV: `;` `,` or tab, quoted cells, doubled quotes, CRLF or LF, BOM. */
export function parseCsv(text: string): string[][] {
  const sep = detectSeparator(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function toTable(raw: unknown[][]): ImportTable {
  const cells = raw
    .map((r) => r.map((c) => (c === null || c === undefined ? "" : c instanceof Date ? c.toISOString().slice(0, 10) : String(c)).trim()))
    .filter((r) => r.some((c) => c !== ""));
  const [head, ...rows] = cells;
  if (!head || rows.length === 0) throw new AppError("VALIDATION", "guests.import.errors.empty");
  if (rows.length > IMPORT_MAX_ROWS) {
    throw new AppError("VALIDATION", "guests.import.errors.tooManyRows", { params: { max: IMPORT_MAX_ROWS } });
  }
  const width = Math.min(IMPORT_MAX_COLS, Math.max(head.length, ...rows.map((r) => r.length)));
  const headers = Array.from({ length: width }, (_, i) => (head[i] ?? "").slice(0, 80));
  return {
    headers,
    rows: rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").slice(0, 300))),
  };
}

/** Reads a .csv or .xlsx upload into a plain table. Throws VALIDATION with a clear reason. */
export async function parseGuestFile(file: { name: string; bytes: Uint8Array }): Promise<ImportTable> {
  if (file.bytes.byteLength === 0) throw new AppError("VALIDATION", "guests.import.errors.empty");
  if (file.bytes.byteLength > IMPORT_MAX_BYTES) throw new AppError("VALIDATION", "guests.import.errors.tooBig");
  const zip = file.bytes[0] === 0x50 && file.bytes[1] === 0x4b; // "PK": an .xlsx is a zip
  if (zip) {
    try {
      const { readSheet } = await import("read-excel-file/node");
      const data = await readSheet(Buffer.from(file.bytes));
      return toTable(data as unknown[][]);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("VALIDATION", "guests.import.errors.unreadable");
    }
  }
  if (!/\.(csv|txt)$/i.test(file.name) && file.bytes.includes(0)) {
    throw new AppError("VALIDATION", "guests.import.errors.unreadable");
  }
  return toTable(parseCsv(decodeText(file.bytes)));
}

/* ── Mapping ─────────────────────────────────────────────────────────────── */

const HEADER_HINTS: Record<ImportField, RegExp> = {
  household: /^(familie|familia|gospodarie|gospodaria|household|family|grup|group|invitatie|invitation|party)$/,
  name: /^(nume|nume complet|nume si prenume|nume prenume|prenume si nume|invitat|invitati|persoana|name|full name|fullname|guest|guest name|person)$/,
  email: /^(e ?-?mail|email address|adresa de e ?-?mail|adresa e ?-?mail|mail)$/,
  language: /^(limba|limba invitatiei|language|lang)$/,
  partySize: /^(persoane|nr persoane|numar persoane|numar de persoane|nr invitati|numar invitati|party size|size|people|guests|locuri|seats|adulti|adults)$/,
  notes: /^(note|notite|observatii|mentiuni|comentarii|notes|comments|remarks)$/,
};
/** Columns that describe a child. They are never imported (invariant 9). */
const CHILD_HEADER =
  /(varsta|age|data nasterii|data de nastere|zi de nastere|nascut|birth|dob|nume copil|numele copilului|copil nume|child name|kid name|cnp)/;

const headerKey = (h: string): string =>
  nameKey(h)
    .replace(/[._:()#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Auto-suggests which column is which from the header names (ro/en, with or without diacritics). */
export function suggestMapping(headers: string[]): { mapping: ImportMapping; childColumns: number[] } {
  const mapping: ImportMapping = {};
  const childColumns: number[] = [];
  headers.forEach((h, i) => {
    const key = headerKey(h);
    if (!key) return;
    if (CHILD_HEADER.test(key)) {
      childColumns.push(i);
      return;
    }
    for (const field of IMPORT_FIELDS) {
      if (mapping[field] === undefined && HEADER_HINTS[field].test(key)) {
        mapping[field] = i;
        return;
      }
    }
  });
  return { mapping, childColumns };
}

/* ── The diff ────────────────────────────────────────────────────────────── */

const planRow = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().min(1).max(120),
    adults: z.array(z.string().min(1).max(120)).max(40),
    email: z.string().max(254).optional(),
    language: z.enum(["ro", "en"]).optional(),
    partySize: z.number().int().min(1).max(200).optional(),
    notes: z.string().max(1000).optional(),
  }),
  z.object({
    action: z.literal("change"),
    householdId: z.string().min(1).max(64),
    name: z.string().min(1).max(120),
    addAdults: z.array(z.string().min(1).max(120)).max(40),
    email: z.string().max(254).optional(),
    partySize: z.number().int().min(1).max(200).optional(),
  }),
  z.object({
    action: z.literal("skip"),
    name: z.string().max(120),
    reason: z.enum(["duplicate", "noName", "childDetails", "badEmail"]),
  }),
]);
export type ImportPlanRow = z.infer<typeof planRow>;

const importInput = z.object({
  fileName: z.string().max(200),
  table: z.object({
    headers: z.array(z.string().max(80)).max(IMPORT_MAX_COLS),
    rows: z.array(z.array(z.string().max(300)).max(IMPORT_MAX_COLS)).max(IMPORT_MAX_ROWS),
  }),
  mapping: z.object(
    Object.fromEntries(IMPORT_FIELDS.map((f) => [f, z.number().int().min(0).max(IMPORT_MAX_COLS).optional()])) as Record<
      ImportField,
      z.ZodOptional<z.ZodNumber>
    >,
  ),
  plan: z.array(planRow).max(IMPORT_MAX_ROWS * 2),
  /** fingerprint of the guest list the plan was computed against */
  fingerprint: z.string().length(64),
});
export type ImportInput = z.infer<typeof importInput>;

async function existingList(ctx: Ctx, occasionId: string) {
  const [hs, gs] = await Promise.all([
    ctx.db.select().from(households).where(eq(households.occasionId, occasionId)).orderBy(asc(households.id)),
    ctx.db.select().from(guests).where(eq(guests.occasionId, occasionId)).orderBy(asc(guests.id)),
  ]);
  const fingerprint = createHash("sha256")
    .update(JSON.stringify([hs.map((h) => [h.id, h.name, h.leadEmail, h.expectedPartySize]), gs.map((g) => [g.householdId, g.fullName])]))
    .digest("hex");
  return { hs, gs, fingerprint };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Pure: builds the create / change / skip plan from the table, the mapping and the current list. */
export function planImport(
  table: ImportTable,
  mapping: ImportMapping,
  existing: {
    households: Array<{ id: string; name: string; leadEmail: string | null; expectedPartySize: number | null }>;
    guests: Array<{ householdId: string; fullName: string }>;
  },
): ImportPlanRow[] {
  const col = (row: string[], f: ImportField): string => {
    const i = mapping[f];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  type Group = { name: string; adults: string[]; email?: string; language?: "ro" | "en"; partySize?: number; notes?: string };
  const groups = new Map<string, Group>();
  const skips: ImportPlanRow[] = [];

  for (const row of table.rows) {
    const person = col(row, "name");
    const label = col(row, "household") || person;
    if (!label) {
      skips.push({ action: "skip", name: "", reason: "noName" });
      continue;
    }
    const notes = col(row, "notes");
    if (detectChildDetails(person) || detectChildDetails(label) || detectChildDetails(notes)) {
      skips.push({ action: "skip", name: (person || label).slice(0, 120), reason: "childDetails" });
      continue;
    }
    const key = nameKey(label);
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name: label.slice(0, 120), adults: [] }));
    if (person) {
      if (g.adults.some((a) => nameKey(a) === nameKey(person))) {
        skips.push({ action: "skip", name: person.slice(0, 120), reason: "duplicate" });
        continue;
      }
      g.adults.push(person.slice(0, 120));
    }
    const email = col(row, "email").toLowerCase();
    if (email && !g.email) {
      if (EMAIL_RE.test(email) && email.length <= 254) g.email = email;
      else skips.push({ action: "skip", name: `${label}: ${email}`.slice(0, 120), reason: "badEmail" });
    }
    const lang = nameKey(col(row, "language"));
    if (!g.language && lang) g.language = /^(en|eng|english|engleza)$/.test(lang) ? "en" : "ro";
    const size = Number(col(row, "partySize"));
    if (!g.partySize && Number.isInteger(size) && size >= 1 && size <= 200) g.partySize = size;
    if (!g.notes && notes) g.notes = notes.slice(0, 1000);
  }

  const byKey = new Map(existing.households.map((h) => [nameKey(h.name), h]));
  const plan: ImportPlanRow[] = [];
  for (const [key, g] of groups) {
    const found = byKey.get(key);
    if (!found) {
      plan.push({ action: "create", ...g });
      continue;
    }
    const have = new Set(existing.guests.filter((x) => x.householdId === found.id).map((x) => nameKey(x.fullName)));
    const addAdults = g.adults.filter((a) => !have.has(nameKey(a)));
    for (const a of g.adults.filter((x) => have.has(nameKey(x)))) {
      plan.push({ action: "skip", name: `${a} · ${found.name}`.slice(0, 120), reason: "duplicate" });
    }
    const email = g.email && g.email !== (found.leadEmail ?? "") ? g.email : undefined;
    const partySize = g.partySize && g.partySize !== found.expectedPartySize ? g.partySize : undefined;
    if (addAdults.length > 0 || email || partySize) {
      plan.push({ action: "change", householdId: found.id, name: found.name, addAdults, email, partySize });
    } else if (g.adults.length === 0) {
      plan.push({ action: "skip", name: found.name, reason: "duplicate" });
    }
  }
  return [...plan, ...skips];
}

export function summarisePlan(plan: ImportPlanRow[]): { create: number; change: number; skip: number } {
  return {
    create: plan.filter((p) => p.action === "create").length,
    change: plan.filter((p) => p.action === "change").length,
    skip: plan.filter((p) => p.action === "skip").length,
  };
}

function planDelta(plan: ImportPlanRow[]): WhatIfDeltaRow[] {
  const rows: WhatIfDeltaRow[] = plan.slice(0, PREVIEW_ROWS).map((p, i) => {
    if (p.action === "create") {
      return {
        key: `r${i}`,
        what: p.name,
        kindLabelKey: "guests.import.kinds.create",
        after: p.adults.length > 0 ? p.adults.join(", ") : { key: "guests.import.noAdultsNamed" },
      };
    }
    if (p.action === "change") {
      const parts = [
        ...(p.addAdults.length ? [`+ ${p.addAdults.join(", ")}`] : []),
        ...(p.email ? [p.email] : []),
        ...(p.partySize ? [String(p.partySize)] : []),
      ];
      return { key: `r${i}`, what: p.name, kindLabelKey: "guests.import.kinds.change", after: parts.join(" · ") };
    }
    return {
      key: `r${i}`,
      what: p.name || { key: "guests.import.emptyRow" },
      kindLabelKey: "guests.import.kinds.skip",
      noteKey: `guests.import.skip.${p.reason}`,
    };
  });
  if (plan.length > PREVIEW_ROWS) {
    rows.push({ key: "_more", what: { key: "guests.import.moreRows", params: { count: plan.length - PREVIEW_ROWS } } });
  }
  return rows;
}

registerWhatIf<ImportInput>(IMPORT_KIND, {
  input: importInput,
  authorize: async (ctx, subject) => {
    if (!subject.occasionId) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    await requireMember(ctx, subject.occasionId, { manage: true });
  },
  // the delta is always derived from the stored plan, so what is shown is what is applied
  compute: async (_ctx, input) => {
    const s = summarisePlan(input.plan);
    return {
      title: { key: "guests.import.whatifTitle", params: { create: s.create, change: s.change, skip: s.skip } },
      delta: planDelta(input.plan),
    };
  },
  apply: async (tx, preview) => {
    const occasionId = preview.occasionId!;
    const { fingerprint } = await existingList(tx, occasionId);
    if (fingerprint !== preview.input.fingerprint) throw new AppError("CONFLICT", "whatif.errors.stale");
    let created = 0;
    let changed = 0;
    for (const p of preview.input.plan) {
      if (p.action === "create") {
        await insertHousehold(tx, {
          occasionId,
          name: p.name,
          leadEmail: p.email,
          language: p.language ?? "ro",
          expectedPartySize: p.partySize,
          notes: p.notes,
          guestNames: p.adults,
        });
        created++;
      } else if (p.action === "change") {
        if (p.addAdults.length > 0) {
          await tx.db
            .insert(guests)
            .values(p.addAdults.map((fullName) => ({ occasionId, householdId: p.householdId, fullName })));
        }
        if (p.email || p.partySize) {
          await tx.db
            .update(households)
            .set({ ...(p.email ? { leadEmail: p.email } : {}), ...(p.partySize ? { expectedPartySize: p.partySize } : {}) })
            .where(eq(households.id, p.householdId));
        }
        changed++;
      }
    }
    await audit(tx, {
      action: "guests.imported",
      objectType: "occasion",
      objectId: occasionId,
      meta: { created, changed, fileName: preview.input.fileName },
    });
  },
});

const proposeInput = z.object({
  occasionId: z.string().min(1).max(64),
  fileName: z.string().max(200).default("import"),
  table: importInput.shape.table,
  mapping: importInput.shape.mapping,
  /** a previous preview of the same upload to drop (the planner changed the mapping) */
  replacesPreviewId: z.string().min(1).max(64).optional(),
});

/**
 * Builds the diff for a parsed file + mapping and stores it as a What-if preview. Nothing is
 * imported until confirmPreview(); discardPreview() leaves the guest list untouched.
 * Refuses a mapping that points at a child-detail column (age, birth date).
 */
export async function proposeGuestImport(ctx: Ctx, input: z.input<typeof proposeInput>): Promise<WhatIfPreview> {
  const data = proposeInput.parse(input);
  await requireMember(ctx, data.occasionId, { manage: true });
  const { childColumns } = suggestMapping(data.table.headers);
  const used = Object.entries(data.mapping).filter(([, i]) => i !== undefined) as Array<[ImportField, number]>;
  const bad = used.filter(([, i]) => childColumns.includes(i) || i >= data.table.headers.length);
  if (bad.length > 0) {
    throw new AppError("VALIDATION", "guests.import.errors.childColumn", {
      fieldErrors: Object.fromEntries(bad.map(([f]) => [`map_${f}`, ["guests.import.errors.childColumn"]])),
    });
  }
  if (data.mapping.name === undefined && data.mapping.household === undefined) {
    throw new AppError("VALIDATION", "guests.import.errors.needNameColumn", {
      fieldErrors: { map_name: ["guests.import.errors.needNameColumn"] },
    });
  }
  const current = await existingList(ctx, data.occasionId);
  const plan = planImport(data.table, data.mapping, { households: current.hs, guests: current.gs });
  const preview = await createPreview(ctx, {
    kind: IMPORT_KIND,
    occasionId: data.occasionId,
    subjectType: "occasion",
    subjectId: data.occasionId,
    input: { fileName: data.fileName, table: data.table, mapping: data.mapping, plan, fingerprint: current.fingerprint },
  });
  if (data.replacesPreviewId) {
    await discardPreview(ctx, data.replacesPreviewId).catch(() => undefined);
  }
  return preview;
}

export type ImportPreviewView = {
  preview: WhatIfPreview;
  headers: string[];
  sampleRows: string[][];
  rowCount: number;
  mapping: ImportMapping;
  /** indexes of columns that describe a child and are therefore never imported */
  childColumns: number[];
  summary: { create: number; change: number; skip: number };
};

/** The stored upload behind an import preview: headers, sample, mapping, counts. */
export async function getImportPreview(ctx: Ctx, previewId: string): Promise<ImportPreviewView> {
  const preview = await getPreview(ctx, previewId);
  if (preview.kind !== IMPORT_KIND) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  const input = importInput.parse(preview.input);
  return {
    preview,
    headers: input.table.headers,
    sampleRows: input.table.rows.slice(0, 5),
    rowCount: input.table.rows.length,
    mapping: input.mapping,
    childColumns: suggestMapping(input.table.headers).childColumns,
    summary: summarisePlan(input.plan),
  };
}

/** Re-plans a stored upload with a different column mapping (replaces the old preview). */
export async function remapGuestImport(
  ctx: Ctx,
  input: { previewId: string; mapping: ImportMapping },
): Promise<WhatIfPreview> {
  const preview = await getPreview(ctx, input.previewId);
  if (preview.kind !== IMPORT_KIND || preview.state !== "pending" || !preview.occasionId) {
    throw new AppError("CONFLICT", "whatif.errors.stale");
  }
  const stored = importInput.parse(preview.input);
  return proposeGuestImport(ctx, {
    occasionId: preview.occasionId,
    fileName: stored.fileName,
    table: stored.table,
    mapping: input.mapping,
    replacesPreviewId: preview.id,
  });
}
