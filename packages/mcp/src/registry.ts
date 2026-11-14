import type { Ctx, McpActor } from "@ed/core/context";
import { createHash } from "node:crypto";
import { z } from "zod";

// The MCP tool catalogue (MCP8): fixed, versioned, served by the server itself.
//
//   registerMcpTool({
//     name: "list_tasks",                 // read tools: get_* / list_* / search_* / whoami
//     version: "1",                       // bump when the input or output shape changes
//     scope: "read",                      // "read" | "propose" — declared to every assistant
//     title: "List tasks",
//     description: "Tasks of one occasion with owner, due date and status.",
//     inputSchema: z.object({ occasionId: z.string() }),
//     handler: async (ctx, input) => tasks.listForMcp(ctx, input),   // call @ed/core only
//   });
//
// The handler's ctx.actor is { kind: "mcp", accountId, tokenId, scope }: core's own access
// checks (requireMember, grants) bound what comes back exactly as in the app (MCP2, SEC15).
// READ tools run inside a READ ONLY database transaction — they cannot write, whatever they
// call. PROPOSE tools (name "propose_*") need a read_propose token, may only call
// createPreview from @ed/core/whatif, and must return mcpProposal(preview): the server then
// verifies the proposal really is a pending What-if preview made by this token and answers
// with its id, the in-app URL where the person confirms, and the "creat cu un asistent
// extern" label (MCP3, MCP5). Nothing a tool does is ever applied without that confirmation.
//
// MCP6: no tool may touch payments, the console, staff functions, another account, publishing
// or enquiry sending — registerMcpTool refuses such names outright.

export type McpToolScope = "read" | "propose";

export type McpCtx = Ctx & { actor: McpActor };

/** Extra, per-call facts for a handler. */
export type McpToolCall = {
  tool: string;
  /** Base URL of the app (no trailing slash), for links back into EventDesk. */
  appUrl: string;
};

export type McpToolDef<S extends z.ZodType = z.ZodType, R = unknown> = {
  name: string;
  version: string;
  scope: McpToolScope;
  title: string;
  description: string;
  inputSchema: S;
  handler: (ctx: McpCtx, input: z.output<S>, call: McpToolCall) => Promise<R>;
};

/** MCP5: the label everything made through an external assistant carries. */
export const EXTERNAL_ASSISTANT_LABEL = "creat cu un asistent extern";
export const EXTERNAL_ASSISTANT_LABEL_EN = "created with an external assistant";

const PROPOSAL = Symbol.for("ed.mcp.proposal");

export type McpProposal = {
  [PROPOSAL]: true;
  proposalId: string;
  occasionId: string | null;
  /** Anything else worth telling the assistant (a summary, counts). Plain JSON. */
  summary?: Record<string, unknown>;
};

/**
 * What every propose tool returns: the What-if preview it created.
 *   const preview = await createPreview(ctx, { kind, occasionId, subjectType, subjectId, input });
 *   return mcpProposal(preview, { tasks: input.tasks.length });
 */
export function mcpProposal(
  preview: { id: string; occasionId: string | null },
  summary?: Record<string, unknown>,
): McpProposal {
  return { [PROPOSAL]: true, proposalId: preview.id, occasionId: preview.occasionId, summary };
}

export function isMcpProposal(value: unknown): value is McpProposal {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[PROPOSAL] === true;
}

/** Where the person reviews and confirms a proposal in the app (the "Ce-ar fi dacă?" page). */
export function proposalConfirmUrl(appUrl: string, proposal: { occasionId: string | null }): string {
  const base = appUrl.replace(/\/+$/, "");
  return proposal.occasionId ? `${base}/occasions/${proposal.occasionId}/proposals` : `${base}/occasions`;
}

/* ── Name rules (MCP6) ──────────────────────────────────────────────────── */

const NAME_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const READ_PREFIXES = ["get_", "list_", "search_"];
/** Words that may not appear as a part of any tool name. */
const DENIED_WORDS = new Set([
  "pay", "pays", "paid", "payment", "payments", "payout", "payouts", "refund", "refunds",
  "charge", "charges", "billing", "invoice", "invoices", "subscription", "subscriptions",
  "checkout", "price", "pricing", "monetization", "monetisation", "stripe", "card", "cards",
  "admin", "admins", "console", "staff", "moderate", "moderation", "approve", "approval",
  "approvals", "deploy", "deployment", "deployments", "audit", "impersonate",
  "send", "sends", "publish", "unpublish", "apply", "confirm", "delete", "remove", "purge",
  "token", "tokens", "session", "sessions", "password", "passwords", "secret", "secrets",
]);
/** Phrases refused wherever they appear. */
const DENIED_PHRASES = ["send_enquiry", "enquiry_send", "delete_account", "other_account", "another_account", "any_account"];

/** Why a name is not allowed, or null when it is fine. */
export function deniedToolNameReason(name: string, scope: McpToolScope): string | null {
  if (!NAME_RE.test(name) || name.length < 3 || name.length > 64) return "invalid name (lower_snake_case, 3–64 characters)";
  for (const phrase of DENIED_PHRASES) if (name.includes(phrase)) return `"${phrase}" is not allowed (MCP6)`;
  for (const word of name.split("_")) if (DENIED_WORDS.has(word)) return `"${word}" is not allowed (MCP6)`;
  if (scope === "propose" && !name.startsWith("propose_")) return 'propose tools must be named "propose_*"';
  if (scope === "read" && name !== "whoami" && !READ_PREFIXES.some((p) => name.startsWith(p))) {
    return 'read tools must be named "get_*", "list_*" or "search_*"';
  }
  return null;
}

const g = globalThis as unknown as { __edMcpTools?: Map<string, McpToolDef> };
function tools(): Map<string, McpToolDef> {
  return (g.__edMcpTools ??= new Map());
}

/** Adds a tool to the catalogue (or replaces it — same name, e.g. on hot reload). */
export function registerMcpTool<S extends z.ZodType, R>(def: McpToolDef<S, R>): void {
  if (def.scope !== "read" && def.scope !== "propose") throw new Error(`MCP tool "${def.name}": scope must be "read" or "propose"`);
  const denied = deniedToolNameReason(def.name, def.scope);
  if (denied) throw new Error(`MCP tool "${def.name}" refused: ${denied}`);
  if (!/^\d+(\.\d+)*$/.test(def.version)) throw new Error(`MCP tool "${def.name}": version must look like "1" or "1.2"`);
  if (!def.title.trim() || !def.description.trim()) throw new Error(`MCP tool "${def.name}" needs a title and a description`);
  const schema = toolInputJsonSchema(def.inputSchema);
  if (schema.type !== "object") throw new Error(`MCP tool "${def.name}": inputSchema must be a z.object(...)`);
  tools().set(def.name, def as unknown as McpToolDef);
}

export function getMcpTool(name: string): McpToolDef | undefined {
  return tools().get(name);
}

export function toolInputJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

export type McpToolListing = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  _meta: { "eventdesk.ro/scope": McpToolScope; "eventdesk.ro/version": string };
};

/** The catalogue as `tools/list` serves it: every tool declares its scope and version. */
export function listMcpTools(): McpToolListing[] {
  return [...tools().values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      name: t.name,
      title: t.title,
      description:
        t.scope === "propose"
          ? `${t.description} Creates a proposal only: nothing changes until the user confirms it in EventDesk.`
          : t.description,
      inputSchema: toolInputJsonSchema(t.inputSchema),
      annotations: {
        title: t.title,
        readOnlyHint: t.scope === "read",
        destructiveHint: false,
        idempotentHint: t.scope === "read",
        openWorldHint: false,
      },
      _meta: { "eventdesk.ro/scope": t.scope, "eventdesk.ro/version": t.version },
    }));
}

/** Changes whenever a tool is added or its version changes (MCP8). */
export function catalogueVersion(): string {
  const h = createHash("sha256");
  for (const t of listMcpTools()) h.update(`${t.name}@${t._meta["eventdesk.ro/version"]}:${t._meta["eventdesk.ro/scope"]}\n`);
  return h.digest("hex").slice(0, 12);
}

/** Tests only. */
export function unregisterMcpTool(name: string): void {
  tools().delete(name);
}
