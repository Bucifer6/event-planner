import {
  briefingAcks,
  briefingVersions,
  bookings,
  deliveries,
  desc,
  eq,
  and,
  occasionMembers,
  readinessDecisions,
  readinessDecisionSchema,
  suppliers,
  tasks,
  accounts,
  READINESS_DECISIONS,
  type EvidenceType,
  type ReadinessDecisionKind,
  type ReadinessEvidence,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { z } from "zod";
import { requireMember, isManager } from "./access";
import { audit } from "./audit";
import { actorAccountId, requireWriteCapable, type Ctx } from "./context";
import { registerOverviewSection } from "./overview";
import { PLANNING_ROLES } from "./suppliers";
import { inTx } from "./tx";

// Readiness decisions (B8): Hold / Proceed / Proceed with conditions
// (Amânăm / Continuăm / Continuăm cu condiții).
//
// - Every decision is tied to EVIDENCE: at least one reference — a task, a delivery, a
//   briefing acknowledgement, or a note carrying a link. A decision without evidence is
//   refused. References are checked to belong to this occasion and their label is stored with
//   the decision, so the history reads the same after the records change.
// - Recorded with actor and time, append-only (DB guard): the newest row is the standing
//   decision, the rest is history.
// - Owner and project manager decide and see the history; the other planning members see the
//   standing decision on the day view and the overview.

export { READINESS_DECISIONS };
export type { EvidenceType, ReadinessDecisionKind, ReadinessEvidence };
export type ReadinessDecision = typeof readinessDecisions.$inferSelect;

const idSchema = z.string().min(1).max(64);
const URL_RE = /^https?:\/\/[^\s<>"']{3,500}$/i;
export const READINESS_MAX_EVIDENCE = 20;

const evidenceInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task"), refId: idSchema }),
  z.object({ type: z.literal("delivery"), refId: idSchema }),
  z.object({ type: z.literal("briefing_ack"), refId: idSchema }),
  z.object({
    type: z.literal("note"),
    label: z.string().trim().min(1, "eventday.errors.noteText").max(300, "common.validation.tooLong"),
    url: z.string().trim().regex(URL_RE, "eventday.errors.noteUrl"),
  }),
]);
export type ReadinessEvidenceInput = z.input<typeof evidenceInput>;

const recordInput = z.object({
  occasionId: idSchema,
  decision: readinessDecisionSchema,
  conditions: z.string().trim().max(1000, "common.validation.tooLong").optional(),
  note: z.string().trim().max(1000, "common.validation.tooLong").optional(),
  evidence: z.array(evidenceInput).max(READINESS_MAX_EVIDENCE, "eventday.errors.evidenceTooMany"),
});

async function resolveEvidence(ctx: Ctx, occasionId: string, e: z.output<typeof evidenceInput>): Promise<ReadinessEvidence> {
  const missing = () =>
    new AppError("VALIDATION", "eventday.errors.evidenceMissing", { fieldErrors: { evidence: ["eventday.errors.evidenceMissing"] } });
  if (e.type === "note") return { type: "note", label: e.label, url: e.url };
  if (e.type === "task") {
    const [t] = await ctx.db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(and(eq(tasks.id, e.refId), eq(tasks.occasionId, occasionId)));
    if (!t) throw missing();
    return { type: "task", refId: t.id, label: t.title };
  }
  if (e.type === "delivery") {
    const [d] = await ctx.db
      .select({ id: deliveries.id, title: deliveries.title })
      .from(deliveries)
      .where(and(eq(deliveries.id, e.refId), eq(deliveries.occasionId, occasionId)));
    if (!d) throw missing();
    return { type: "delivery", refId: d.id, label: d.title };
  }
  const [a] = await ctx.db
    .select({ id: briefingAcks.id, version: briefingVersions.version, supplier: suppliers.name })
    .from(briefingAcks)
    .innerJoin(briefingVersions, eq(briefingVersions.id, briefingAcks.briefingVersionId))
    .innerJoin(bookings, eq(bookings.id, briefingAcks.bookingId))
    .innerJoin(suppliers, eq(suppliers.id, bookings.supplierId))
    .where(and(eq(briefingAcks.id, e.refId), eq(briefingAcks.occasionId, occasionId)));
  if (!a) throw missing();
  return { type: "briefing_ack", refId: a.id, label: `${a.supplier} · v${a.version}` };
}

/**
 * Records a readiness decision. Managers only. VALIDATION (fieldErrors.evidence =
 * eventday.errors.evidenceRequired) without at least one evidence reference; "conditions"
 * needs the conditions written down.
 */
export async function recordReadinessDecision(ctx: Ctx, input: z.input<typeof recordInput>): Promise<{ decisionId: string }> {
  requireWriteCapable(ctx);
  const parsed = recordInput.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "decision");
      const path = issue.path.map(String).join(".");
      const message = key === "decision" ? "eventday.errors.decisionRequired" : issue.message.includes(".") ? issue.message : "common.validation.invalid";
      (fieldErrors[key === "evidence" ? path : key] ??= []).push(message);
    }
    throw new AppError("VALIDATION", "common.errors.VALIDATION", { fieldErrors });
  }
  const data = parsed.data;
  const member = await requireMember(ctx, data.occasionId, { manage: true });
  if (data.evidence.length === 0) {
    throw new AppError("VALIDATION", "eventday.errors.evidenceRequired", { fieldErrors: { evidence: ["eventday.errors.evidenceRequired"] } });
  }
  if (data.decision === "conditions" && !data.conditions) {
    throw new AppError("VALIDATION", "eventday.errors.conditionsRequired", { fieldErrors: { conditions: ["eventday.errors.conditionsRequired"] } });
  }
  const evidence: ReadinessEvidence[] = [];
  for (const e of data.evidence) evidence.push(await resolveEvidence(ctx, data.occasionId, e));
  const accountId = actorAccountId(ctx.actor);
  const [who] = accountId
    ? await ctx.db
        .select({ label: occasionMembers.customLabel, email: accounts.email, username: accounts.username })
        .from(occasionMembers)
        .leftJoin(accounts, eq(accounts.id, occasionMembers.accountId))
        .where(eq(occasionMembers.id, member.id))
    : [];
  return inTx(ctx, async (tx) => {
    const [row] = await tx.db
      .insert(readinessDecisions)
      .values({
        occasionId: data.occasionId,
        decision: data.decision,
        conditions: data.decision === "conditions" ? (data.conditions ?? null) : null,
        note: data.note || null,
        evidence,
        decidedByMemberId: member.id,
        decidedByAccountId: accountId,
        decidedByName: who?.username ?? who?.email ?? who?.label ?? null,
        decidedAt: tx.now,
      })
      .returning({ id: readinessDecisions.id });
    await audit(tx, {
      action: "readiness.decided",
      objectType: "readiness_decision",
      objectId: row!.id,
      after: { decision: data.decision, evidence: evidence.map((e) => ({ type: e.type, refId: e.refId ?? null })) },
      meta: { occasionId: data.occasionId },
    });
    return { decisionId: row!.id };
  });
}

/** The standing (newest) decision, or null. NO access check: for checked callers. */
export async function latestReadinessUnchecked(ctx: Ctx, occasionId: string): Promise<ReadinessDecision | null> {
  const [row] = await ctx.db
    .select()
    .from(readinessDecisions)
    .where(eq(readinessDecisions.occasionId, occasionId))
    .orderBy(desc(readinessDecisions.decidedAt), desc(readinessDecisions.createdAt))
    .limit(1);
  return row ?? null;
}

export type ReadinessState = {
  latest: ReadinessDecision | null;
  /** Newest first. Empty for members who are not managers. */
  history: ReadinessDecision[];
  canDecide: boolean;
};

/** Standing decision for planning members; the full history for managers. */
export async function getReadiness(ctx: Ctx, occasionId: string): Promise<ReadinessState> {
  const member = await requireMember(ctx, occasionId, { roles: PLANNING_ROLES });
  const manager = isManager(member);
  if (!manager) return { latest: await latestReadinessUnchecked(ctx, occasionId), history: [], canDecide: false };
  const history = await ctx.db
    .select()
    .from(readinessDecisions)
    .where(eq(readinessDecisions.occasionId, occasionId))
    .orderBy(desc(readinessDecisions.decidedAt), desc(readinessDecisions.createdAt))
    .limit(100);
  return { latest: history[0] ?? null, history, canDecide: true };
}

export type EvidenceOptions = {
  tasks: Array<{ id: string; label: string }>;
  deliveries: Array<{ id: string; label: string }>;
  acks: Array<{ id: string; label: string }>;
};

/** What a manager can point to as evidence: the occasion's tasks, deliveries and acknowledgements. */
export async function listEvidenceOptions(ctx: Ctx, occasionId: string): Promise<EvidenceOptions> {
  await requireMember(ctx, occasionId, { manage: true });
  const [t, d, a] = await Promise.all([
    ctx.db.select({ id: tasks.id, label: tasks.title }).from(tasks).where(eq(tasks.occasionId, occasionId)).orderBy(tasks.dueAt, tasks.createdAt).limit(300),
    ctx.db.select({ id: deliveries.id, label: deliveries.title }).from(deliveries).where(eq(deliveries.occasionId, occasionId)).orderBy(deliveries.expectedFrom).limit(200),
    ctx.db
      .select({ id: briefingAcks.id, version: briefingVersions.version, supplier: suppliers.name })
      .from(briefingAcks)
      .innerJoin(briefingVersions, eq(briefingVersions.id, briefingAcks.briefingVersionId))
      .innerJoin(bookings, eq(bookings.id, briefingAcks.bookingId))
      .innerJoin(suppliers, eq(suppliers.id, bookings.supplierId))
      .where(eq(briefingAcks.occasionId, occasionId))
      .orderBy(desc(briefingAcks.ackAt))
      .limit(100),
  ]);
  return { tasks: t, deliveries: d, acks: a.map((x) => ({ id: x.id, label: `${x.supplier} · v${x.version}` })) };
}

registerOverviewSection({
  key: "readiness",
  forMember: async (ctx, member, occasionId) => {
    if (!PLANNING_ROLES.includes(member.role)) return null;
    const latest = await latestReadinessUnchecked(ctx, occasionId);
    if (!latest) return null;
    const date = new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(latest.decidedAt);
    const lines: Array<string | { key: string; params?: Record<string, string | number> }> = [
      { key: `eventday.readiness.overview.${latest.decision}`, params: { date, name: latest.decidedByName ?? "—" } },
    ];
    if (latest.conditions) lines.push({ key: "eventday.readiness.overview.conditions_text", params: { conditions: latest.conditions } });
    return { titleKey: "eventday.readiness.title", lines, slug: "day" };
  },
});
