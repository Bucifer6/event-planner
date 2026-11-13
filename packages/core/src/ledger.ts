import {
  accounts,
  and,
  asc,
  desc,
  eq,
  households,
  inArray,
  isNull,
  ledgerEntries,
  ledgerParticipants,
  ledgerShares,
  occasionMembers,
  occasions,
  sql,
  type LedgerParticipantKind,
  type LedgerSplitMode,
} from "@ed/db";
import { AppError } from "@ed/shared/errors";
import { DEFAULT_CURRENCY, splitByWeights, splitEvenly } from "@ed/shared/money";
import { zCurrency, zIdempotencyKey, zText } from "@ed/shared/zod";
import { z } from "zod";
import { requireMember } from "./access";
import { audit } from "./audit";
import { fileSlug, plainMoney, requireFinance } from "./budget";
import { requireWriteCapable, type Ctx } from "./context";
import { recordCorrection } from "./corrections";
import { registerExport, toCsv } from "./exports";
import { assertOccasionWritable, registerCloseoutSection, registerLifecycleImpact, type DeltaRow } from "./lifecycle";
import { onOccasionPurge } from "./occasions";
import { registerOverviewSection } from "./overview";
import { zDay } from "./templates";
import { inTx } from "./tx";

// Shared-cost ledger (B3): ONE balanced ledger per occasion.
//
//   entry  = who paid (one participant) + amount + currency + who benefits (shares)
//   shares = exact minor units per beneficiary, computed with splitEvenly / splitByWeights, or
//            typed exactly — they ALWAYS sum to the entry's amount, so for every currency the
//            balances of all participants sum to zero, whatever the split.
//   settle-up payments are entries too (kind "settlement": payer → one beneficiary).
//   balance(p, currency) = paid by p − shares of p.  Positive = is owed money; negative = owes.
//
// Currencies are never converted: each currency has its own balances and its own settlement.
// Entries are facts: never edited, only voided through a correction with a reason.
//
// ACCESS (decided, D2): the ledger — entries, everyone's balances, who owes whom — is finance
// data: it needs the `finance` grant, read and write. A member WITHOUT the grant who is a
// participant can see exactly one thing through getOwnBalance(): their own balance per
// currency and the transfers that involve them. Nothing about anyone else's costs.

export type LedgerParticipant = typeof ledgerParticipants.$inferSelect;
export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type LedgerShare = typeof ledgerShares.$inferSelect;

const idSchema = z.string().min(1).max(64);
const zAmount = z
  .number("ledger.errors.amountRequired")
  .int("common.validation.invalid")
  .safe()
  .min(1, "ledger.errors.amountRequired")
  .max(9_000_000_000_00, "common.validation.tooBig");

export const MAX_LEDGER_PARTICIPANTS = 200;

/* ── Pure maths (exported for tests and reuse) ──────────────────────────── */

export type SplitInput =
  | { mode: "even"; participantIds: string[] }
  | { mode: "shares"; shares: Array<{ participantId: string; weight: number }> }
  | { mode: "exact"; amounts: Array<{ participantId: string; amountMinor: number }> };

export type ComputedShare = { participantId: string; shareMinor: number; weight: number | null };

/**
 * Turns a split into exact shares that sum to `amountMinor`. Throws VALIDATION with a field
 * error on `split` when it cannot: nobody benefits, a participant twice, zero weights, or
 * exact amounts that do not add up (the message params carry the difference).
 */
export function computeShares(amountMinor: number, currency: string, split: SplitInput): ComputedShare[] {
  const fail = (key: string, params?: Record<string, string | number>): never => {
    throw new AppError("VALIDATION", key, { fieldErrors: { split: [key] }, params });
  };
  const ids =
    split.mode === "even"
      ? split.participantIds
      : split.mode === "shares"
        ? split.shares.map((s) => s.participantId)
        : split.amounts.map((a) => a.participantId);
  if (ids.length === 0) fail("ledger.errors.noBeneficiaries");
  if (new Set(ids).size !== ids.length) fail("ledger.errors.duplicateBeneficiary");

  if (split.mode === "even") {
    const parts = splitEvenly(amountMinor, ids.length);
    return ids.map((participantId, i) => ({ participantId, shareMinor: parts[i]!, weight: null }));
  }
  if (split.mode === "shares") {
    const weights = split.shares.map((s) => s.weight);
    if (weights.some((w) => !Number.isSafeInteger(w) || w < 0 || w > 1_000_000) || weights.every((w) => w === 0)) {
      fail("ledger.errors.badShares");
    }
    const parts = splitByWeights(amountMinor, weights);
    return split.shares
      .map((s, i) => ({ participantId: s.participantId, shareMinor: parts[i]!, weight: s.weight }))
      .filter((s) => s.weight > 0);
  }
  if (split.amounts.some((a) => !Number.isSafeInteger(a.amountMinor) || a.amountMinor < 0)) {
    fail("ledger.errors.badExact");
  }
  const sum = split.amounts.reduce((n, a) => n + a.amountMinor, 0);
  if (sum !== amountMinor) {
    const diff = amountMinor - sum;
    fail(diff > 0 ? "ledger.errors.exactShort" : "ledger.errors.exactOver", {
      difference: plainMoney(Math.abs(diff), currency),
      total: plainMoney(amountMinor, currency),
      entered: plainMoney(sum, currency),
    });
  }
  return split.amounts
    .filter((a) => a.amountMinor > 0)
    .map((a) => ({ participantId: a.participantId, shareMinor: a.amountMinor, weight: null }));
}

export type Balance = { participantId: string; balanceMinor: number };
export type Transfer = { fromParticipantId: string; toParticipantId: string; amountMinor: number };

/**
 * Who pays whom so that every balance becomes zero, with as few payments as the greedy rule
 * finds: the person who owes most pays the person who is owed most, repeat. At most n − 1
 * transfers for n people with a non-zero balance; deterministic (ties broken by id).
 * `balances` must sum to zero (it always does for one currency of the ledger).
 */
export function settleUp(balances: Balance[]): Transfer[] {
  const total = balances.reduce((n, b) => n + b.balanceMinor, 0);
  if (total !== 0) throw new RangeError("balances must sum to zero");
  const byAmount = (a: Balance, b: Balance) =>
    b.balanceMinor - a.balanceMinor || (a.participantId < b.participantId ? -1 : 1);
  const creditors = balances.filter((b) => b.balanceMinor > 0).map((b) => ({ ...b })).sort(byAmount);
  const debtors = balances
    .filter((b) => b.balanceMinor < 0)
    .map((b) => ({ participantId: b.participantId, balanceMinor: -b.balanceMinor }))
    .sort(byAmount);
  const transfers: Transfer[] = [];
  while (creditors.length > 0 && debtors.length > 0) {
    const c = creditors[0]!;
    const d = debtors[0]!;
    const amount = Math.min(c.balanceMinor, d.balanceMinor);
    transfers.push({ fromParticipantId: d.participantId, toParticipantId: c.participantId, amountMinor: amount });
    c.balanceMinor -= amount;
    d.balanceMinor -= amount;
    if (c.balanceMinor === 0) creditors.shift();
    if (d.balanceMinor === 0) debtors.shift();
    creditors.sort(byAmount);
    debtors.sort(byAmount);
  }
  return transfers;
}

/* ── Participants ───────────────────────────────────────────────────────── */

async function loadParticipants(ctx: Ctx, occasionId: string): Promise<LedgerParticipant[]> {
  return ctx.db
    .select()
    .from(ledgerParticipants)
    .where(eq(ledgerParticipants.occasionId, occasionId))
    .orderBy(asc(ledgerParticipants.createdAt), asc(ledgerParticipants.id));
}

/** The people who share costs in this occasion (finance grant). */
export async function listParticipants(ctx: Ctx, occasionId: string): Promise<LedgerParticipant[]> {
  const id = idSchema.parse(occasionId);
  await requireFinance(ctx, id);
  return loadParticipants(ctx, id);
}

export type ParticipantCandidates = {
  members: Array<{ id: string; name: string }>;
  households: Array<{ id: string; name: string }>;
};

/** Team members and guest households that are not participants yet (finance grant). */
export async function listParticipantCandidates(ctx: Ctx, occasionId: string): Promise<ParticipantCandidates> {
  const id = idSchema.parse(occasionId);
  await requireFinance(ctx, id);
  const [current, members, hh] = await Promise.all([
    loadParticipants(ctx, id),
    ctx.db
      .select({ id: occasionMembers.id, label: occasionMembers.customLabel, email: accounts.email, username: accounts.username })
      .from(occasionMembers)
      .innerJoin(accounts, eq(accounts.id, occasionMembers.accountId))
      .where(and(eq(occasionMembers.occasionId, id), isNull(occasionMembers.removedAt)))
      .orderBy(asc(occasionMembers.createdAt)),
    ctx.db.select({ id: households.id, name: households.name }).from(households).where(eq(households.occasionId, id)).orderBy(asc(households.name)).limit(1000),
  ]);
  const usedMembers = new Set(current.map((p) => p.memberId));
  const usedHouseholds = new Set(current.map((p) => p.householdId));
  return {
    members: members.filter((m) => !usedMembers.has(m.id)).map((m) => ({ id: m.id, name: memberName(m) })),
    households: hh.filter((h) => !usedHouseholds.has(h.id)),
  };
}

function memberName(m: { label: string | null; email: string | null; username: string | null }): string {
  const base = m.email ?? m.username ?? "";
  return m.label ? `${base} (${m.label})` : base;
}

const addParticipantInput = z
  .object({
    occasionId: idSchema,
    kind: z.enum(["member", "household", "other"]),
    memberId: idSchema.optional(),
    householdId: idSchema.optional(),
    /** Required for "other"; optional display-name override for members and households. */
    name: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), zText(80).optional()),
  })
  .superRefine((v, issue) => {
    if (v.kind === "member" && !v.memberId) issue.addIssue({ code: "custom", path: ["memberId"], message: "common.validation.required" });
    if (v.kind === "household" && !v.householdId) issue.addIssue({ code: "custom", path: ["householdId"], message: "common.validation.required" });
    if (v.kind === "other" && !v.name) issue.addIssue({ code: "custom", path: ["name"], message: "common.validation.required" });
  });

/**
 * Adds someone to the list of people who share costs. A member or household is added once:
 * repeating the call returns the existing participant (Q4).
 */
export async function addParticipant(ctx: Ctx, input: z.input<typeof addParticipantInput>): Promise<LedgerParticipant> {
  requireWriteCapable(ctx);
  const data = addParticipantInput.parse(input);
  await requireFinance(ctx, data.occasionId);
  await assertOccasionWritable(ctx, data.occasionId);
  return inTx(ctx, async (tx) => {
    const current = await loadParticipants(tx, data.occasionId);
    if (current.length >= MAX_LEDGER_PARTICIPANTS) {
      throw new AppError("LIMIT", "ledger.errors.tooManyParticipants", { params: { limit: MAX_LEDGER_PARTICIPANTS } });
    }
    let name = data.name ?? "";
    let memberId: string | null = null;
    let householdId: string | null = null;
    if (data.kind === "member") {
      const existing = current.find((p) => p.memberId === data.memberId);
      if (existing) return existing;
      const [m] = await tx.db
        .select({ id: occasionMembers.id, label: occasionMembers.customLabel, email: accounts.email, username: accounts.username })
        .from(occasionMembers)
        .innerJoin(accounts, eq(accounts.id, occasionMembers.accountId))
        .where(and(eq(occasionMembers.id, data.memberId!), eq(occasionMembers.occasionId, data.occasionId), isNull(occasionMembers.removedAt)));
      if (!m) throw new AppError("VALIDATION", "ledger.errors.participantMissing", { fieldErrors: { memberId: ["ledger.errors.participantMissing"] } });
      memberId = m.id;
      name ||= memberName(m);
    } else if (data.kind === "household") {
      const existing = current.find((p) => p.householdId === data.householdId);
      if (existing) return existing;
      const [h] = await tx.db
        .select({ id: households.id, name: households.name })
        .from(households)
        .where(and(eq(households.id, data.householdId!), eq(households.occasionId, data.occasionId)));
      if (!h) throw new AppError("VALIDATION", "ledger.errors.participantMissing", { fieldErrors: { householdId: ["ledger.errors.participantMissing"] } });
      householdId = h.id;
      name ||= h.name;
    } else if (current.some((p) => p.kind === "other" && p.name.toLowerCase() === name.toLowerCase())) {
      throw new AppError("VALIDATION", "ledger.errors.participantExists", { fieldErrors: { name: ["ledger.errors.participantExists"] } });
    }
    const [row] = await tx.db
      .insert(ledgerParticipants)
      .values({ occasionId: data.occasionId, kind: data.kind as LedgerParticipantKind, memberId, householdId, name, createdAt: tx.now })
      .returning();
    await audit(tx, {
      action: "ledger.participant_added",
      objectType: "ledger_participant",
      objectId: row!.id,
      after: { kind: row!.kind, name: row!.name },
      meta: { occasionId: data.occasionId },
    });
    return row!;
  });
}

/** Removes a participant who appears in no entry (voided ones included: history stays whole). */
export async function removeParticipant(ctx: Ctx, input: { participantId: string }): Promise<void> {
  requireWriteCapable(ctx);
  const id = idSchema.parse(input.participantId);
  const [row] = await ctx.db.select().from(ledgerParticipants).where(eq(ledgerParticipants.id, id));
  if (!row) return;
  await requireFinance(ctx, row.occasionId);
  await assertOccasionWritable(ctx, row.occasionId);
  await inTx(ctx, async (tx) => {
    const [used] = await tx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(ledgerEntries)
      .leftJoin(ledgerShares, eq(ledgerShares.entryId, ledgerEntries.id))
      .where(
        and(
          eq(ledgerEntries.occasionId, row.occasionId),
          sql`(${ledgerEntries.paidByParticipantId} = ${id} or ${ledgerShares.participantId} = ${id})`,
        ),
      );
    if ((used?.n ?? 0) > 0) throw new AppError("CONFLICT", "ledger.errors.participantInUse");
    await tx.db.delete(ledgerParticipants).where(eq(ledgerParticipants.id, id));
    await audit(tx, {
      action: "ledger.participant_removed",
      objectType: "ledger_participant",
      objectId: id,
      before: { kind: row.kind, name: row.name },
      meta: { occasionId: row.occasionId },
    });
  });
}

/* ── Entries ────────────────────────────────────────────────────────────── */

const splitSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("even"), participantIds: z.array(idSchema).max(MAX_LEDGER_PARTICIPANTS) }),
  z.object({
    mode: z.literal("shares"),
    shares: z.array(z.object({ participantId: idSchema, weight: z.number().int().min(0).max(1_000_000) })).max(MAX_LEDGER_PARTICIPANTS),
  }),
  z.object({
    mode: z.literal("exact"),
    amounts: z.array(z.object({ participantId: idSchema, amountMinor: z.number().int().safe().min(0) })).max(MAX_LEDGER_PARTICIPANTS),
  }),
]);

const addEntryInput = z.object({
  occasionId: idSchema,
  description: zText(200),
  amountMinor: zAmount,
  currency: zCurrency.optional(),
  paidByParticipantId: idSchema,
  occurredOn: zDay,
  split: splitSchema,
  expenseId: idSchema.optional(),
  idempotencyKey: zIdempotencyKey,
});
export type AddLedgerEntryInput = z.input<typeof addEntryInput>;

async function insertEntry(
  tx: Ctx,
  v: {
    occasionId: string;
    kind: "cost" | "settlement";
    description: string;
    amountMinor: number;
    currency: string;
    paidByParticipantId: string;
    splitMode: LedgerSplitMode;
    occurredOn: string;
    expenseId?: string;
    memberId: string;
    idempotencyKey: string;
    shares: ComputedShare[];
  },
): Promise<LedgerEntry> {
  const participants = new Set((await loadParticipants(tx, v.occasionId)).map((p) => p.id));
  if (!participants.has(v.paidByParticipantId)) {
    throw new AppError("VALIDATION", "ledger.errors.participantMissing", { fieldErrors: { paidByParticipantId: ["ledger.errors.participantMissing"] } });
  }
  if (v.shares.some((s) => !participants.has(s.participantId))) {
    throw new AppError("VALIDATION", "ledger.errors.participantMissing", { fieldErrors: { split: ["ledger.errors.participantMissing"] } });
  }
  // the invariant everything rests on
  if (v.shares.reduce((n, s) => n + s.shareMinor, 0) !== v.amountMinor) throw new Error("ledger shares do not sum to the amount");
  const inserted = await tx.db
    .insert(ledgerEntries)
    .values({
      occasionId: v.occasionId,
      kind: v.kind,
      description: v.description,
      amountMinor: v.amountMinor,
      currency: v.currency,
      paidByParticipantId: v.paidByParticipantId,
      splitMode: v.splitMode,
      occurredOn: v.occurredOn,
      expenseId: v.expenseId ?? null,
      createdByMemberId: v.memberId,
      idempotencyKey: v.idempotencyKey,
      createdAt: tx.now,
    })
    .onConflictDoNothing({ target: [ledgerEntries.occasionId, ledgerEntries.idempotencyKey] })
    .returning();
  if (!inserted[0]) {
    const [existing] = await tx.db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.occasionId, v.occasionId), eq(ledgerEntries.idempotencyKey, v.idempotencyKey)));
    return existing!;
  }
  await tx.db.insert(ledgerShares).values(
    v.shares.map((s) => ({ entryId: inserted[0]!.id, participantId: s.participantId, shareMinor: s.shareMinor, weight: s.weight })),
  );
  await audit(tx, {
    action: v.kind === "settlement" ? "ledger.settlement_recorded" : "ledger.entry_added",
    objectType: "ledger_entry",
    objectId: inserted[0].id,
    after: { description: v.description, amountMinor: v.amountMinor, currency: v.currency, paidBy: v.paidByParticipantId, shares: v.shares },
    meta: { occasionId: v.occasionId },
  });
  return inserted[0];
}

/**
 * Records a shared cost: who paid, how much, and who benefits (evenly, by shares or exact
 * amounts). Exact amounts that do not add up are refused with a field error on `split` that
 * says the difference. Idempotent per (occasion, idempotencyKey).
 */
export async function addLedgerEntry(ctx: Ctx, input: AddLedgerEntryInput): Promise<LedgerEntry> {
  requireWriteCapable(ctx);
  const data = addEntryInput.parse(input);
  const member = await requireFinance(ctx, data.occasionId);
  await assertOccasionWritable(ctx, data.occasionId);
  const currency = data.currency ?? DEFAULT_CURRENCY;
  const shares = computeShares(data.amountMinor, currency, data.split);
  return inTx(ctx, (tx) =>
    insertEntry(tx, {
      occasionId: data.occasionId,
      kind: "cost",
      description: data.description,
      amountMinor: data.amountMinor,
      currency,
      paidByParticipantId: data.paidByParticipantId,
      splitMode: data.split.mode,
      occurredOn: data.occurredOn,
      expenseId: data.expenseId,
      memberId: member.id,
      idempotencyKey: data.idempotencyKey,
      shares,
    }),
  );
}

const settlementInput = z
  .object({
    occasionId: idSchema,
    fromParticipantId: idSchema,
    toParticipantId: idSchema,
    amountMinor: zAmount,
    currency: zCurrency.optional(),
    occurredOn: zDay,
    idempotencyKey: zIdempotencyKey,
  })
  .refine((v) => v.fromParticipantId !== v.toParticipantId, { message: "ledger.errors.sameParticipant", path: ["toParticipantId"] });

/** Records that one participant paid another back. A fact, and an entry of the same ledger. */
export async function recordSettlement(ctx: Ctx, input: z.input<typeof settlementInput>): Promise<LedgerEntry> {
  requireWriteCapable(ctx);
  const data = settlementInput.parse(input);
  const member = await requireFinance(ctx, data.occasionId);
  await assertOccasionWritable(ctx, data.occasionId);
  return inTx(ctx, (tx) =>
    insertEntry(tx, {
      occasionId: data.occasionId,
      kind: "settlement",
      description: "",
      amountMinor: data.amountMinor,
      currency: data.currency ?? DEFAULT_CURRENCY,
      paidByParticipantId: data.fromParticipantId,
      splitMode: "exact",
      occurredOn: data.occurredOn,
      memberId: member.id,
      idempotencyKey: data.idempotencyKey,
      shares: [{ participantId: data.toParticipantId, shareMinor: data.amountMinor, weight: null }],
    }),
  );
}

const voidInput = z.object({
  entryId: idSchema,
  reason: z.string().trim().min(3, "corrections.errors.reasonRequired").max(1000, "common.validation.tooLong"),
});

/**
 * Takes an entry out of the balances — the only way to undo a recorded cost or settlement.
 * Writes a `corrections` row (reason required) in the same transaction; the entry stays in
 * the list, marked as voided. Owner or project manager holding the finance grant. Idempotent.
 */
export async function voidLedgerEntry(ctx: Ctx, input: z.input<typeof voidInput>): Promise<LedgerEntry> {
  requireWriteCapable(ctx);
  const data = voidInput.parse(input);
  const [seen] = await ctx.db.select().from(ledgerEntries).where(eq(ledgerEntries.id, data.entryId));
  if (!seen) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
  await requireFinance(ctx, seen.occasionId, { manage: true });
  await assertOccasionWritable(ctx, seen.occasionId);
  return inTx(ctx, async (tx) => {
    await tx.db.execute(sql`select id from ledger_entries where id = ${seen.id} for update`);
    const [before] = await tx.db.select().from(ledgerEntries).where(eq(ledgerEntries.id, seen.id));
    if (!before) throw new AppError("NOT_FOUND", "common.errors.NOT_FOUND");
    if (before.voidedAt) return before;
    await recordCorrection(tx, {
      occasionId: before.occasionId,
      targetTable: "ledger_entries",
      targetId: before.id,
      field: "voidedAt",
      before: { amountMinor: before.amountMinor, currency: before.currency, voided: false },
      after: { voided: true },
      reason: data.reason,
    });
    await tx.db.execute(sql`select set_config('ed.correction', 'on', true)`);
    const [after] = await tx.db.update(ledgerEntries).set({ voidedAt: tx.now }).where(eq(ledgerEntries.id, before.id)).returning();
    await tx.db.execute(sql`select set_config('ed.correction', '', true)`);
    return after!;
  });
}

/* ── Reading: entries, balances, settlement ─────────────────────────────── */

export type LedgerEntryView = LedgerEntry & { shares: Array<{ participantId: string; shareMinor: number; weight: number | null }> };
export type CurrencySettlement = {
  currency: string;
  /** Every participant with activity in this currency; sums to zero. */
  balances: Balance[];
  transfers: Transfer[];
  /** Total of the (non-voided) shared costs in this currency, settlements excluded. */
  totalCostMinor: number;
};
export type Ledger = {
  occasionId: string;
  participants: LedgerParticipant[];
  entries: LedgerEntryView[];
  settlements: CurrencySettlement[];
};

async function computeSettlements(ctx: Ctx, occasionId: string): Promise<CurrencySettlement[]> {
  const live = and(eq(ledgerEntries.occasionId, occasionId), isNull(ledgerEntries.voidedAt));
  const [paid, owed, costs] = await Promise.all([
    ctx.db
      .select({ participantId: ledgerEntries.paidByParticipantId, currency: ledgerEntries.currency, sum: sql<string>`sum(${ledgerEntries.amountMinor})` })
      .from(ledgerEntries)
      .where(live)
      .groupBy(ledgerEntries.paidByParticipantId, ledgerEntries.currency),
    ctx.db
      .select({ participantId: ledgerShares.participantId, currency: ledgerEntries.currency, sum: sql<string>`sum(${ledgerShares.shareMinor})` })
      .from(ledgerShares)
      .innerJoin(ledgerEntries, eq(ledgerEntries.id, ledgerShares.entryId))
      .where(live)
      .groupBy(ledgerShares.participantId, ledgerEntries.currency),
    ctx.db
      .select({ currency: ledgerEntries.currency, sum: sql<string>`sum(${ledgerEntries.amountMinor})` })
      .from(ledgerEntries)
      .where(and(live, eq(ledgerEntries.kind, "cost")))
      .groupBy(ledgerEntries.currency),
  ]);
  const per = new Map<string, Map<string, number>>();
  const add = (currency: string, participantId: string, delta: number) => {
    let m = per.get(currency);
    if (!m) per.set(currency, (m = new Map()));
    m.set(participantId, (m.get(participantId) ?? 0) + delta);
  };
  for (const p of paid) add(p.currency, p.participantId, Number(p.sum));
  for (const o of owed) add(o.currency, o.participantId, -Number(o.sum));
  const costBy = new Map(costs.map((c) => [c.currency, Number(c.sum)]));
  return [...per.entries()]
    .sort(([a], [b]) => (a === DEFAULT_CURRENCY ? -1 : b === DEFAULT_CURRENCY ? 1 : a.localeCompare(b)))
    .map(([currency, m]) => {
      const balances = [...m.entries()].map(([participantId, balanceMinor]) => ({ participantId, balanceMinor }));
      return { currency, balances, transfers: settleUp(balances), totalCostMinor: costBy.get(currency) ?? 0 };
    });
}

/** The whole ledger: participants, entries (newest first), balances and who owes whom per currency. */
export async function getLedger(ctx: Ctx, occasionId: string): Promise<Ledger> {
  const id = idSchema.parse(occasionId);
  await requireFinance(ctx, id);
  const [participants, entries, settlements] = await Promise.all([
    loadParticipants(ctx, id),
    ctx.db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.occasionId, id))
      .orderBy(desc(ledgerEntries.occurredOn), desc(ledgerEntries.createdAt))
      .limit(1000),
    computeSettlements(ctx, id),
  ]);
  const shares = entries.length
    ? await ctx.db
        .select()
        .from(ledgerShares)
        .where(
          inArray(
            ledgerShares.entryId,
            entries.map((e) => e.id),
          ),
        )
    : [];
  const byEntry = new Map<string, LedgerEntryView["shares"]>();
  for (const s of shares) {
    const list = byEntry.get(s.entryId) ?? [];
    list.push({ participantId: s.participantId, shareMinor: s.shareMinor, weight: s.weight });
    byEntry.set(s.entryId, list);
  }
  return {
    occasionId: id,
    participants,
    entries: entries.map((e) => ({ ...e, shares: byEntry.get(e.id) ?? [] })),
    settlements,
  };
}

export type OwnBalance = {
  participantId: string;
  name: string;
  perCurrency: Array<{
    currency: string;
    balanceMinor: number;
    /** Only the payments this person makes or receives; the other side is named. */
    transfers: Array<{ direction: "pay" | "receive"; otherName: string; amountMinor: number }>;
  }>;
};

/**
 * ANY member (no finance grant needed): their own balance per currency and the transfers that
 * involve them — nothing else. Null when the member is not a ledger participant.
 */
export async function getOwnBalance(ctx: Ctx, occasionId: string): Promise<OwnBalance | null> {
  const id = idSchema.parse(occasionId);
  const member = await requireMember(ctx, id);
  const participants = await loadParticipants(ctx, id);
  const me = participants.find((p) => p.memberId === member.id);
  if (!me) return null;
  const names = new Map(participants.map((p) => [p.id, p.name]));
  const settlements = await computeSettlements(ctx, id);
  return {
    participantId: me.id,
    name: me.name,
    perCurrency: settlements
      .filter((s) => s.balances.some((b) => b.participantId === me.id))
      .map((s) => ({
        currency: s.currency,
        balanceMinor: s.balances.find((b) => b.participantId === me.id)?.balanceMinor ?? 0,
        transfers: s.transfers
          .filter((t) => t.fromParticipantId === me.id || t.toParticipantId === me.id)
          .map((t) =>
            t.fromParticipantId === me.id
              ? { direction: "pay" as const, otherName: names.get(t.toParticipantId) ?? "", amountMinor: t.amountMinor }
              : { direction: "receive" as const, otherName: names.get(t.fromParticipantId) ?? "", amountMinor: t.amountMinor },
          ),
      })),
  };
}

/* ── CSV export ─────────────────────────────────────────────────────────── */

const CSV = {
  ro: {
    head: ["Data", "Tip", "Descriere", "Sumă", "Monedă", "A plătit", "Beneficiari", "Stare"],
    cost: "Cost comun",
    settlement: "Decontare",
    voided: "anulat",
    live: "",
    balanceHead: ["Sold", "", "Participant", "Sumă", "Monedă", "", "", ""],
  },
  en: {
    head: ["Date", "Type", "Description", "Amount", "Currency", "Paid by", "Beneficiaries", "State"],
    cost: "Shared cost",
    settlement: "Settlement",
    voided: "voided",
    live: "",
    balanceHead: ["Balance", "", "Participant", "Amount", "Currency", "", "", ""],
  },
} as const;

/** The ledger as CSV: every entry with its shares, then the balances per currency. */
export async function exportLedgerCsv(ctx: Ctx, occasionId: string): Promise<string> {
  const ledger = await getLedger(ctx, occasionId);
  const w = CSV[ctx.locale];
  const names = new Map(ledger.participants.map((p) => [p.id, p.name]));
  const major = (minor: number) => (minor / 100).toFixed(2);
  const rows: Array<Array<string | number>> = [...ledger.entries]
    .reverse()
    .map((e) => [
      e.occurredOn,
      e.kind === "settlement" ? w.settlement : w.cost,
      e.description,
      major(e.amountMinor),
      e.currency,
      names.get(e.paidByParticipantId) ?? "",
      e.shares.map((s) => `${names.get(s.participantId) ?? ""}: ${major(s.shareMinor)}`).join("; "),
      e.voidedAt ? w.voided : w.live,
    ]);
  for (const s of ledger.settlements) {
    for (const b of s.balances) {
      rows.push([w.balanceHead[0], "", names.get(b.participantId) ?? "", major(b.balanceMinor), s.currency, "", "", ""]);
    }
  }
  return toCsv([...w.head], rows);
}

/* ── Registrations ──────────────────────────────────────────────────────── */

async function openTransfers(ctx: Ctx, occasionId: string): Promise<Array<Transfer & { currency: string }>> {
  return (await computeSettlements(ctx, occasionId)).flatMap((s) => s.transfers.map((t) => ({ ...t, currency: s.currency })));
}

function register(): void {
  registerExport({
    key: "ledger-csv",
    titleKey: "ledger.export.title",
    descriptionKey: "ledger.export.description",
    grant: "finance",
    run: async (ctx, occasionId) => {
      const [o] = await ctx.db.select({ title: occasions.title }).from(occasions).where(eq(occasions.id, occasionId));
      return { filename: `costuri-comune-${fileSlug(o?.title ?? "")}.csv`, mime: "text/csv; charset=utf-8", content: await exportLedgerCsv(ctx, occasionId) };
    },
  });

  registerLifecycleImpact({
    key: "ledger",
    collect: async (ctx, occasionId) => {
      try {
        await requireFinance(ctx, occasionId);
      } catch {
        return [];
      }
      const names = new Map((await loadParticipants(ctx, occasionId)).map((p) => [p.id, p.name]));
      const rows: DeltaRow[] = (await openTransfers(ctx, occasionId)).slice(0, 50).map((t) => ({
        key: `ledger:${t.currency}:${t.fromParticipantId}:${t.toParticipantId}`,
        what: {
          key: "lifecycle.impact.ledgerOwes",
          params: { from: names.get(t.fromParticipantId) ?? "", to: names.get(t.toParticipantId) ?? "", amount: plainMoney(t.amountMinor, t.currency) },
        },
        kindLabelKey: "lifecycle.impact.ledgerLabel",
        noteKey: "lifecycle.impact.ledgerNote",
      }));
      return rows;
    },
  });

  registerCloseoutSection({
    key: "ledger.unsettled",
    titleKey: "lifecycle.closeout.sections.ledgerUnsettled",
    collect: async (ctx, occasionId) => {
      try {
        await requireFinance(ctx, occasionId);
      } catch {
        return [];
      }
      const names = new Map((await loadParticipants(ctx, occasionId)).map((p) => [p.id, p.name]));
      return (await openTransfers(ctx, occasionId)).map((t) => ({
        key: `${t.currency}:${t.fromParticipantId}:${t.toParticipantId}`,
        label: {
          key: "lifecycle.closeout.ledgerOwes",
          params: { from: names.get(t.fromParticipantId) ?? "", to: names.get(t.toParticipantId) ?? "" },
        },
        amountMinor: t.amountMinor,
        currency: t.currency,
      }));
    },
  });

  // A member without the finance grant sees only their own balance, on the overview.
  registerOverviewSection({
    key: "ledger-own",
    forMember: async (ctx, member, occasionId) => {
      if (member.grants.finance) return null; // finance holders have the whole ledger page
      const own = await getOwnBalance(ctx, occasionId);
      if (!own) return null;
      const lines = own.perCurrency
        .filter((c) => c.balanceMinor !== 0)
        .flatMap((c) =>
          c.transfers.length > 0
            ? c.transfers.map((t) => ({
                key: t.direction === "pay" ? "ledger.own.pay" : "ledger.own.receive",
                params: { name: t.otherName, amount: plainMoney(t.amountMinor, c.currency) },
              }))
            : [],
        );
      return lines.length > 0 ? { titleKey: "ledger.own.title", lines } : null;
    },
  });
}
register();

// Occasion purge: the ledger goes with the occasion (a ledger among friends is not a
// bookkeeping record; receipts are — see expenses). Entries first (their shares cascade),
// then participants: the plain cascade from the occasion row would trip the share → participant
// foreign key.
onOccasionPurge(async (tx, occasionId) => {
  await tx.db.delete(ledgerEntries).where(eq(ledgerEntries.occasionId, occasionId));
  await tx.db.delete(ledgerParticipants).where(eq(ledgerParticipants.occasionId, occasionId));
});

export function registerJobs(): void {
  register();
}
