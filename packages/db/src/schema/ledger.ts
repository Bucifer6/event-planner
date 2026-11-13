import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, currency, id, moneyMinorBig, ref, timestamptz } from "./_helpers";
import { occasions } from "./occasions";

// Shared-cost ledger (B3): ONE balanced ledger per occasion. Every entry says who paid and who
// benefits; the shares of an entry always sum exactly to its amount, so balances sum to zero
// per currency. Settle-up payments are entries too. Entries are facts: they are never edited,
// only voided through a correction (principle 4).

export const LEDGER_PARTICIPANT_KINDS = ["member", "household", "other"] as const;
export type LedgerParticipantKind = (typeof LEDGER_PARTICIPANT_KINDS)[number];
export const ledgerParticipantKindSchema = z.enum(LEDGER_PARTICIPANT_KINDS);

export const LEDGER_ENTRY_KINDS = ["cost", "settlement"] as const;
export type LedgerEntryKind = (typeof LEDGER_ENTRY_KINDS)[number];

export const LEDGER_SPLIT_MODES = ["even", "shares", "exact"] as const;
export type LedgerSplitMode = (typeof LEDGER_SPLIT_MODES)[number];
export const ledgerSplitModeSchema = z.enum(LEDGER_SPLIT_MODES);

/** People who share costs: a team member, a guest household, or a free-text name. */
export const ledgerParticipants = pgTable(
  "ledger_participants",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<LedgerParticipantKind>().notNull(),
    memberId: ref("member_id"),
    householdId: ref("household_id"),
    /** Display name (snapshot for members and households, the typed name otherwise). */
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_participants_occasion_idx").on(t.occasionId),
    uniqueIndex("ledger_participants_member_uq").on(t.occasionId, t.memberId),
    uniqueIndex("ledger_participants_household_uq").on(t.occasionId, t.householdId),
  ],
);

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    occasionId: ref("occasion_id")
      .notNull()
      .references(() => occasions.id, { onDelete: "cascade" }),
    kind: text("kind").$type<LedgerEntryKind>().notNull().default("cost"),
    description: text("description").notNull(),
    amountMinor: moneyMinorBig("amount_minor").notNull(),
    currency: currency(),
    paidByParticipantId: ref("paid_by_participant_id")
      .notNull()
      .references(() => ledgerParticipants.id),
    splitMode: text("split_mode").$type<LedgerSplitMode>().notNull().default("even"),
    /** yyyy-mm-dd */
    occurredOn: text("occurred_on").notNull(),
    /** Optional link to the budget expense this cost came from. */
    expenseId: ref("expense_id"),
    createdByMemberId: ref("created_by_member_id"),
    idempotencyKey: text("idempotency_key"),
    /** Set through a correction; a voided entry no longer counts in any balance. */
    voidedAt: timestamptz("voided_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ledger_entries_occasion_idx").on(t.occasionId, t.occurredOn),
    uniqueIndex("ledger_entries_idempotency_uq").on(t.occasionId, t.idempotencyKey),
    check("ledger_entries_amount_ck", sql`${t.amountMinor} > 0`),
  ],
);

/** Who benefits from an entry and by how much. SUM(share_minor) = the entry's amount. */
export const ledgerShares = pgTable(
  "ledger_shares",
  {
    id: id(),
    entryId: ref("entry_id")
      .notNull()
      .references(() => ledgerEntries.id, { onDelete: "cascade" }),
    participantId: ref("participant_id")
      .notNull()
      .references(() => ledgerParticipants.id),
    shareMinor: moneyMinorBig("share_minor").notNull(),
    /** The weight typed for a split by shares (NULL for even and exact splits). */
    weight: integer("weight"),
  },
  (t) => [
    uniqueIndex("ledger_shares_entry_participant_uq").on(t.entryId, t.participantId),
    index("ledger_shares_participant_idx").on(t.participantId),
    check("ledger_shares_amount_ck", sql`${t.shareMinor} >= 0`),
  ],
);
