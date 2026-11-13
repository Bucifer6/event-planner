import { accounts, eq } from "@ed/db";
import { z } from "zod";
import { registerMcpTool, type McpCtx } from "./registry";

// The one tool that exists before any planning domain plugs in: it lets an assistant (and a
// test) confirm that the connection works and see which occasions the token can reach.

export type OccasionSummary = { id: string; title: string };
export type OccasionLister = (ctx: McpCtx) => Promise<OccasionSummary[]>;

const g = globalThis as unknown as { __edMcpOccasionLister?: OccasionLister };

/**
 * The planning domain provides this: the occasions the token's account may see, through
 * core's own membership check (MCP2). Until it is set, `whoami` returns an empty list.
 */
export function setOccasionLister(fn: OccasionLister): void {
  g.__edMcpOccasionLister = fn;
}

export function registerBuiltinTools(): void {
  registerMcpTool({
    name: "whoami",
    version: "1",
    scope: "read",
    title: "Who am I connected as",
    description:
      "Confirms the connection: the account's language, this token's scope, and the ids and titles of the occasions it can see. Call it first to learn which occasion ids to use.",
    inputSchema: z.object({}),
    handler: async (ctx) => {
      const [account] = await ctx.db
        .select({ locale: accounts.locale })
        .from(accounts)
        .where(eq(accounts.id, ctx.actor.accountId));
      const lister = g.__edMcpOccasionLister;
      const occasions = lister ? await lister(ctx) : [];
      return {
        locale: account?.locale ?? ctx.locale,
        scope: ctx.actor.scope,
        occasions: occasions.map((o) => ({ id: String(o.id), title: String(o.title) })),
      };
    },
  });
}

registerBuiltinTools();
