import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { z } from "zod";
import { createdAt, id, ref, timestamptz } from "./_helpers";

export const WHATIF_STATES = ["pending", "applied", "discarded"] as const;
export type WhatIfState = (typeof WHATIF_STATES)[number];
export const whatIfStateSchema = z.enum(WHATIF_STATES);

export const WHATIF_PROPOSER_KINDS = ["account", "mcp", "system"] as const;
export type WhatIfProposerKind = (typeof WHATIF_PROPOSER_KINDS)[number];
export const whatIfProposerKindSchema = z.enum(WHATIF_PROPOSER_KINDS);

/** Text shown in a preview: literal data (a guest's name) or an i18n key with params. */
export type WhatIfText = string | { key: string; params?: Record<string, string | number> };

/** One line of the before → after list. `null` before/after means "unknown". */
export type WhatIfDeltaRow = {
  key: string;
  what: WhatIfText;
  kindLabelKey?: string;
  before?: WhatIfText | null;
  after?: WhatIfText | null;
  noteKey?: string;
  noteParams?: Record<string, string | number>;
};

/**
 * What-if previews (principle 3, R0-16): a proposed change with its knock-on effects. Nothing
 * is applied until a person confirms. Written through @ed/core/whatif only.
 */
export const whatifPreviews = pgTable(
  "whatif_previews",
  {
    id: id(),
    occasionId: ref("occasion_id"),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    kind: text("kind").notNull(),
    titleKey: text("title_key"),
    titleParams: jsonb("title_params").$type<Record<string, string | number>>(),
    /** The validated input the handler will apply on confirmation. */
    input: jsonb("input").notNull(),
    delta: jsonb("delta").$type<WhatIfDeltaRow[]>().notNull(),
    state: text("state").$type<WhatIfState>().notNull().default("pending"),
    proposedByKind: text("proposed_by_kind").$type<WhatIfProposerKind>().notNull(),
    proposedById: text("proposed_by_id"),
    /** The account the proposal belongs to (the proposer, or the MCP token's account). */
    accountId: ref("account_id"),
    /** Free label of where it came from, e.g. the external assistant's name. */
    source: text("source"),
    createdAt: createdAt(),
    decidedAt: timestamptz("decided_at"),
    decidedBy: text("decided_by"),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (t) => [
    index("whatif_previews_occasion_idx").on(t.occasionId, t.state),
    index("whatif_previews_account_idx").on(t.accountId, t.state),
    index("whatif_previews_expires_idx").on(t.expiresAt),
  ],
);
