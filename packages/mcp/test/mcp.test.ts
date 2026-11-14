import { signOutEverywhere } from "@ed/auth";
import { purgeDueAccounts, requestAccountDeletion } from "@ed/core/accounts";
import { accountCtx, systemCtx } from "@ed/core/context";
import { confirmPreview, createPreview, registerWhatIf } from "@ed/core/whatif";
import { accounts, auditLog, eq, mcpCallLog, mcpTokens, platformSettings, sessions, sql, whatifPreviews } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { hashToken, newId } from "@ed/shared/ids";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  acceptMcpConsent,
  createMcpToken,
  deniedToolNameReason,
  expireInactiveMcpTokens,
  EXTERNAL_ASSISTANT_LABEL,
  handleMcpRequest,
  listMcpTools,
  listMcpTokens,
  MCP_ERRORS,
  MCP_LATEST_PROTOCOL_VERSION,
  mcpProposal,
  registerMcpTool,
  revokeMcpToken,
  setOccasionLister,
} from "../src/index";

let t: TestDb;
const T0 = new Date("2026-05-04T09:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const APP = "https://app.eventdesk.test";
let seq = 0;

beforeAll(async () => {
  t = await setupTestDb();
  registerWhatIf("mcptest.note", {
    input: z.object({ text: z.string() }),
    authorize: async (ctx, subject) => {
      // stands in for core's membership check: only the owner account may touch the subject
      const owner = subject.subjectId.split("x")[0];
      if (!("accountId" in ctx.actor) || !ctx.actor.accountId.startsWith(owner!)) {
        throw new (await import("@ed/shared/errors")).AppError("FORBIDDEN");
      }
    },
    apply: async () => {},
  });
  registerMcpTool({
    name: "propose_test_note",
    version: "1",
    scope: "propose",
    title: "Propose a note",
    description: "Test tool.",
    inputSchema: z.object({ subjectId: z.string(), text: z.string().min(1) }),
    handler: async (ctx, input) => {
      const preview = await createPreview(ctx, {
        kind: "mcptest.note",
        subjectType: "note",
        subjectId: input.subjectId,
        input: { text: input.text },
        delta: [{ key: "note", what: "note", after: input.text }],
      });
      return mcpProposal(preview, { characters: input.text.length });
    },
  });
  registerMcpTool({
    name: "get_test_write",
    version: "1",
    scope: "read",
    title: "A read tool that misbehaves",
    description: "Test tool that tries to write.",
    inputSchema: z.object({}),
    handler: async (ctx) => {
      await ctx.db.insert(platformSettings).values({ key: "mcp.test.leak", value: { written: true } });
      return { wrote: true };
    },
  });
});
afterAll(async () => {
  await t.close();
});

/** An account with a session that proved identity a minute ago (S4 fresh auth). */
async function mkAccount(now: Date = T0): Promise<{ accountId: string; ctx: ReturnType<typeof accountCtx> }> {
  const [row] = await t.db
    .insert(accounts)
    .values({ kind: "email", email: `mcp${++seq}@example.test`, locale: "ro" })
    .returning({ id: accounts.id });
  await t.db.insert(sessions).values({
    accountId: row!.id,
    tokenHash: `h${seq}-${newId()}`,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + 30 * 86_400_000),
    freshAuthAt: now,
  });
  return { accountId: row!.id, ctx: accountCtx(t.db, row!.id, { now }) };
}

type Rpc = { status: number; headers: Headers; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function rpc(
  token: string | null,
  payload: unknown,
  opts: { now?: Date; headers?: Record<string, string>; method?: string; env?: Record<string, string>; raw?: string; ip?: string } = {},
): Promise<Rpc> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream", ...opts.headers };
  if (token) headers.authorization = `Bearer ${token}`;
  const method = opts.method ?? "POST";
  const res = await handleMcpRequest(
    new Request(`${APP}/mcp`, { method, headers, body: method === "POST" ? (opts.raw ?? JSON.stringify(payload)) : undefined }),
    { db: t.db, now: opts.now ?? at(1), appUrl: APP, ip: opts.ip, env: opts.env ?? {} },
  );
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

const call = (token: string, name: string, args: Record<string, unknown> = {}, opts: Parameters<typeof rpc>[2] = {}) =>
  rpc(token, { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, opts);

async function mkToken(scope: "read" | "read_propose" = "read", consent = true) {
  const a = await mkAccount();
  const created = await createMcpToken(a.ctx, { name: "Asistentul meu", scope, consent });
  return { ...a, ...created };
}

describe("tokens (MCP1, MCP4, SEC8)", () => {
  it("creating a token needs fresh auth, shows it once and stores only its hash", async () => {
    const [row] = await t.db.insert(accounts).values({ kind: "email", email: "stale@example.test" }).returning({ id: accounts.id });
    const stale = accountCtx(t.db, row!.id, { now: T0 });
    const err = await createMcpToken(stale, { name: "x", scope: "read", consent: true }).catch((e) => e);
    expect(isAppError(err) && err.code === "FORBIDDEN" && err.details?.freshAuthRequired).toBe(true);

    const a = await mkAccount();
    const created = await createMcpToken(a.ctx, { name: "  Laptop  ", scope: "read_propose", consent: true });
    expect(created.token).toMatch(/^edmcp_[A-Za-z0-9_-]{40,}$/);
    expect(created.last4).toBe(created.token.slice(-4));
    const [stored] = await t.db.select().from(mcpTokens).where(eq(mcpTokens.id, created.id));
    expect(stored!.tokenHash).toBe(hashToken(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.objectId, created.id));
    expect(audits.map((r) => r.action).sort()).toEqual(["mcp_token.consent_accepted", "mcp_token.created"]);
    expect(JSON.stringify(audits)).not.toContain(created.token);

    const list = await listMcpTokens(a.ctx);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Laptop", scope: "read_propose", last4: created.last4, consentAccepted: true });
    expect(JSON.stringify(list)).not.toContain(created.token);
    // another account cannot see, accept or revoke it
    const other = await mkAccount();
    expect(await listMcpTokens(other.ctx)).toHaveLength(0);
    await expect(revokeMcpToken(other.ctx, { tokenId: created.id })).rejects.toThrow();
    await expect(acceptMcpConsent(other.ctx, { tokenId: created.id })).rejects.toThrow();
  });

  it("a token is refused until its owner accepts the data warning in the app (MCP4)", async () => {
    const tok = await mkToken("read", false);
    const refused = await rpc(tok.token, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe(MCP_ERRORS.consentRequired);
    expect(refused.body.error.message).toContain(`${APP}/account/assistants`);
    expect((await call(tok.token, "whoami")).body.error.code).toBe(MCP_ERRORS.consentRequired);
    expect(await t.db.select().from(mcpCallLog).where(eq(mcpCallLog.tokenId, tok.id))).toHaveLength(0);
    expect((await listMcpTokens(tok.ctx))[0]!.consentAccepted).toBe(false);

    await acceptMcpConsent(tok.ctx, { tokenId: tok.id });
    await acceptMcpConsent(tok.ctx, { tokenId: tok.id }); // idempotent
    expect((await call(tok.token, "whoami")).body.result.isError).toBe(false);
    const consent = await t.db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.action} = 'mcp_token.consent_accepted' and ${auditLog.objectId} = ${tok.id}`);
    expect(consent).toHaveLength(1);
    expect((consent[0]!.meta as { dataClasses: string[] }).dataClasses).toContain("guestCounts");
  });

  it("missing, unknown and revoked tokens fail at once with -32001", async () => {
    const init = { jsonrpc: "2.0", id: 1, method: "ping" };
    for (const bad of [null, "edmcp_" + "a".repeat(43), "not-a-token"]) {
      const res = await rpc(bad, init);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(MCP_ERRORS.unauthorized);
      expect(res.headers.get("www-authenticate")).toContain("Bearer");
    }
    const tok = await mkToken();
    expect((await rpc(tok.token, init)).status).toBe(200);
    await revokeMcpToken(tok.ctx, { tokenId: tok.id });
    const after = await rpc(tok.token, init);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe(MCP_ERRORS.unauthorized);
    expect(await listMcpTokens(tok.ctx)).toHaveLength(0);
    // the stored hash is gone too: the credential can never match again
    const [row] = await t.db.select().from(mcpTokens).where(eq(mcpTokens.id, tok.id));
    expect(row!.tokenHash).toBe(`revoked:${tok.id}`);
    expect(row!.revokedReason).toBe("user");
  });

  it("a token unused for 30 days is expired: refused immediately, and swept by the job", async () => {
    const tok = await mkToken();
    expect((await rpc(tok.token, { jsonrpc: "2.0", id: 1, method: "ping" }, { now: at(60 * 24 * 29) })).status).toBe(200);
    // used on day 29 → the clock restarts; 30 more days of silence expire it
    const late = at(60 * 24 * 60);
    const res = await rpc(tok.token, { jsonrpc: "2.0", id: 1, method: "ping" }, { now: late });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe(MCP_ERRORS.unauthorized);
    const [row] = await t.db.select().from(mcpTokens).where(eq(mcpTokens.id, tok.id));
    expect(row!.revokedReason).toBe("inactive");

    const idle = await mkToken();
    const fresh = await mkToken();
    await t.db.update(mcpTokens).set({ lastUsedAt: at(60 * 24 * 40) }).where(eq(mcpTokens.id, fresh.id));
    const swept = await expireInactiveMcpTokens(systemCtx(t.db, { now: at(60 * 24 * 45) }));
    expect(swept).toBeGreaterThanOrEqual(1);
    const rows = await t.db.select().from(mcpTokens).where(sql`${mcpTokens.id} in (${idle.id}, ${fresh.id})`);
    expect(rows.find((r) => r.id === idle.id)!.revokedAt).not.toBeNull();
    expect(rows.find((r) => r.id === fresh.id)!.revokedAt).toBeNull();
  });

  it("sign out everywhere revokes every token of the account, and only that account", async () => {
    const tok = await mkToken("read_propose");
    const second = await createMcpToken(tok.ctx, { name: "Telefon", scope: "read", consent: true });
    const bystander = await mkToken();
    await signOutEverywhere(accountCtx(t.db, tok.accountId, { now: at(5) }));
    for (const token of [tok.token, second.token]) {
      const res = await rpc(token, { jsonrpc: "2.0", id: 1, method: "ping" }, { now: at(6) });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe(MCP_ERRORS.unauthorized);
    }
    const rows = await t.db.select().from(mcpTokens).where(eq(mcpTokens.accountId, tok.accountId));
    expect(rows.every((r) => r.revokedReason === "signed_out_everywhere")).toBe(true);
    expect((await rpc(bystander.token, { jsonrpc: "2.0", id: 1, method: "ping" }, { now: at(6) })).status).toBe(200);

    // even if the hook had not run in this process, a later sign-out-everywhere record kills the token
    const orphan = await mkToken();
    await t.db.insert(auditLog).values({
      at: at(8),
      actorKind: "account",
      actorId: orphan.accountId,
      action: "account.signed_out_everywhere",
      objectType: "account",
      objectId: orphan.accountId,
    });
    expect((await rpc(orphan.token, { jsonrpc: "2.0", id: 1, method: "ping" }, { now: at(9) })).status).toBe(401);
  });

  it("tokens are deleted with the account (D6)", async () => {
    const tok = await mkToken();
    await call(tok.token, "whoami");
    await requestAccountDeletion(tok.ctx);
    await purgeDueAccounts(systemCtx(t.db, { now: at(60 * 24 * 8) }));
    expect(await t.db.select().from(mcpTokens).where(eq(mcpTokens.accountId, tok.accountId))).toHaveLength(0);
    expect(await t.db.select().from(mcpCallLog).where(eq(mcpCallLog.tokenId, tok.id))).toHaveLength(0);
    expect((await rpc(tok.token, { jsonrpc: "2.0", id: 1, method: "ping" }, { now: at(60 * 24 * 8) })).status).toBe(401);
  });
});

describe("protocol (MCP8)", () => {
  it("initialize negotiates the protocol version and announces the tools capability", async () => {
    const tok = await mkToken();
    const same = await rpc(tok.token, { jsonrpc: "2.0", id: "a", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(same.status).toBe(200);
    expect(same.headers.get("content-type")).toContain("application/json");
    expect(same.body).toMatchObject({ jsonrpc: "2.0", id: "a", result: { protocolVersion: "2025-03-26", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "eventdesk" } } });
    expect(same.body.result.instructions).toContain("read-only");
    const unknown = await rpc(tok.token, { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
    expect(unknown.body.result.protocolVersion).toBe(MCP_LATEST_PROTOCOL_VERSION);
    const badHeader = await rpc(tok.token, { jsonrpc: "2.0", id: 3, method: "ping" }, { headers: { "mcp-protocol-version": "1999-01-01" } });
    expect(badHeader.status).toBe(400);
    const goodHeader = await rpc(tok.token, { jsonrpc: "2.0", id: 3, method: "ping" }, { headers: { "mcp-protocol-version": "2025-06-18" } });
    expect(goodHeader.body).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });

  it("answers anything else with proper JSON-RPC errors", async () => {
    const tok = await mkToken();
    const notFound = await rpc(tok.token, { jsonrpc: "2.0", id: 4, method: "resources/list" });
    expect(notFound.body).toMatchObject({ id: 4, error: { code: MCP_ERRORS.methodNotFound } });
    const parse = await rpc(tok.token, null, { raw: "{not json" });
    expect(parse.status).toBe(400);
    expect(parse.body.error.code).toBe(MCP_ERRORS.parse);
    const invalid = await rpc(tok.token, { id: 5, method: "ping" });
    expect(invalid.body).toMatchObject({ id: 5, error: { code: MCP_ERRORS.invalidRequest } });
    const params = await rpc(tok.token, { jsonrpc: "2.0", id: 6, method: "tools/call", params: { arguments: {} } });
    expect(params.body.error.code).toBe(MCP_ERRORS.invalidParams);
    const notification = await rpc(tok.token, { jsonrpc: "2.0", method: "notifications/initialized" });
    expect(notification.status).toBe(202);
    expect(notification.body).toBeNull();
    const batch = await rpc(tok.token, [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "nope" },
    ]);
    expect(batch.body).toHaveLength(2);
    expect(batch.body[1].error.code).toBe(MCP_ERRORS.methodNotFound);

    expect((await rpc(tok.token, null, { method: "GET" })).status).toBe(405);
    expect((await rpc(tok.token, null, { method: "DELETE" })).status).toBe(405);
    expect((await rpc(tok.token, { jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { "content-type": "text/plain" } })).status).toBe(415);
    expect((await rpc(tok.token, { jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await rpc(tok.token, { jsonrpc: "2.0", id: 1, method: "ping" }, { headers: { origin: APP } })).status).toBe(200);
  });

  it("the catalogue is served by the server and every tool declares its scope and version", async () => {
    const tok = await mkToken();
    const res = await rpc(tok.token, { jsonrpc: "2.0", id: 1, method: "tools/list" });
    const tools: Array<{ name: string; inputSchema: { type: string }; annotations: { readOnlyHint: boolean }; _meta: Record<string, string>; description: string }> = res.body.result.tools;
    expect(tools.map((x) => x.name)).toEqual(expect.arrayContaining(["whoami", "propose_test_note"]));
    for (const tool of tools) {
      expect(["read", "propose"]).toContain(tool._meta["eventdesk.ro/scope"]);
      expect(tool._meta["eventdesk.ro/version"]).toMatch(/^\d/);
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.annotations.readOnlyHint).toBe(tool._meta["eventdesk.ro/scope"] === "read");
    }
    expect(tools.find((x) => x.name === "propose_test_note")!.description).toContain("nothing changes until the user confirms");
    expect(res.body.result._meta["eventdesk.ro/catalogueVersion"]).toMatch(/^[a-f0-9]{12}$/);
    expect(listMcpTools().map((x) => x.name)).toEqual(tools.map((x) => x.name));
  });

  it("requests are rate-limited per token", async () => {
    const tok = await mkToken();
    const env = { MCP_CALLS_PER_MINUTE: "3" };
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    for (let i = 0; i < 3; i++) expect((await rpc(tok.token, ping, { env, now: at(100) })).status).toBe(200);
    const limited = await rpc(tok.token, ping, { env, now: at(100) });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe(MCP_ERRORS.rateLimited);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    const other = await mkToken();
    expect((await rpc(other.token, ping, { env, now: at(100) })).status).toBe(200);
  });

  // Security review 14 Nov 2026 (F-07): a batch is not a way around the fair-use limits.
  it("every message of a batch counts as a call: a batch over the limit runs nothing", async () => {
    const tok = await mkToken();
    const env = { MCP_CALLS_PER_MINUTE: "5" };
    const whoami = (id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "whoami", arguments: {} } });
    const before = (await t.db.select().from(mcpCallLog).where(eq(mcpCallLog.tokenId, tok.id))).length;
    // 4 messages: within the limit, all answered
    const ok = await rpc(tok.token, [1, 2, 3, 4].map(whoami), { env, now: at(200) });
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveLength(4);
    // 4 more in the same minute would make 8 > 5: refused as a whole, no tool runs
    const limited = await rpc(tok.token, [5, 6, 7, 8].map(whoami), { env, now: at(200) });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe(MCP_ERRORS.rateLimited);
    expect((await t.db.select().from(mcpCallLog).where(eq(mcpCallLog.tokenId, tok.id))).length).toBe(before + 4);
    // an oversized declared body is refused before it is read
    const big = await rpc(tok.token, { jsonrpc: "2.0", id: 1, method: "ping" }, { env: {}, now: at(300), headers: { "content-length": String(10 * 1024 * 1024) } });
    expect(big.status).toBe(413);
  });
});

describe("tools (MCP1, MCP2, MCP3, MCP5, MCP6, SEC15)", () => {
  it("whoami returns the account's own view; every call is logged and audited", async () => {
    const tok = await mkToken();
    const empty = await call(tok.token, "whoami");
    expect(empty.body.result).toMatchObject({ isError: false, structuredContent: { locale: "ro", scope: "read", occasions: [] } });
    expect(JSON.parse(empty.body.result.content[0].text)).toEqual(empty.body.result.structuredContent);

    setOccasionLister(async (ctx) => [{ id: "occ1", title: `Ocazia contului ${ctx.actor.accountId}` }]);
    const listed = await call(tok.token, "whoami");
    expect(listed.body.result.structuredContent.occasions).toEqual([{ id: "occ1", title: `Ocazia contului ${tok.accountId}` }]);
    setOccasionLister(async () => []);

    const unknown = await call(tok.token, "get_everything");
    expect(unknown.body.error.code).toBe(MCP_ERRORS.invalidParams);
    const bad = await call(tok.token, "propose_test_note", { text: 5 });
    expect(bad.body.result.isError).toBe(true);

    const log = await t.db.select().from(mcpCallLog).where(eq(mcpCallLog.tokenId, tok.id));
    expect(log.map((r) => [r.tool, r.ok, r.errorCode, r.scope]).sort()).toEqual(
      [
        ["whoami", true, null, "read"],
        ["whoami", true, null, "read"],
        ["get_everything", false, "unknown_tool", "read"],
        ["propose_test_note", false, "scope", "read"],
      ].sort(),
    );
    const audits = await t.db
      .select()
      .from(auditLog)
      .where(sql`${auditLog.action} = 'mcp.call' and ${auditLog.actorId} = ${tok.id}`);
    expect(audits).toHaveLength(4);
    expect(audits.every((r) => r.actorKind === "mcp" && (r.meta as { actorAccountId: string }).actorAccountId === tok.accountId)).toBe(true);
  });

  it("a read tool physically cannot write", async () => {
    const tok = await mkToken("read_propose");
    const res = await call(tok.token, "get_test_write");
    expect(res.body.result.isError).toBe(true);
    expect(await t.db.select().from(platformSettings).where(eq(platformSettings.key, "mcp.test.leak"))).toHaveLength(0);
    const [row] = await t.db.select().from(mcpCallLog).where(sql`${mcpCallLog.tokenId} = ${tok.id} and ${mcpCallLog.tool} = 'get_test_write'`);
    expect(row!.ok).toBe(false);
  });

  it("a read-only token cannot call a propose tool", async () => {
    const tok = await mkToken("read");
    const before = (await t.db.select().from(whatifPreviews)).length;
    const res = await call(tok.token, "propose_test_note", { subjectId: `${tok.accountId}x1`, text: "Salut" });
    expect(res.body.result.isError).toBe(true);
    expect(res.body.result.content[0].text).toContain("doar pentru citire");
    expect((await t.db.select().from(whatifPreviews)).length).toBe(before);
  });

  it("a propose tool creates a pending proposal, returns its id and confirm URL, and applies nothing", async () => {
    const tok = await mkToken("read_propose");
    const res = await call(tok.token, "propose_test_note", { subjectId: `${tok.accountId}x1`, text: "Dragi invitați" });
    expect(res.body.result.isError).toBe(false);
    const out = res.body.result.structuredContent;
    expect(out).toMatchObject({
      applied: false,
      label: EXTERNAL_ASSISTANT_LABEL,
      confirmUrl: `${APP}/occasions`,
      summary: { characters: 14 },
    });
    expect(out.label).toBe("creat cu un asistent extern");
    const [preview] = await t.db.select().from(whatifPreviews).where(eq(whatifPreviews.id, out.proposalId));
    expect(preview).toMatchObject({ state: "pending", proposedByKind: "mcp", proposedById: tok.id, accountId: tok.accountId });
    // the token can never confirm its own proposal — only the person, in the app
    const asToken = { db: t.db, actor: { kind: "mcp" as const, accountId: tok.accountId, tokenId: tok.id, scope: "read_propose" as const }, now: at(2), locale: "ro" as const };
    await expect(confirmPreview(asToken, out.proposalId)).rejects.toThrow();
    const confirmed = await confirmPreview(accountCtx(t.db, tok.accountId, { now: at(3) }), out.proposalId);
    expect(confirmed.appliedNow).toBe(true);

    // bounded by the user's own access exactly like the app (SEC15): someone else's subject is refused
    const stranger = await mkToken("read_propose");
    const denied = await call(stranger.token, "propose_test_note", { subjectId: `${tok.accountId}x1`, text: "x" });
    expect(denied.body.result.isError).toBe(true);
    const [deniedLog] = await t.db.select().from(mcpCallLog).where(eq(mcpCallLog.tokenId, stranger.id));
    expect(deniedLog).toMatchObject({ ok: false, errorCode: "FORBIDDEN" });
  });

  it("a propose tool that returns anything but a real pending proposal is treated as a failure", async () => {
    registerMcpTool({
      name: "propose_test_fake",
      version: "1",
      scope: "propose",
      title: "Fake",
      description: "Returns a made-up proposal.",
      inputSchema: z.object({}),
      handler: async () => mcpProposal({ id: "doesnotexist1", occasionId: null }),
    });
    const tok = await mkToken("read_propose");
    expect((await call(tok.token, "propose_test_fake")).body.result.isError).toBe(true);
  });

  it("the registry refuses admin, payment, other-account and sending tools (MCP6)", () => {
    const def = (name: string, scope: "read" | "propose") => ({
      name,
      scope,
      version: "1",
      title: "x",
      description: "x",
      inputSchema: z.object({}),
      handler: async () => ({}),
    });
    for (const [name, scope] of [
      ["pay_invoice", "read"],
      ["propose_payment", "propose"],
      ["propose_refund", "propose"],
      ["get_admin_stats", "read"],
      ["list_console_users", "read"],
      ["get_staff_list", "read"],
      ["propose_send_enquiry", "propose"],
      ["send_enquiry", "propose"],
      ["propose_delete_account", "propose"],
      ["delete_account", "read"],
      ["get_other_account_tasks", "read"],
      ["get_subscription", "read"],
      ["propose_publish_page", "propose"],
      ["apply_proposal", "propose"],
      ["propose_confirm_proposal", "propose"],
      ["list_tokens", "read"],
      ["update_task", "read"],
      ["get_tasks", "propose"],
      ["propose_tasks", "read"],
      ["Get_Tasks", "read"],
    ] as const) {
      expect(deniedToolNameReason(name, scope), name).not.toBeNull();
      expect(() => registerMcpTool(def(name, scope)), name).toThrow();
    }
    // the PRD's own catalogue passes
    for (const name of ["get_occasion", "list_tasks", "get_budget_summary", "get_space_model", "list_catalogues", "get_rsvp_summary", "search_directory", "get_listing"]) {
      expect(deniedToolNameReason(name, "read"), name).toBeNull();
    }
    for (const name of ["propose_budget", "propose_supplier_shortlist", "propose_seating_layout", "propose_custom_table", "propose_arrangement_design", "propose_invitation_text", "propose_task_list", "propose_budget_note"]) {
      expect(deniedToolNameReason(name, "propose"), name).toBeNull();
    }
    expect(listMcpTools().some((x) => /pay|refund|admin|console|enquiry|delete/.test(x.name))).toBe(false);
  });
});
