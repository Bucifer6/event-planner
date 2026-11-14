import { accounts, aiTextResults, aiTextUsage, eq, households, guests } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AI_TEXT_LABEL,
  AI_TEXT_MONTHLY_LIMIT,
  AI_TEXT_SETTING_KEY,
  buildAiTextPayload,
  getAiTextConfig,
  getAiTextStatus,
  markAiTextAccepted,
  readAiTextProviderRecord,
  suggestText,
  type AiTextFetcher,
} from "../src/aitext";
import { accountCtx, makeCtx } from "../src/context";
import { readSetting } from "../src/staff";
import { code } from "./_releasec";

// INF7 / Q6: wording suggestions only, ten results per account per calendar month, shown to
// the user first, minimal context sent, provider and model recorded for the console.

let t: TestDb;
const DEV = { AI_TEXT_PROVIDER: "dev" };
const at = (iso: string) => new Date(iso);
let seq = 0;
async function account(): Promise<string> {
  const id = `acc_ai_${++seq}`;
  await t.db.insert(accounts).values({ id, kind: "email", email: `${id}@example.test` });
  return id;
}
const ctxOf = (id: string, now: Date) => accountCtx(t.db, id, { now });

beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("configuration is the operator's, never a guess", () => {
  it("is off unless configured; the http provider needs a URL and a model", () => {
    expect(getAiTextConfig({}).provider).toBe("off");
    expect(getAiTextConfig({ AI_TEXT_PROVIDER: "some-vendor" }).provider).toBe("off"); // unknown names are not guessed at
    expect(getAiTextConfig(DEV)).toMatchObject({ provider: "dev", model: "templates-v1" });
    expect(getAiTextConfig({ AI_TEXT_PROVIDER: "http", AI_TEXT_MODEL: "m-1", AI_TEXT_URL: "https://ai.example.test/v1", AI_TEXT_API_KEY: "k" })).toEqual({ provider: "http", model: "m-1", url: "https://ai.example.test/v1", apiKey: "k" });
  });

  it("refuses to suggest when nothing is configured, without spending a result", async () => {
    const id = await account();
    const now = at("2027-03-10T10:00:00Z");
    expect(await code(() => suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta" }, { env: {} }))).toBe("CONFLICT:aitext.errors.notConfigured");
    expect(await code(() => suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta" }, { env: { AI_TEXT_PROVIDER: "http" } }))).toBe("CONFLICT:aitext.errors.notConfigured");
    expect((await getAiTextStatus(ctxOf(id, now))).used).toBe(0);
  });
});

describe("ten results a month (Q6)", () => {
  it("the eleventh is refused with a clear message and the reset date; the count starts again next month", async () => {
    const id = await account();
    const now = at("2027-03-31T20:30:00Z"); // 23:30 in Bucharest, still March
    for (let i = 1; i <= AI_TEXT_MONTHLY_LIMIT; i += 1) {
      const s = await suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta", names: "Ioana & Ștefan" }, { env: DEV });
      expect(s.text.length).toBeGreaterThan(20);
      expect(s.label).toBe("generat cu AI");
      expect(s.remaining).toBe(AI_TEXT_MONTHLY_LIMIT - i);
    }
    let error: unknown;
    try {
      await suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta" }, { env: DEV });
    } catch (e) {
      error = e;
    }
    expect(isAppError(error) && error.code).toBe("LIMIT");
    if (!isAppError(error)) throw new Error("expected AppError");
    expect(error.messageKey).toBe("aitext.errors.monthlyLimit");
    expect(error.details?.params).toEqual({ limit: 10, date: "1 aprilie 2027" });
    expect(error.details?.retryAt).toBe("2027-03-31T21:00:00.000Z"); // midnight in Bucharest
    const status = await getAiTextStatus(ctxOf(id, now));
    expect(status).toMatchObject({ enabled: false, used: 10, remaining: 0, limit: 10 }); // (enabled reflects process.env, unset in tests)
    expect((await t.db.select().from(aiTextResults).where(eq(aiTextResults.accountId, id))).length).toBe(10);
    // another account is not affected
    const other = await account();
    expect((await suggestText(ctxOf(other, now), { purpose: "thanks", occasionKind: "botez" }, { env: DEV })).remaining).toBe(9);
    // one hour later it is April in Bucharest: a fresh ten
    const april = at("2027-03-31T21:30:00Z");
    expect((await getAiTextStatus(ctxOf(id, april))).remaining).toBe(10);
    expect((await suggestText(ctxOf(id, april), { purpose: "invitation", occasionKind: "nunta" }, { env: DEV })).remaining).toBe(9);
  });

  it("is enforced on the server under concurrency: twelve simultaneous requests yield exactly ten", async () => {
    const id = await account();
    const now = at("2027-05-05T10:00:00Z");
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "aniversare" }, { env: DEV })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(2);
    const [row] = await t.db.select().from(aiTextUsage).where(eq(aiTextUsage.accountId, id));
    expect(row!.used).toBe(10);
  });

  it("a failed provider call is not counted", async () => {
    const id = await account();
    const now = at("2027-06-05T10:00:00Z");
    const env = { AI_TEXT_PROVIDER: "http", AI_TEXT_MODEL: "m-1", AI_TEXT_URL: "https://ai.example.test/v1" };
    const failing: AiTextFetcher = async () => ({ ok: false, status: 503, json: async () => ({}) });
    expect(await code(() => suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta" }, { env, fetcher: failing }))).toBe("CONFLICT:aitext.errors.providerFailed");
    const empty: AiTextFetcher = async () => ({ ok: true, status: 200, json: async () => ({ text: "   " }) });
    expect(await code(() => suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta" }, { env, fetcher: empty }))).toBe("CONFLICT:aitext.errors.providerFailed");
    expect((await getAiTextStatus(ctxOf(id, now))).used).toBe(0);
  });
});

describe("what leaves the server, and what comes back", () => {
  it("sends only the kind of occasion, tone, language and what the user typed — never guests or contacts", async () => {
    const id = await account();
    const now = at("2027-07-05T10:00:00Z");
    // records that must never travel
    await t.db.insert(households).values({ id: "hh_secret", occasionId: "none", name: "Familia Secretescu", leadEmail: "secret@example.test" }).catch(() => undefined);
    await t.db.insert(guests).values({ id: "g_secret", occasionId: "none", householdId: "hh_secret", fullName: "Invitat Tainic" }).catch(() => undefined);
    const sent: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    const fetcher: AiTextFetcher = async (url, init) => {
      sent.push({ url, headers: init.headers, body: init.body });
      return { ok: true, status: 200, json: async () => ({ text: "Vă invităm cu drag\u0007 la nunta noastră.\r\n\r\n\r\n\r\nCu bucurie!" }) };
    };
    const env = { AI_TEXT_PROVIDER: "http", AI_TEXT_MODEL: "m-1", AI_TEXT_URL: "https://ai.example.test/v1", AI_TEXT_API_KEY: "key-123" };
    const s = await suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta", tone: "ceremonious", language: "ro", names: "Ioana & Ștefan", hint: "în aer liber" }, { env, fetcher });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://ai.example.test/v1");
    expect(sent[0]!.headers.authorization).toBe("Bearer key-123");
    const body = JSON.parse(sent[0]!.body) as Record<string, unknown>;
    expect(body).toEqual({ task: "wording_suggestion", model: "m-1", purpose: "invitation", occasionKind: "nunta", tone: "ceremonious", language: "ro", names: "Ioana & Ștefan", hint: "în aer liber", maxCharacters: 400 });
    expect(Object.keys(body).sort()).toEqual(["hint", "language", "maxCharacters", "model", "names", "occasionKind", "purpose", "task", "tone"]);
    expect(sent[0]!.body).not.toMatch(/Secretescu|secret@example|Tainic|acc_ai_|@example\.test/);
    expect(buildAiTextPayload({ purpose: "thanks", occasionKind: "botez" }, { model: "x" })).toMatchObject({ names: null, hint: null, tone: "warm", language: "ro" });
    // what comes back is treated as plain, bounded text
    expect(s.text).toBe("Vă invităm cu drag la nunta noastră.\n\nCu bucurie!");
    // the suggestion is only RETURNED: nothing was written anywhere but the usage counter and the result fact
    expect((await t.db.select().from(aiTextResults).where(eq(aiTextResults.accountId, id)))[0]).toMatchObject({ provider: "http", model: "m-1", purpose: "invitation", acceptedAt: null });
    await markAiTextAccepted(ctxOf(id, now), s.resultId);
    expect((await t.db.select().from(aiTextResults).where(eq(aiTextResults.accountId, id)))[0]!.acceptedAt).toEqual(now);
  });

  it("the dev provider composes from templates, deterministically, in the language asked for", async () => {
    const id = await account();
    const now = at("2027-08-05T10:00:00Z");
    const a = await suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta", tone: "playful", language: "ro", names: "Ana și Mihai" }, { env: DEV });
    const b = await suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta", tone: "playful", language: "ro", names: "Ana și Mihai" }, { env: DEV });
    expect(a.text).toContain("Ana și Mihai");
    expect(a.text).toContain("nunta noastră");
    expect(b.text).not.toBe(a.text); // the next result is the other variant
    const en = await suggestText(ctxOf(id, now), { purpose: "thanks", occasionKind: "botez", tone: "warm", language: "en" }, { env: DEV });
    expect(en.text).toContain("christening");
    expect(en.label).toBe(AI_TEXT_LABEL.en);
    expect(en.text).not.toMatch(/aitext\./); // every template exists
  });

  it("records the provider and model in use where the console reads platform settings", async () => {
    const id = await account();
    const now = at("2027-09-05T10:00:00Z");
    await suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta" }, { env: DEV });
    expect(await readAiTextProviderRecord({ db: t.db })).toMatchObject({ provider: "dev", model: "templates-v1" });
    expect(await readSetting({ db: t.db }, AI_TEXT_SETTING_KEY)).toMatchObject({ provider: "dev", model: "templates-v1" });
    const fetcher: AiTextFetcher = async () => ({ ok: true, status: 200, json: async () => ({ text: "Un text potrivit." }) });
    await suggestText(ctxOf(id, now), { purpose: "invitation", occasionKind: "nunta" }, { env: { AI_TEXT_PROVIDER: "http", AI_TEXT_MODEL: "m-2", AI_TEXT_URL: "https://ai.example.test/v1" }, fetcher });
    expect(await readAiTextProviderRecord({ db: t.db })).toMatchObject({ provider: "http", model: "m-2", recordedAt: now.toISOString() });
  });

  it("is for a person in the app: not an assistant token, a guest, the system or nobody", async () => {
    const id = await account();
    const now = at("2027-10-05T10:00:00Z");
    const input = { purpose: "invitation", occasionKind: "nunta" } as const;
    expect(await code(() => suggestText(makeCtx(t.db, { kind: "mcp", accountId: id, tokenId: "tok", scope: "read_propose" }, { now }), input, { env: DEV }))).toMatch(/^FORBIDDEN/);
    expect(await code(() => suggestText(makeCtx(t.db, { kind: "system" }, { now }), input, { env: DEV }))).toMatch(/^FORBIDDEN/);
    expect(await code(() => suggestText(makeCtx(t.db, { kind: "anonymous" }, { now }), input, { env: DEV }))).toMatch(/^UNAUTHENTICATED/);
    expect(await code(() => suggestText(makeCtx(t.db, { kind: "guest", invitationId: "i", householdId: "h", occasionId: "o" }, { now }), input, { env: DEV }))).toMatch(/^FORBIDDEN/);
    expect((await getAiTextStatus(ctxOf(id, now))).used).toBe(0);
  });
});
