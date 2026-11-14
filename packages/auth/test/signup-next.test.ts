import { anonymousCtx, type Ctx } from "@ed/core/context";
import { LEGAL_PUBLISHED_SETTING } from "@ed/core/compliance";
import { issueFormStamp } from "@ed/core/ratelimit";
import { accounts, desc, emailOutbox, eq, platformSettings } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError, type AppError } from "@ed/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  consumeMagicLink,
  createAnonymousAccount,
  isSignupOpen,
  requestCodeFromLink,
  requestSignInCode,
  safeNextPath,
  signInPathFor,
  verifySignInCode,
  withNext,
} from "../src/index";

let t: TestDb;
const T0 = new Date("2026-06-01T08:00:10.000Z");
const realAppUrl = process.env.APP_URL;
let ipSeq = 0;
const anon = (now: Date = T0): Ctx => anonymousCtx(t.db, { now, ip: `10.9.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}` });
const stamp = () => issueFormStamp(new Date(T0.getTime() - 60_000));

beforeAll(async () => {
  t = await setupTestDb();
});
afterEach(() => {
  if (realAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = realAppUrl;
});
afterAll(async () => {
  await t.close();
});

async function fail(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return e;
    throw e;
  }
  throw new Error("expected an AppError");
}

async function lastMail(to: string) {
  const [row] = await t.db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, to)).orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id)).limit(1);
  if (!row?.bodyText) throw new Error(`no mail for ${to}`);
  return { body: row.bodyText, code: /^\s{4}(\d{6})$/m.exec(row.bodyText)![1]!, linkToken: /\/sign-in\/link\/([\w-]+)/.exec(row.bodyText)![1]! };
}

async function signIn(email: string, now: Date = T0) {
  await requestSignInCode(anon(now), { email });
  return verifySignInCode(anon(now), { email, code: (await lastMail(email)).code });
}

const setLegal = (value: unknown) =>
  t.db.insert(platformSettings).values({ key: LEGAL_PUBLISHED_SETTING, value }).onConflictDoUpdate({ target: platformSettings.key, set: { value } });
const published = { version: "1.0", publishedOn: "2026-05-01" };

describe("sign-in return path: safeNextPath (no open redirect)", () => {
  it("accepts same-origin relative paths under the allowlisted prefixes, with their query", () => {
    for (const ok of [
      "/invite/abcDEF123_-token",
      "/claim/k3j4h5g6f7d8s9a0",
      "/claim/k3j4h5g6f7d8s9a0/remove",
      "/directory/listing/abc123/enquire?occasion=xyz&kind=quote",
      "/occasions/abc123/proposals",
      "/business/invite/tok_en-123",
    ]) {
      expect(safeNextPath(ok), ok).toBe(ok);
    }
    // dot segments are resolved by the parser before the prefix is checked
    expect(safeNextPath("/invite/../occasions/abc")).toBe("/occasions/abc");
    // a fragment is dropped
    expect(safeNextPath("/occasions/abc#x")).toBe("/occasions/abc");
  });

  it("refuses everything else", () => {
    const bad: unknown[] = [
      undefined,
      null,
      42,
      "",
      "invite/abc",
      "https://evil.example/invite/abc",
      "http://evil.example",
      "//evil.example/invite/abc",
      "///evil.example/invite/abc",
      "/\\evil.example/invite/abc",
      "\\\\evil.example",
      "/invite/\\evil.example",
      "javascript:alert(1)",
      "data:text/html,x",
      "/invite/abc\n",
      "/invite/a b",
      "/\tinvite/abc",
      " /invite/abc",
      "/invite//evil.example",
      "/invite/%2F%2Fevil.example",
      "/invite/%5Cevil.example",
      "/invite/../../evil",
      "/invite/..",
      "/occasions/../account/delete",
      "/account",
      "/account/assistants",
      "/console",
      "/console/setup",
      "/api/auth/link/abcdefghijklmnopqrstuvwxyz",
      "/sign-in?next=/invite/abc",
      "/sign-out",
      "/mcp",
      "/g/sometoken",
      "/invite/",
      "/invite",
      "/occasionsX/abc",
      "/directoryevil/abc",
      `/invite/${"a".repeat(600)}`,
      "/invite/abc@evil.example/../..",
    ];
    for (const value of bad) expect(safeNextPath(value), String(value)).toBeNull();
  });

  it("withNext adds only a safe value and encodes it; signInPathFor builds the sign-in link", () => {
    expect(withNext("/sign-in", "/invite/abc?x=1&y=2")).toBe("/sign-in?next=%2Finvite%2Fabc%3Fx%3D1%26y%3D2");
    expect(withNext("/sign-in?e=limited", "/claim/abc12345")).toBe("/sign-in?e=limited&next=%2Fclaim%2Fabc12345");
    expect(withNext("/sign-in", "https://evil.example")).toBe("/sign-in");
    expect(withNext("/sign-in", "//evil.example")).toBe("/sign-in");
    expect(signInPathFor("/business/invite/tok")).toBe("/sign-in?next=%2Fbusiness%2Finvite%2Ftok");
    expect(signInPathFor("/account")).toBe("/sign-in");
    // what a browser sends back decodes to the same safe path
    const url = new URL(`https://app.test${withNext("/sign-in", "/directory/listing/a1/enquire?occasion=o1")}`);
    expect(safeNextPath(url.searchParams.get("next"))).toBe("/directory/listing/a1/enquire?occasion=o1");
  });

  it("the one-tap link carries a safe next and never an unsafe one", async () => {
    await requestSignInCode(anon(), { email: "next1@example.ro", next: "/invite/tok_123" });
    const first = await lastMail("next1@example.ro");
    expect(first.body).toContain(`/sign-in/link/${first.linkToken}?next=%2Finvite%2Ftok_123`);
    await requestSignInCode(anon(), { email: "next2@example.ro", next: "https://evil.example/invite/x" });
    expect((await lastMail("next2@example.ro")).body).not.toMatch(/next=|evil/);
    await requestSignInCode(anon(), { email: "next3@example.ro", next: "//evil.example" });
    expect((await lastMail("next3@example.ro")).body).not.toMatch(/next=|evil/);
    // the one new code a used link may ask for keeps the return path too
    await consumeMagicLink(anon(), { token: first.linkToken });
    await requestCodeFromLink(anon(), { token: first.linkToken, next: "/invite/tok_123" });
    expect((await lastMail("next1@example.ro")).body).toContain("?next=%2Finvite%2Ftok_123");
  });
});

describe("LAU1: no account is created before the legal documents are published", () => {
  it("local first run (APP_URL on localhost, nothing recorded) stays open", async () => {
    process.env.APP_URL = "http://localhost:3000";
    expect(await isSignupOpen(anon())).toBe(true);
    const res = await signIn("local@example.ro");
    expect(res.accountId).toBeTruthy();
  });

  it("on a real host sign-up is closed: no new email account, no anonymous account; existing accounts sign in", async () => {
    process.env.APP_URL = "http://localhost:3000";
    const existing = await signIn("existing@example.ro");

    process.env.APP_URL = "https://app.eventdesk.ro";
    expect(await isSignupOpen(anon())).toBe(false);
    await requestSignInCode(anon(), { email: "newcomer@example.ro" }); // same answer as ever (SEC1)
    const mail = await lastMail("newcomer@example.ro");
    const refused = await fail(verifySignInCode(anon(), { email: "newcomer@example.ro", code: mail.code }));
    expect(refused).toMatchObject({ code: "FORBIDDEN", messageKey: "auth.errors.signupsClosed" });
    expect(await t.db.select().from(accounts).where(eq(accounts.email, "newcomer@example.ro"))).toHaveLength(0);
    // the one-tap link is refused the same way
    await requestSignInCode(anon(), { email: "newcomer2@example.ro" });
    const viaLink = await fail(consumeMagicLink(anon(), { token: (await lastMail("newcomer2@example.ro")).linkToken }));
    expect(viaLink.messageKey).toBe("auth.errors.signupsClosed");
    expect(await t.db.select().from(accounts).where(eq(accounts.email, "newcomer2@example.ro"))).toHaveLength(0);
    // anonymous sign-up too
    const before = (await t.db.select().from(accounts).where(eq(accounts.kind, "anonymous"))).length;
    const anonRefused = await fail(createAnonymousAccount(anon(), { password: "o parolă lungă 1", honeypot: "", renderedAt: stamp() }));
    expect(anonRefused).toMatchObject({ code: "FORBIDDEN", messageKey: "auth.errors.signupsClosed" });
    expect((await t.db.select().from(accounts).where(eq(accounts.kind, "anonymous"))).length).toBe(before);

    // an account that already exists keeps signing in
    const again = await signIn("existing@example.ro", new Date(T0.getTime() + 5 * 60_000));
    expect(again.accountId).toBe(existing.accountId);
  });

  it("opens when terms, privacy policy and cookie notice are published; a recorded but incomplete setting closes localhost too", async () => {
    process.env.APP_URL = "http://localhost:3000";
    await setLegal({ terms: published, privacy: published, cookies: { version: null, publishedOn: null } });
    expect(await isSignupOpen(anon())).toBe(false);
    expect((await fail(signIn("half@example.ro"))).messageKey).toBe("auth.errors.signupsClosed");

    process.env.APP_URL = "https://app.eventdesk.ro";
    // a publication date in the future does not count yet
    await setLegal({ terms: published, privacy: published, cookies: { version: "1.0", publishedOn: "2026-07-01" } });
    expect(await isSignupOpen(anon())).toBe(false);
    await setLegal({ terms: published, privacy: published, cookies: published });
    expect(await isSignupOpen(anon())).toBe(true);
    expect((await signIn("welcome@example.ro")).accountId).toBeTruthy();
    const created = await createAnonymousAccount(anon(), { password: "o parolă lungă 1", honeypot: "", renderedAt: stamp() });
    expect(created.username).toMatch(/^ed-/);
  });
});
