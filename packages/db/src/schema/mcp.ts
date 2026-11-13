import { boolean, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";
import { accounts } from "./accounts";
import { createdAt, id, ref, timestamptz } from "./_helpers";

// Personal MCP connection tokens and the per-call log (MCP1, MCP4, SEC8, SEC15).
// Written through @ed/mcp only.

export const MCP_SCOPES = ["read", "read_propose"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export const mcpScopeSchema = z.enum(MCP_SCOPES);

export const mcpTokens = pgTable(
  "mcp_tokens",
  {
    id: id(),
    accountId: ref("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    /** The user's own name for the connection ("Asistentul meu"). */
    name: text("name").notNull(),
    /** SHA-256 of the token; the token itself exists only on the creation screen (SEC8). */
    tokenHash: text("token_hash").notNull(),
    /** Last four characters — the most the UI or the console may ever show (SEC8). */
    last4: text("last4").notNull(),
    scope: text("scope").$type<McpScope>().notNull(),
    /** MCP7: set when the token works inside a business team's scopes. */
    businessId: ref("business_id"),
    createdAt: createdAt(),
    lastUsedAt: timestamptz("last_used_at"),
    revokedAt: timestamptz("revoked_at"),
    revokedReason: text("revoked_reason").$type<
      "user" | "inactive" | "signed_out_everywhere" | "handover"
    >(),
    /** MCP4: when the user accepted the data-leaves-EventDesk warning for THIS token. */
    consentAcceptedAt: timestamptz("consent_accepted_at"),
  },
  (t) => [
    uniqueIndex("mcp_tokens_hash_uq").on(t.tokenHash),
    index("mcp_tokens_account_idx").on(t.accountId, t.revokedAt),
  ],
);

/** One row per tool call (MCP1). Tool and token identifiers only — never arguments or results. */
export const mcpCallLog = pgTable(
  "mcp_call_log",
  {
    id: id(),
    tokenId: ref("token_id")
      .notNull()
      .references(() => mcpTokens.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    /** The token's scope at the time of the call. */
    scope: text("scope").$type<McpScope>().notNull(),
    at: timestamptz("at").notNull(),
    ok: boolean("ok").notNull(),
    /** AppError code or "unknown_tool" / "scope" / "invalid_input" when ok = false. */
    errorCode: text("error_code"),
  },
  (t) => [index("mcp_call_log_token_idx").on(t.tokenId, t.at), index("mcp_call_log_at_idx").on(t.at)],
);
