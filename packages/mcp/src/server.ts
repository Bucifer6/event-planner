import { audit } from "@ed/core/audit";
import type { Ctx } from "@ed/core/context";
import { enforceRateLimit } from "@ed/core/ratelimit";
import { and, eq, mcpCallLog, sql, whatifPreviews, type Db } from "@ed/db";
import { translate } from "@ed/i18n";
import { isAppError } from "@ed/shared/errors";
import { z } from "zod";
import "./builtin";
import {
  catalogueVersion,
  EXTERNAL_ASSISTANT_LABEL,
  EXTERNAL_ASSISTANT_LABEL_EN,
  getMcpTool,
  isMcpProposal,
  listMcpTools,
  proposalConfirmUrl,
  type McpCtx,
} from "./registry";
import { authenticateMcpToken } from "./tokens";

// Stateless MCP server over Streamable HTTP (MCP8): one POST = one JSON-RPC message (or a
// batch), answered with application/json. No sessions, no server-sent stream, no cookies —
// the only credential is `Authorization: Bearer <personal token>`.
//
// Implemented by hand rather than with @modelcontextprotocol/sdk: the surface is four
// methods, and the SDK's transports are built around long-lived sessions and Node streams,
// which do not fit a stateless Next route handler cleanly.
//
// Methods: initialize, ping, tools/list, tools/call (+ notifications, which get 202).
// Anything else is a JSON-RPC "method not found".

/** Newest first. `initialize` answers with the client's version when it is one of these. */
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const MCP_LATEST_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0];

export const MCP_SERVER_NAME = "eventdesk";

/** JSON-RPC error codes. -320xx are this server's own. */
export const MCP_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  /** Missing, unknown, revoked or expired token. */
  unauthorized: -32001,
  /** The token's owner has not yet accepted the data warning in the app (MCP4). */
  consentRequired: -32002,
  rateLimited: -32003,
} as const;

const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 20;

export type McpServerOptions = {
  db: Db;
  now?: Date;
  /** Client IP as reported by the trusted proxy header. */
  ip?: string;
  /** Base URL of the app; default APP_URL. Used for the consent and confirm links. */
  appUrl?: string;
  env?: Record<string, string | undefined>;
};

type JsonRpcId = string | number | null;
type JsonRpcError = { code: number; message: string; data?: unknown };
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: JsonRpcId; result: unknown }
  | { jsonrpc: "2.0"; id: JsonRpcId; error: JsonRpcError };

const rpcMessage = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().min(1).max(200).optional(),
  params: z.unknown().optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});

const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } };
}

function appUrlOf(opts: McpServerOptions): string {
  const env = opts.env ?? process.env;
  return (opts.appUrl ?? env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

function limitOf(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const n = Number(env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function bearerOf(request: Request): string | null {
  const header = request.headers.get("authorization");
  const m = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  return m?.[1] ?? null;
}

/** Spec: a server MUST validate Origin. Non-browser clients send none; a foreign page is refused. */
function originAllowed(request: Request, appUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

/** The whole endpoint. Give it the Request; it never reads cookies. */
export async function handleMcpRequest(request: Request, opts: McpServerOptions): Promise<Response> {
  const env = opts.env ?? process.env;
  const appUrl = appUrlOf(opts);
  const now = opts.now ?? new Date();

  if (request.method !== "POST") {
    // No server-initiated stream and no sessions to delete: only POST exists.
    return json(405, rpcError(null, MCP_ERRORS.invalidRequest, "Method not allowed. Use POST."), { Allow: "POST" });
  }
  if (!originAllowed(request, appUrl)) {
    return json(403, rpcError(null, MCP_ERRORS.invalidRequest, "Origin not allowed."));
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(contentType)) {
    return json(415, rpcError(null, MCP_ERRORS.invalidRequest, "Content-Type must be application/json."));
  }
  const headerVersion = request.headers.get("mcp-protocol-version");
  if (headerVersion && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(headerVersion)) {
    return json(400, rpcError(null, MCP_ERRORS.invalidRequest, `Unsupported MCP-Protocol-Version: ${headerVersion.slice(0, 40)}`, { supported: MCP_PROTOCOL_VERSIONS }));
  }

  // Authenticate BEFORE reading the body: an unauthenticated caller costs one indexed lookup.
  const bearer = bearerOf(request);
  const base = { db: opts.db, now };
  const auth = await authenticateMcpToken(base, bearer);
  if (!auth.ok) {
    if (auth.reason === "consent_required") {
      const url = `${appUrl}/account/assistants`;
      return json(403, rpcError(null, MCP_ERRORS.consentRequired, translate(auth.locale ?? "ro", "mcp.errors.consentRequired", { url }), { acceptAt: url }));
    }
    // Slow down token guessing per IP; the answer is the same for every kind of bad token.
    if (opts.ip) {
      try {
        await enforceRateLimit(
          { db: opts.db, actor: { kind: "anonymous" }, now, ip: opts.ip, locale: "ro" },
          { scope: "mcp.auth_failed", rules: [{ axis: "ip", key: opts.ip, limit: limitOf(env, "MCP_AUTH_FAILURES_PER_IP_PER_HOUR", 60), windowSeconds: 3600 }] },
        );
      } catch (e) {
        if (isAppError(e) && e.code === "RATE_LIMITED") return rateLimited(null, e.details?.retryAt, now);
        throw e;
      }
    }
    return json(
      401,
      rpcError(null, MCP_ERRORS.unauthorized, "Unauthorized: the token is missing, unknown, revoked or expired. Create a new one in EventDesk under Cont → Asistenți AI.", { manageAt: `${appUrl}/account/assistants` }),
      { "WWW-Authenticate": 'Bearer realm="EventDesk MCP"' },
    );
  }

  const ctx: McpCtx = { db: opts.db, actor: auth.actor, now, ip: opts.ip, locale: auth.locale };

  // MCP6 fair use: every request of a token counts (per minute and per day).
  try {
    await enforceRateLimit(ctx, {
      scope: "mcp.call",
      rules: [
        { axis: "key", key: auth.actor.tokenId, limit: limitOf(env, "MCP_CALLS_PER_MINUTE", 60), windowSeconds: 60 },
        { axis: "key", key: auth.actor.tokenId, limit: limitOf(env, "MCP_CALLS_PER_DAY", 2000), windowSeconds: 86_400 },
      ],
    });
  } catch (e) {
    if (isAppError(e) && e.code === "RATE_LIMITED") return rateLimited(null, e.details?.retryAt, now);
    throw e;
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json(400, rpcError(null, MCP_ERRORS.parse, "Could not read the request body."));
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return json(413, rpcError(null, MCP_ERRORS.invalidRequest, "Request body too large."));
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, rpcError(null, MCP_ERRORS.parse, "Parse error: the body is not valid JSON."));
  }

  const isBatch = Array.isArray(body);
  const messages: unknown[] = isBatch ? (body as unknown[]) : [body];
  if (messages.length === 0 || messages.length > MAX_BATCH) {
    return json(400, rpcError(null, MCP_ERRORS.invalidRequest, "Invalid request: empty or oversized batch."));
  }

  const responses: JsonRpcResponse[] = [];
  for (const message of messages) {
    const parsed = rpcMessage.safeParse(message);
    if (!parsed.success) {
      responses.push(rpcError(idOf(message), MCP_ERRORS.invalidRequest, "Invalid request: not a JSON-RPC 2.0 message."));
      continue;
    }
    const msg = parsed.data;
    if (!msg.method) continue; // a client's response to the server: nothing to answer
    if (msg.id === undefined) continue; // a notification (notifications/initialized, …)
    responses.push(await dispatch(ctx, msg.id, msg.method, msg.params, { appUrl, headerVersion }));
  }

  if (responses.length === 0) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
  return json(200, isBatch ? responses : responses[0]);
}

function idOf(message: unknown): JsonRpcId {
  const id = (message as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function rateLimited(id: JsonRpcId, retryAt: unknown, now: Date): Response {
  const at = typeof retryAt === "string" ? new Date(retryAt) : new Date(now.getTime() + 60_000);
  const seconds = Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 1000));
  return json(429, rpcError(id, MCP_ERRORS.rateLimited, "Too many requests. Try again later.", { retryAt: at.toISOString() }), {
    "Retry-After": String(seconds),
  });
}

async function dispatch(
  ctx: McpCtx,
  id: string | number,
  method: string,
  params: unknown,
  req: { appUrl: string; headerVersion: string | null },
): Promise<JsonRpcResponse> {
  try {
    switch (method) {
      case "initialize":
        return { jsonrpc: "2.0", id, result: initialize(ctx, params, req.appUrl) };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: { tools: listMcpTools(), _meta: { "eventdesk.ro/catalogueVersion": catalogueVersion() } },
        };
      case "tools/call":
        return await callTool(ctx, id, params, req.appUrl);
      default:
        return rpcError(id, MCP_ERRORS.methodNotFound, `Method not found: ${method.slice(0, 80)}`);
    }
  } catch (e) {
    console.error("[mcp] internal error", e instanceof Error ? e.message : e);
    return rpcError(id, MCP_ERRORS.internal, "Internal error.");
  }
}

function initialize(ctx: McpCtx, params: unknown, appUrl: string): unknown {
  const requested = (params as { protocolVersion?: unknown } | null | undefined)?.protocolVersion;
  // Spec: answer with the requested version when supported, otherwise with our latest; the
  // client then decides whether it can continue.
  const protocolVersion =
    typeof requested === "string" && (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
      ? requested
      : MCP_LATEST_PROTOCOL_VERSION;
  return {
    protocolVersion,
    capabilities: { tools: { listChanged: false } },
    serverInfo: {
      name: MCP_SERVER_NAME,
      title: "EventDesk",
      version: process.env.APP_VERSION || "0.0.0",
    },
    instructions:
      `EventDesk (eventdesk.ro) event planning. This connection is ${ctx.actor.scope === "read_propose" ? "read-and-propose" : "read-only"}. ` +
      "Read tools return only what the connected user can see in the app. Propose tools never change anything: each creates a proposal the user must review and confirm in EventDesk " +
      `(${appUrl}); always give the user the confirmUrl you receive. Amounts are estimates unless stated otherwise, never quotes. Call whoami first.`,
  };
}

const callParams = z.object({
  name: z.string().min(1).max(100),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

type ToolResult = { content: Array<{ type: "text"; text: string }>; structuredContent?: Record<string, unknown>; isError: boolean };

function toolError(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

function toolOk(value: unknown): ToolResult {
  const structured: Record<string, unknown> =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (JSON.parse(JSON.stringify(value)) as Record<string, unknown>)
      : { result: value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown) };
  return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured, isError: false };
}

/** MCP1: one call-log row and one audit row per tool call — identifiers only, no arguments. */
async function logCall(ctx: McpCtx, tool: string, ok: boolean, errorCode: string | null, version: string | null): Promise<void> {
  await ctx.db.insert(mcpCallLog).values({
    tokenId: ctx.actor.tokenId,
    tool: tool.slice(0, 100),
    scope: ctx.actor.scope,
    at: ctx.now,
    ok,
    errorCode,
  });
  await audit(ctx, {
    action: "mcp.call",
    objectType: "mcp_tool",
    objectId: tool.slice(0, 100),
    meta: { ok, scope: ctx.actor.scope, ...(errorCode ? { errorCode } : {}), ...(version ? { toolVersion: version } : {}) },
  });
}

async function callTool(ctx: McpCtx, id: string | number, params: unknown, appUrl: string): Promise<JsonRpcResponse> {
  const parsed = callParams.safeParse(params);
  if (!parsed.success) return rpcError(id, MCP_ERRORS.invalidParams, "Invalid params: expected { name, arguments? }.");
  const { name } = parsed.data;
  const tool = getMcpTool(name);
  if (!tool) {
    await logCall(ctx, name, false, "unknown_tool", null);
    return rpcError(id, MCP_ERRORS.invalidParams, `Unknown tool: ${name.slice(0, 80)}`);
  }
  const done = async (result: ToolResult, errorCode: string | null = null): Promise<JsonRpcResponse> => {
    await logCall(ctx, tool.name, !result.isError, errorCode, tool.version);
    return { jsonrpc: "2.0", id, result };
  };

  // SEC15: a read-only token can never reach a propose tool.
  if (tool.scope === "propose" && ctx.actor.scope !== "read_propose") {
    return done(toolError(translate(ctx.locale, "mcp.errors.readOnlyToken", { url: `${appUrl}/account/assistants` })), "scope");
  }
  const input = tool.inputSchema.safeParse(parsed.data.arguments ?? {});
  if (!input.success) {
    const issues = input.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "(input)"}: ${i.message}`);
    return done(toolError(`Invalid arguments for ${tool.name}: ${issues.join("; ")}`), "invalid_input");
  }

  try {
    const call = { tool: tool.name, appUrl };
    if (tool.scope === "read") {
      // Read tools cannot write: the database itself refuses inside a READ ONLY transaction.
      const value = await ctx.db.transaction(async (tx) => {
        await tx.execute(sql`set transaction read only`);
        return tool.handler({ ...ctx, db: tx }, input.data, call);
      });
      return done(toolOk(value));
    }
    const value = await tool.handler(ctx, input.data, call);
    if (!isMcpProposal(value)) throw new Error(`propose tool ${tool.name} did not return mcpProposal(preview)`);
    // MCP3: it must be a real, still-pending What-if preview made by THIS token.
    const [preview] = await ctx.db
      .select({ id: whatifPreviews.id, occasionId: whatifPreviews.occasionId })
      .from(whatifPreviews)
      .where(
        and(
          eq(whatifPreviews.id, value.proposalId),
          eq(whatifPreviews.state, "pending"),
          eq(whatifPreviews.proposedByKind, "mcp"),
          eq(whatifPreviews.proposedById, ctx.actor.tokenId),
        ),
      );
    if (!preview) throw new Error(`propose tool ${tool.name} returned a proposal that is not a pending preview of this token`);
    return done(
      toolOk({
        proposalId: preview.id,
        applied: false,
        confirmUrl: proposalConfirmUrl(appUrl, preview),
        label: EXTERNAL_ASSISTANT_LABEL,
        labelEn: EXTERNAL_ASSISTANT_LABEL_EN,
        note: translate(ctx.locale, "mcp.proposalNote"),
        ...(value.summary ? { summary: value.summary } : {}),
      }),
    );
  } catch (e) {
    if (isAppError(e)) {
      const key = translate(ctx.locale, e.messageKey) === e.messageKey ? `common.errors.${e.code}` : e.messageKey;
      return done(toolError(translate(ctx.locale, key, e.details?.params)), e.code);
    }
    if (e instanceof z.ZodError) return done(toolError(`Invalid arguments for ${tool.name}.`), "invalid_input");
    console.error(`[mcp] tool ${tool.name} failed`, e instanceof Error ? e.message : e);
    return done(toolError(translate(ctx.locale, "common.errors.UNEXPECTED")), "UNEXPECTED");
  }
}

/** The request Ctx a tool handler receives — exported for tests of tools. */
export function mcpCtx(db: Db, actor: McpCtx["actor"], opts: { now?: Date; locale?: Ctx["locale"] } = {}): McpCtx {
  return { db, actor, now: opts.now ?? new Date(), locale: opts.locale ?? "ro" };
}
