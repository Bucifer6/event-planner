import type { StaffRole } from "@ed/db";
import { bucharestDateKey } from "@ed/shared/time";
import { z } from "zod";
import type { Ctx } from "./context";
import { readSetting, requireStaffRole, writeSetting } from "./staff";

// Launch obligations and legal scaffolding (PRD §20: LAU1–LAU9; R0-17).
//
// Everything here is OPERATOR-OWNED content: the console offers fields, the operator fills
// them. Nothing is pre-filled or guessed — an empty field means "not recorded".
//
// platform_settings keys:
//   "launch.checklist"  { LAU1..LAU9: { status, evidenceRef, note, updatedByStaffId, updatedAt } }
//   "launch.records"    ANSPDCP registration, DPIA, accessibility statement, ANCOM (LAU2/8/9)
//   "legal.published"   versions + dates of the published legal documents (LAU1)

export const LAUNCH_CHECKLIST_SETTING = "launch.checklist";
export const LAUNCH_RECORDS_SETTING = "launch.records";
export const LEGAL_PUBLISHED_SETTING = "legal.published";

export const LAUNCH_ITEMS = ["LAU1", "LAU2", "LAU3", "LAU4", "LAU5", "LAU6", "LAU7", "LAU8", "LAU9"] as const;
export type LaunchItemId = (typeof LAUNCH_ITEMS)[number];

/** The staff role that owns each obligation (PRD §20). platform_admin may record any. */
export const LAUNCH_ITEM_OWNER: Record<LaunchItemId, StaffRole> = {
  LAU1: "privacy_owner",
  LAU2: "privacy_owner",
  LAU3: "security_administrator",
  LAU4: "security_administrator",
  LAU5: "security_administrator",
  LAU6: "commercial_manager",
  LAU7: "platform_admin",
  LAU8: "platform_admin",
  LAU9: "privacy_owner",
};

export const LAUNCH_STATUSES = ["open", "in_progress", "done"] as const;
export type LaunchStatus = (typeof LAUNCH_STATUSES)[number];

export type LaunchItemRecord = {
  status: LaunchStatus;
  /** Free text pointing at the evidence (document name, ticket, folder). */
  evidenceRef: string | null;
  note: string | null;
  updatedByStaffId: string | null;
  updatedAt: string | null;
};

export type LaunchChecklist = Record<LaunchItemId, LaunchItemRecord>;

const emptyItem: LaunchItemRecord = {
  status: "open",
  evidenceRef: null,
  note: null,
  updatedByStaffId: null,
  updatedAt: null,
};

const blankToNull = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : v),
    z.string().trim().max(max, "common.validation.tooLong").nullish(),
  );
/** yyyy-mm-dd or empty. */
const dateOrNull = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "common.validation.invalid").nullish(),
);

const LAUNCH_READ_ROLES: StaffRole[] = [
  "platform_admin",
  "privacy_owner",
  "security_administrator",
  "commercial_manager",
];

export async function getLaunchChecklist(ctx: Ctx): Promise<LaunchChecklist> {
  requireStaffRole(ctx, ...LAUNCH_READ_ROLES);
  const stored = (await readSetting<Partial<LaunchChecklist>>(ctx, LAUNCH_CHECKLIST_SETTING)) ?? {};
  return Object.fromEntries(
    LAUNCH_ITEMS.map((id) => [id, { ...emptyItem, ...(stored[id] ?? {}) }]),
  ) as LaunchChecklist;
}

const itemInput = z.object({
  item: z.enum(LAUNCH_ITEMS),
  status: z.enum(LAUNCH_STATUSES),
  evidenceRef: blankToNull(500),
  note: blankToNull(2000),
});

/** Records the state of one launch obligation: who, when, and where the evidence is. */
export async function setLaunchItem(ctx: Ctx, input: z.input<typeof itemInput>): Promise<LaunchItemRecord> {
  const data = itemInput.parse(input);
  const staffId = requireStaffRole(ctx, "platform_admin", LAUNCH_ITEM_OWNER[data.item]);
  const stored = (await readSetting<Partial<LaunchChecklist>>(ctx, LAUNCH_CHECKLIST_SETTING)) ?? {};
  const record: LaunchItemRecord = {
    status: data.status,
    evidenceRef: data.evidenceRef ?? null,
    note: data.note ?? null,
    updatedByStaffId: staffId,
    updatedAt: ctx.now.toISOString(),
  };
  await writeSetting(ctx, LAUNCH_CHECKLIST_SETTING, { ...stored, [data.item]: record });
  return record;
}

/* ── LAU2 / LAU8 / LAU9 records ─────────────────────────────────────────── */

const recordsSchema = z.object({
  /** LAU2: ANSPDCP formalities. */
  anspdcpReference: blankToNull(300),
  anspdcpDate: dateOrNull,
  processingRegistryRef: blankToNull(300),
  /** LAU2: the signed DPIA. */
  dpiaReference: blankToNull(300),
  dpiaSignedOn: dateOrNull,
  dpiaSignedBy: blankToNull(200),
  dpiaLastReviewedOn: dateOrNull,
  /** LAU8: ANCOM registration and the published point of contact. */
  ancomReference: blankToNull(300),
  ancomDate: dateOrNull,
  dsaContactPoint: blankToNull(300),
  /** LAU9: accessibility statement date and how conformance was evaluated. */
  accessibilityStatementDate: dateOrNull,
  accessibilityEvaluationMethod: blankToNull(1000),
});
export type LaunchRecordsInput = z.input<typeof recordsSchema>;
export type LaunchRecords = {
  [K in keyof z.output<typeof recordsSchema>]: string | null;
} & { updatedByStaffId: string | null; updatedAt: string | null };

export const LAUNCH_RECORD_FIELDS = Object.keys(recordsSchema.shape) as Array<
  keyof z.output<typeof recordsSchema>
>;

export async function getLaunchRecords(ctx: Ctx): Promise<LaunchRecords> {
  requireStaffRole(ctx, ...LAUNCH_READ_ROLES);
  const stored = (await readSetting<Partial<LaunchRecords>>(ctx, LAUNCH_RECORDS_SETTING)) ?? {};
  const out = Object.fromEntries(LAUNCH_RECORD_FIELDS.map((k) => [k, stored[k] ?? null]));
  return {
    ...(out as Record<keyof z.output<typeof recordsSchema>, string | null>),
    updatedByStaffId: stored.updatedByStaffId ?? null,
    updatedAt: stored.updatedAt ?? null,
  };
}

export async function setLaunchRecords(ctx: Ctx, input: LaunchRecordsInput): Promise<void> {
  const staffId = requireStaffRole(ctx, "platform_admin", "privacy_owner");
  const data = recordsSchema.parse(input);
  const clean = Object.fromEntries(LAUNCH_RECORD_FIELDS.map((k) => [k, data[k] ?? null]));
  await writeSetting(ctx, LAUNCH_RECORDS_SETTING, {
    ...clean,
    updatedByStaffId: staffId,
    updatedAt: ctx.now.toISOString(),
  });
}

/* ── LAU1: published legal documents gate account creation ──────────────── */

export const LEGAL_DOCS = ["terms", "businessTerms", "privacy", "cookies"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];
/** The documents that must be published before any account can be created (LAU1). */
export const LEGAL_DOCS_REQUIRED_FOR_SIGNUP: LegalDoc[] = ["terms", "privacy", "cookies"];

export type LegalPublished = Record<LegalDoc, { version: string | null; publishedOn: string | null }> & {
  updatedByStaffId: string | null;
  updatedAt: string | null;
};

const legalSchema = z.object(
  Object.fromEntries(
    LEGAL_DOCS.flatMap((d) => [
      [`${d}Version`, blankToNull(60)],
      [`${d}PublishedOn`, dateOrNull],
    ]),
  ) as Record<`${LegalDoc}Version` | `${LegalDoc}PublishedOn`, ReturnType<typeof blankToNull>>,
);
export type LegalPublishedInput = z.input<typeof legalSchema>;

async function readLegal(ctx: Pick<Ctx, "db">): Promise<LegalPublished> {
  const stored = (await readSetting<Partial<LegalPublished>>(ctx, LEGAL_PUBLISHED_SETTING)) ?? {};
  const docs = Object.fromEntries(
    LEGAL_DOCS.map((d) => [
      d,
      { version: stored[d]?.version ?? null, publishedOn: stored[d]?.publishedOn ?? null },
    ]),
  ) as Record<LegalDoc, { version: string | null; publishedOn: string | null }>;
  return { ...docs, updatedByStaffId: stored.updatedByStaffId ?? null, updatedAt: stored.updatedAt ?? null };
}

export async function getLegalPublished(ctx: Ctx): Promise<LegalPublished> {
  requireStaffRole(ctx, ...LAUNCH_READ_ROLES);
  return readLegal(ctx);
}

export async function setLegalPublished(ctx: Ctx, input: LegalPublishedInput): Promise<void> {
  const staffId = requireStaffRole(ctx, "platform_admin", "privacy_owner");
  const data = legalSchema.parse(input) as Record<string, string | null | undefined>;
  const docs = Object.fromEntries(
    LEGAL_DOCS.map((d) => [
      d,
      { version: data[`${d}Version`] ?? null, publishedOn: data[`${d}PublishedOn`] ?? null },
    ]),
  );
  await writeSetting(ctx, LEGAL_PUBLISHED_SETTING, {
    ...docs,
    updatedByStaffId: staffId,
    updatedAt: ctx.now.toISOString(),
  });
}

/**
 * LAU1 gate: true only when the terms, the privacy policy and the cookie notice each have a
 * recorded version and a publication date that is not in the future. Readable by anyone —
 * it reveals only whether sign-up is open. The sign-in flow must refuse to CREATE an account
 * while this is false (existing accounts keep signing in).
 */
export async function areLegalDocsPublished(ctx: Pick<Ctx, "db" | "now">): Promise<boolean> {
  const legal = await readLegal(ctx);
  const today = bucharestDateKey(ctx.now);
  return LEGAL_DOCS_REQUIRED_FOR_SIGNUP.every((d) => {
    const doc = legal[d];
    return !!doc.version && !!doc.publishedOn && doc.publishedOn <= today;
  });
}
