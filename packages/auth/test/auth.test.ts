import { accountCtx, anonymousCtx, type Ctx } from "@ed/core/context";
import { issueFormStamp } from "@ed/core/ratelimit";
import {
  accounts,
  and,
  desc,
  emailOutbox,
  eq,
  magicLinks,
  recoveryCodes,
  securityLog,
  sessions,
  signInCodes,
  totpSecrets,
} from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { hashToken, isAppError, type AppError } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  beginTotpEnrolment,
  confirmFreshAuth,
  confirmNewEmail,
  confirmTotpEnrolment,
  consumeMagicLink,
  createAnonymousAccount,
  createSession,
  disableTotp,
  getTwoStepStatus,
  isFreshAuth,
  listSessions,
  onSignOutEverywhere,
  recoverAnonymousAccount,
  removeEmail,
  requestCodeFromLink,
  requestFreshAuthCode,
  requestNewEmailCode,
  requestSignInCode,
  requireFreshAuth,
  resolveSession,
  signInAnonymous,
  signOutEverywhere,
  totpCodeAt,
  verifySecondFactor,
  verifySignInCode,
} from "../src/index";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = new Date("2026-06-01T08:00:10.000Z");
const plus = (ms: number) => new Date(T0.getTime() + ms);

let ipSeq = 0;
/** A fresh IP per call unless given, so IP limits do not couple unrelated tests. */
const anon = (now: Date = T0, ip?: string): Ctx =>
  anonymousCtx(t.db, { now, ip: ip ?? `10.${Math.floor(ipSeq / 60000)}.${Math.floor(ipSeq / 250) % 250}.${ipSeq++ % 250}` });

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
  const [row] = await t.db
    .select()
    .from(emailOutbox)
    .where(eq(emailOutbox.toEmail, to))
    .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
    .limit(1);
  if (!row?.bodyText) throw new Error(`no mail for ${to}`);
  return {
    row,
    code: /^\s{4}(\d{6})$/m.exec(row.bodyText)![1]!,
    linkToken: /\/sign-in\/link\/([\w-]+)/.exec(row.bodyText)?.[1],
  };
}

async function mailCount(to: string) {
  return (await t.db.select().from(emailOutbox).where(eq(emailOutbox.toEmail, to))).length;
}

/** Sign an email account in through the real flow; returns the cookie token. */
async function signInByCode(email: string, now: Date = T0) {
  await requestSignInCode(anon(now), { email });
  const { code } = await lastMail(email);
  return verifySignInCode(anon(now), { email, code, userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36" });
}

const sessionCtx = (accountId: string, sessionId: string, now: Date): Ctx =>
  ({ ...accountCtx(t.db, accountId, { now, ip: `10.200.0.${ipSeq++ % 250}` }), actor: { kind: "account", accountId, sessionId } }) as Ctx;

describe("email code sign-in (S1, INF4, SEC1, SEC8)", () => {
  it("answers identically for an existing and an unknown address", async () => {
    await signInByCode("known@example.ro");
    const later = plus(2 * 60 * MIN);
    const a = await requestSignInCode(anon(later), { email: "known@example.ro" });
    const b = await requestSignInCode(anon(later), { email: "never-seen@example.ro" });
    expect(a).toEqual(b);
    expect(Object.keys(a)).toEqual(["expiresAt"]);
    expect(a.expiresAt.toISOString()).toBe(plus(2 * 60 * MIN + 15 * MIN).toISOString());
    const ma = await lastMail("known@example.ro");
    const mb = await lastMail("never-seen@example.ro");
    expect(ma.row.template).toBe(mb.row.template);
    expect(ma.row.subject).toBe(mb.row.subject);
    const strip = (s: string) => s.replace(/\d{6}/g, "CODE").replace(/link\/[\w-]+/g, "link/TOKEN");
    expect(strip(ma.row.bodyText!)).toBe(strip(mb.row.bodyText!));
    // no account is created by asking
    expect(await t.db.select().from(accounts).where(eq(accounts.email, "never-seen@example.ro"))).toHaveLength(0);
    // the security log never says whether the account exists
    expect(JSON.stringify(await t.db.select().from(securityLog)).toLowerCase()).not.toContain("exist");
  });

  it("creates the account on first confirmation; the code is single use", async () => {
    const res = await signInByCode("first@example.ro");
    expect(res.secondFactorRequired).toBe(false);
    const [acc] = await t.db.select().from(accounts).where(eq(accounts.email, "first@example.ro"));
    expect(acc).toMatchObject({ kind: "email", id: res.accountId, passwordHash: null });
    expect(acc?.emailVerifiedAt).not.toBeNull();
    const { code } = await lastMail("first@example.ro");
    const e = await fail(verifySignInCode(anon(), { email: "first@example.ro", code }));
    expect(e.code).toBe("VALIDATION");
    expect(e.messageKey).toBe("auth.errors.codeInvalid");
    expect(e.details?.fieldErrors).toEqual({ code: ["auth.errors.codeInvalid"] });
  });

  it("stores codes, links and session tokens hashed only", async () => {
    await requestSignInCode(anon(), { email: "hashed@example.ro" });
    const { code, linkToken } = await lastMail("hashed@example.ro");
    const res = await verifySignInCode(anon(), { email: "hashed@example.ro", code });
    const dump = JSON.stringify([
      await t.db.select().from(signInCodes),
      await t.db.select({ tokenHash: magicLinks.tokenHash }).from(magicLinks),
      await t.db.select().from(sessions),
    ]);
    expect(dump).not.toContain(linkToken!);
    expect(dump).not.toContain(res.token);
    const codes = await t.db.select().from(signInCodes).where(eq(signInCodes.emailHash, hashToken("hashed@example.ro")));
    expect(codes).toHaveLength(1);
    expect(codes[0]!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(codes[0]!.codeHash).not.toBe(hashToken(code));
    expect(JSON.stringify(codes)).not.toContain("hashed@example.ro");
    const [s] = await t.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(res.token)));
    expect(s?.accountId).toBe(res.accountId);
  });

  it("a newer code invalidates the older one at once", async () => {
    const email = "newer@example.ro";
    await requestSignInCode(anon(), { email });
    const old = await lastMail(email);
    await requestSignInCode(anon(plus(MIN)), { email });
    const fresh = await lastMail(email);
    expect(fresh.row.id).not.toBe(old.row.id);
    if (old.code !== fresh.code) {
      expect((await fail(verifySignInCode(anon(plus(2 * MIN)), { email, code: old.code }))).messageKey).toBe("auth.errors.codeInvalid");
    }
    // the old one-tap link died with its code
    expect((await consumeMagicLink(anon(plus(2 * MIN)), { token: old.linkToken! })).status).toBe("expired");
    expect((await verifySignInCode(anon(plus(2 * MIN)), { email, code: fresh.code })).accountId).toBeTruthy();
  });

  it("allows five attempts per code: the sixth fails even with the right code", async () => {
    const email = "attempts@example.ro";
    await requestSignInCode(anon(), { email });
    const { code } = await lastMail(email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      expect((await fail(verifySignInCode(anon(), { email, code: wrong }))).messageKey).toBe("auth.errors.codeInvalid");
    }
    const sixth = await fail(verifySignInCode(anon(), { email, code }));
    expect(sixth.messageKey).toBe("auth.errors.codeInvalid");
    expect(await t.db.select().from(accounts).where(eq(accounts.email, email))).toHaveLength(0);
  });

  it("a fifth attempt with the right code still works; the code expires after 15 minutes", async () => {
    const email = "fifth@example.ro";
    await requestSignInCode(anon(), { email });
    const { code } = await lastMail(email);
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 4; i++) await fail(verifySignInCode(anon(), { email, code: wrong }));
    expect((await verifySignInCode(anon(), { email, code: `${code.slice(0, 3)} ${code.slice(3)}` })).accountId).toBeTruthy();

    const email2 = "expired@example.ro";
    await requestSignInCode(anon(), { email: email2 });
    const m = await lastMail(email2);
    expect((await fail(verifySignInCode(anon(plus(15 * MIN + 1000)), { email: email2, code: m.code }))).messageKey).toBe("auth.errors.codeInvalid");
    expect((await consumeMagicLink(anon(plus(15 * MIN + 1000)), { token: m.linkToken! })).status).toBe("expired");
  });

  it("rate limits: 4th request for one address in an hour gets the generic message + retry time, for known and unknown alike", async () => {
    await signInByCode("limited-known@example.ro", plus(3 * 60 * MIN));
    const now = plus(5 * 60 * MIN);
    for (const email of ["limited-known@example.ro", "limited-unknown@example.ro"]) {
      for (let i = 0; i < 3; i++) await requestSignInCode(anon(new Date(now.getTime() + i * 1000)), { email });
    }
    const a = await fail(requestSignInCode(anon(now), { email: "limited-known@example.ro" }));
    const b = await fail(requestSignInCode(anon(now), { email: "limited-unknown@example.ro" }));
    expect(a.code).toBe("RATE_LIMITED");
    expect(a.messageKey).toBe("common.errors.RATE_LIMITED");
    expect({ code: a.code, key: a.messageKey, details: a.details }).toEqual({ code: b.code, key: b.messageKey, details: b.details });
    expect(new Date(a.details!.retryAt!).getTime()).toBeGreaterThan(now.getTime());
    expect(await mailCount("limited-unknown@example.ro")).toBe(3);
    // the codes already sent still work: a flood is not a lockout
    const { code } = await lastMail("limited-known@example.ro");
    expect((await verifySignInCode(anon(now), { email: "limited-known@example.ro", code })).accountId).toBeTruthy();
  });

  it("rate limits: IP and device axes trip independently on code entry", async () => {
    const now = plus(7 * 60 * MIN);
    for (let i = 0; i < 20; i++) await fail(verifySignInCode(anon(now, "10.250.0.1"), { email: `x${i}@example.ro`, code: "123456" }));
    expect((await fail(verifySignInCode(anon(now, "10.250.0.1"), { email: "y@example.ro", code: "123456" }))).code).toBe("RATE_LIMITED");
    for (let i = 0; i < 20; i++) await fail(verifySignInCode(anon(now), { email: `z${i}@example.ro`, code: "123456", deviceId: "dev-entry" }));
    expect((await fail(verifySignInCode(anon(now), { email: "w@example.ro", code: "123456", deviceId: "dev-entry" }))).code).toBe("RATE_LIMITED");
  });
});

describe("one-tap link (S1, SEC14)", () => {
  it("signs in once; a second use lands on the consumed path", async () => {
    const email = "link@example.ro";
    await requestSignInCode(anon(), { email });
    const { linkToken } = await lastMail(email);
    const first = await consumeMagicLink(anon(), { token: linkToken! });
    expect(first.status).toBe("signed_in");
    if (first.status !== "signed_in") throw new Error();
    expect((await resolveSession(anon(), first.token))?.accountId).toBe(first.accountId);
    expect((await consumeMagicLink(anon(), { token: linkToken! })).status).toBe("used");
    expect((await consumeMagicLink(anon(), { token: "x".repeat(43) })).status).toBe("unknown");
  });

  it("a scanner-consumed link leaves the code working, and the consumed page gives exactly one new code", async () => {
    const email = "scanner@example.ro";
    await requestSignInCode(anon(), { email });
    const m = await lastMail(email);
    expect((await consumeMagicLink(anon(), { token: m.linkToken! })).status).toBe("signed_in"); // the scanner
    // the person can type the code on the consumed-link page (identified by the link token)
    const viaToken = await verifySignInCode(anon(plus(MIN)), { linkToken: m.linkToken!, code: m.code });
    expect(viaToken.accountId).toBeTruthy();

    // one new code from the consumed page
    const before = await mailCount(email);
    const r1 = await requestCodeFromLink(anon(plus(2 * MIN)), { token: m.linkToken! });
    expect(await mailCount(email)).toBe(before + 1);
    const r2 = await requestCodeFromLink(anon(plus(3 * MIN)), { token: m.linkToken! });
    const r3 = await requestCodeFromLink(anon(plus(3 * MIN)), { token: "y".repeat(43) });
    expect(await mailCount(email)).toBe(before + 1);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
    const next = await lastMail(email);
    expect((await verifySignInCode(anon(plus(4 * MIN)), { linkToken: m.linkToken!, code: next.code })).accountId).toBe(viaToken.accountId);
  });

  it("the new-code offer is rate-limited like any code request (INF4)", async () => {
    const email = "scanner-limited@example.ro";
    const now = plus(9 * 60 * MIN);
    for (let i = 0; i < 3; i++) await requestSignInCode(anon(now), { email });
    const m = await lastMail(email);
    await consumeMagicLink(anon(now), { token: m.linkToken! });
    expect((await fail(requestCodeFromLink(anon(now), { token: m.linkToken! }))).code).toBe("RATE_LIMITED");
  });
});

describe("anonymous accounts (S7, S8)", () => {
  const stamp = () => issueFormStamp(new Date(T0.getTime() - 20_000));
  const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1";

  it("signs up with a generated username, Argon2id hash and ten one-time recovery codes", async () => {
    const res = await createAnonymousAccount(anon(), { password: "o parolă lungă 1", honeypot: "", renderedAt: stamp(), userAgent: ua });
    expect(res.username).toMatch(/^ed-[a-z0-9]{10}$/);
    expect(res.recoveryCodes).toHaveLength(10);
    expect(new Set(res.recoveryCodes).size).toBe(10);
    const [acc] = await t.db.select().from(accounts).where(eq(accounts.id, res.accountId));
    expect(acc).toMatchObject({ kind: "anonymous", email: null, username: res.username });
    expect(acc?.passwordHash).toMatch(/^\$argon2id\$/);
    const stored = await t.db.select().from(recoveryCodes).where(eq(recoveryCodes.accountId, res.accountId));
    expect(stored).toHaveLength(10);
    const dump = JSON.stringify(stored);
    for (const c of res.recoveryCodes) expect(dump).not.toContain(c);
    expect(stored.every((s) => s.lastFour.length === 4)).toBe(true);
    expect((await resolveSession(anon(), res.token))?.deviceType).toBe("phone");
    // two accounts with the same password get different hashes (per-account salt)
    const other = await createAnonymousAccount(anon(), { password: "o parolă lungă 1", honeypot: "", renderedAt: stamp() });
    const [acc2] = await t.db.select().from(accounts).where(eq(accounts.id, other.accountId));
    expect(acc2?.passwordHash).not.toBe(acc?.passwordHash);
  });

  it("rejects bots (honeypot, too fast) with a retry time and short passwords with a field error", async () => {
    expect((await fail(createAnonymousAccount(anon(), { password: "o parolă lungă 1", honeypot: "x", renderedAt: stamp() }))).code).toBe("RATE_LIMITED");
    const fast = await fail(createAnonymousAccount(anon(), { password: "o parolă lungă 1", honeypot: "", renderedAt: issueFormStamp(T0) }));
    expect(fast.code).toBe("RATE_LIMITED");
    expect(fast.details?.retryAt).toBeTruthy();
    await expect(createAnonymousAccount(anon(), { password: "scurt", honeypot: "", renderedAt: stamp() })).rejects.toThrow(/passwordTooShort/);
  });

  it("signs in with username + password; wrong username and wrong password fail identically", async () => {
    const acc = await createAnonymousAccount(anon(), { password: "parola-mea-bună", honeypot: "", renderedAt: stamp() });
    const ok = await signInAnonymous(anon(), { username: ` ${acc.username.toUpperCase()} `, password: "parola-mea-bună" });
    expect(ok.accountId).toBe(acc.accountId);
    const a = await fail(signInAnonymous(anon(), { username: acc.username, password: "greșită-greșită" }));
    const b = await fail(signInAnonymous(anon(), { username: "ed-nuexista00", password: "parola-mea-bună" }));
    expect({ code: a.code, key: a.messageKey, details: a.details }).toEqual({ code: b.code, key: b.messageKey, details: b.details });
    expect(a.messageKey).toBe("auth.errors.credentialsInvalid");
    // password sign-in is not a fresh proof for sensitive actions (S8: recovery code instead)
    const s = (await resolveSession(anon(), ok.token))!;
    expect(await isFreshAuth(sessionCtx(acc.accountId, s.id, T0))).toBe(false);
  });

  it("limits password entry per username with the generic message", async () => {
    const acc = await createAnonymousAccount(anon(), { password: "parola-mea-bună", honeypot: "", renderedAt: stamp() });
    const now = plus(11 * 60 * MIN);
    for (let i = 0; i < 10; i++) await fail(signInAnonymous(anon(now), { username: acc.username, password: "nu-e-asta-deloc" }));
    const e = await fail(signInAnonymous(anon(now), { username: acc.username, password: "parola-mea-bună" }));
    expect(e.code).toBe("RATE_LIMITED");
    expect(e.details?.retryAt).toBeTruthy();
  });

  it("a recovery code confirms a sensitive action once (S4) and recovers a lost password once", async () => {
    const acc = await createAnonymousAccount(anon(), { password: "parola-mea-bună", honeypot: "", renderedAt: stamp() });
    const s = (await resolveSession(anon(), acc.token))!;
    const ctx = sessionCtx(acc.accountId, s.id, T0);
    expect((await fail(requireFreshAuth(ctx))).messageKey).toBe("account.errors.freshAuthRequired");
    expect((await fail(requestFreshAuthCode(ctx))).messageKey).toBe("account.errors.useRecoveryCode");
    expect((await fail(confirmFreshAuth(ctx, { recoveryCode: "AAAAA-AAAAA" }))).messageKey).toBe("auth.errors.recoveryCodeInvalid");
    await confirmFreshAuth(ctx, { recoveryCode: acc.recoveryCodes[0]!.toLowerCase().replace("-", " ") });
    await requireFreshAuth(ctx);
    expect(await isFreshAuth(sessionCtx(acc.accountId, s.id, plus(10 * MIN + 1000)))).toBe(false);
    expect((await fail(confirmFreshAuth(sessionCtx(acc.accountId, s.id, plus(11 * MIN)), { recoveryCode: acc.recoveryCodes[0]! }))).code).toBe("VALIDATION");

    const bad = await fail(recoverAnonymousAccount(anon(), { username: acc.username, recoveryCode: acc.recoveryCodes[0]!, newPassword: "alta-parolă-nouă" }));
    const unknown = await fail(recoverAnonymousAccount(anon(), { username: "ed-nuexista00", recoveryCode: acc.recoveryCodes[1]!, newPassword: "alta-parolă-nouă" }));
    expect(bad.messageKey).toBe("auth.errors.credentialsInvalid");
    expect(unknown.messageKey).toBe(bad.messageKey);
    const rec = await recoverAnonymousAccount(anon(), { username: acc.username, recoveryCode: acc.recoveryCodes[1]!, newPassword: "alta-parolă-nouă" });
    expect(rec.accountId).toBe(acc.accountId);
    expect(await resolveSession(anon(), acc.token)).toBeNull(); // old sessions are out
    expect((await fail(signInAnonymous(anon(), { username: acc.username, password: "parola-mea-bună" }))).messageKey).toBe("auth.errors.credentialsInvalid");
    expect((await signInAnonymous(anon(), { username: acc.username, password: "alta-parolă-nouă" })).accountId).toBe(acc.accountId);
    expect((await getTwoStepStatus(sessionCtx(acc.accountId, s.id, T0))).recoveryCodesLeft).toBe(8);
  });

  it("adding an email makes it an email account; removing it returns to anonymous rules with fresh codes", async () => {
    const acc = await createAnonymousAccount(anon(), { password: "parola-mea-bună", honeypot: "", renderedAt: stamp() });
    const s = (await resolveSession(anon(), acc.token))!;
    const ctx = sessionCtx(acc.accountId, s.id, T0);
    expect((await fail(requestNewEmailCode(ctx, { email: "anon-new@example.ro" }))).messageKey).toBe("account.errors.freshAuthRequired");
    await confirmFreshAuth(ctx, { recoveryCode: acc.recoveryCodes[0]! });
    await requestNewEmailCode(ctx, { email: "Anon-New@Example.ro" });
    const { code, row } = await lastMail("anon-new@example.ro");
    expect(row.template).toBe("auth.newEmail");
    const session = await confirmNewEmail(ctx, { email: "anon-new@example.ro", code });
    const [after] = await t.db.select().from(accounts).where(eq(accounts.id, acc.accountId));
    expect(after).toMatchObject({ kind: "email", email: "anon-new@example.ro", passwordHash: null, username: acc.username });
    expect(await resolveSession(anon(), acc.token)).toBeNull();
    expect((await resolveSession(anon(), session.token))?.accountId).toBe(acc.accountId);
    expect(await t.db.select().from(recoveryCodes).where(eq(recoveryCodes.accountId, acc.accountId))).toHaveLength(0);
    // the password no longer signs in; the email code does
    expect((await fail(signInAnonymous(anon(), { username: acc.username, password: "parola-mea-bună" }))).messageKey).toBe("auth.errors.credentialsInvalid");
    expect((await signInByCode("anon-new@example.ro", plus(MIN))).accountId).toBe(acc.accountId);

    // remove it again: needs a fresh EMAILED code now
    const later = plus(30 * MIN);
    const ctx2 = sessionCtx(acc.accountId, session.sessionId, later);
    expect((await fail(removeEmail(ctx2, { password: "o-parolă-cu-totul-nouă" }))).messageKey).toBe("account.errors.freshAuthRequired");
    await requestFreshAuthCode(ctx2);
    const confirm = await lastMail("anon-new@example.ro");
    expect(confirm.row.template).toBe("auth.confirm");
    await confirmFreshAuth(ctx2, { code: confirm.code });
    const removed = await removeEmail(ctx2, { password: "o-parolă-cu-totul-nouă" });
    expect(removed.username).toBe(acc.username);
    expect(removed.recoveryCodes).toHaveLength(10);
    expect(removed.recoveryCodes).not.toContain(acc.recoveryCodes[1]);
    const [back] = await t.db.select().from(accounts).where(eq(accounts.id, acc.accountId));
    expect(back).toMatchObject({ kind: "anonymous", email: null });
    expect((await signInAnonymous(anon(later), { username: acc.username, password: "o-parolă-cu-totul-nouă" })).accountId).toBe(acc.accountId);
  });
});

describe("sessions (S3, SEC3, SEC12)", () => {
  it("expires 30 days after sign-in even when used every day", async () => {
    const res = await signInByCode("thirty@example.ro");
    expect(res.expiresAt.toISOString()).toBe(plus(30 * DAY).toISOString());
    for (let d = 1; d <= 29; d++) expect(await resolveSession(anon(plus(d * DAY)), res.token)).not.toBeNull();
    expect(await resolveSession(anon(plus(30 * DAY - 1000)), res.token)).not.toBeNull();
    expect(await resolveSession(anon(plus(30 * DAY + 1000)), res.token)).toBeNull();
  });

  it("expires after 14 idle days", async () => {
    const res = await signInByCode("idle@example.ro");
    expect(await resolveSession(anon(plus(13 * DAY)), res.token)).not.toBeNull(); // seen on day 13
    expect(await resolveSession(anon(plus(26.9 * DAY)), res.token)).not.toBeNull(); // 13.9 days later
    const res2 = await signInByCode("idle2@example.ro");
    expect(await resolveSession(anon(plus(14 * DAY + 1000)), res2.token)).toBeNull();
  });

  it("updates lastSeenAt at most once per five minutes", async () => {
    const res = await signInByCode("seen@example.ro");
    const seen = async () => (await t.db.select().from(sessions).where(eq(sessions.tokenHash, hashToken(res.token))))[0]!.lastSeenAt.toISOString();
    await resolveSession(anon(plus(4 * MIN)), res.token);
    expect(await seen()).toBe(T0.toISOString());
    await resolveSession(anon(plus(6 * MIN)), res.token);
    expect(await seen()).toBe(plus(6 * MIN).toISOString());
    expect(await resolveSession(anon(), "")).toBeNull();
    expect(await resolveSession(anon(), "not-a-real-token-not-a-real-token")).toBeNull();
  });

  it("lists active sessions with device and last seen, and signs out everywhere incl. hooks (MCP tokens)", async () => {
    const a = await signInByCode("everywhere@example.ro");
    const b = await signInByCode("everywhere@example.ro", plus(MIN));
    const other = await signInByCode("bystander@example.ro");
    const sa = (await resolveSession(anon(plus(2 * MIN)), a.token))!;
    const ctx = sessionCtx(a.accountId, sa.id, plus(2 * MIN));
    const list = await listSessions(ctx);
    expect(list).toHaveLength(2);
    expect(list.find((s) => s.current)?.id).toBe(sa.id);
    expect(list[0]).toMatchObject({ deviceType: "phone", userAgent: "Chrome · Android" });

    const revokedFor: string[] = [];
    onSignOutEverywhere(async (hookCtx, accountId) => {
      if (accountId !== a.accountId) return;
      expect(hookCtx.now.toISOString()).toBe(plus(2 * MIN).toISOString());
      revokedFor.push(accountId);
    });
    expect(await signOutEverywhere(ctx)).toBe(2);
    expect(revokedFor).toEqual([a.accountId]);
    expect(await resolveSession(anon(plus(3 * MIN)), a.token)).toBeNull();
    expect(await resolveSession(anon(plus(3 * MIN)), b.token)).toBeNull();
    expect(await resolveSession(anon(plus(3 * MIN)), other.token)).not.toBeNull();
  });

  it("a failing hook rolls the whole sign-out back", async () => {
    const a = await signInByCode("hookfail@example.ro");
    const boom = async (_: Ctx, accountId: string) => {
      if (accountId === a.accountId) throw new Error("mcp down");
    };
    onSignOutEverywhere(boom);
    await expect(signOutEverywhere(accountCtx(t.db, a.accountId, { now: T0 }))).rejects.toThrow("mcp down");
    expect(await resolveSession(anon(), a.token)).not.toBeNull();
  });

  it("changing the login email ends every session and runs the hooks", async () => {
    const a = await signInByCode("old-login@example.ro");
    const b = await signInByCode("old-login@example.ro", plus(MIN));
    await signInByCode("taken@example.ro");
    const sa = (await resolveSession(anon(plus(2 * MIN)), a.token))!;
    const ctx = sessionCtx(a.accountId, sa.id, plus(2 * MIN));
    const called: string[] = [];
    onSignOutEverywhere(async (_c, id) => void (id === a.accountId && called.push(id)));

    // sign-in by code is a fresh proof for ten minutes
    await requireFreshAuth(ctx);
    // an address that belongs to someone else: same answer at request time, refused at confirm
    await requestNewEmailCode(ctx, { email: "taken@example.ro" });
    const takenMail = await lastMail("taken@example.ro");
    expect((await fail(confirmNewEmail(ctx, { email: "taken@example.ro", code: takenMail.code }))).messageKey).toBe("account.errors.emailUnavailable");
    expect(called).toEqual([]);

    await requestNewEmailCode(ctx, { email: "new-login@example.ro" });
    const { code } = await lastMail("new-login@example.ro");
    expect((await fail(confirmNewEmail(ctx, { email: "new-login@example.ro", code: code === "111111" ? "222222" : "111111" }))).messageKey).toBe("auth.errors.codeInvalid");
    const fresh = await confirmNewEmail(ctx, { email: "new-login@example.ro", code });
    expect(called).toEqual([a.accountId]);
    expect(await resolveSession(anon(plus(3 * MIN)), a.token)).toBeNull();
    expect(await resolveSession(anon(plus(3 * MIN)), b.token)).toBeNull();
    expect((await resolveSession(anon(plus(3 * MIN)), fresh.token))?.accountId).toBe(a.accountId);
    expect(await t.db.select().from(accounts).where(eq(accounts.email, "old-login@example.ro"))).toHaveLength(0);
  });
});

describe("fresh auth by emailed code (S4)", () => {
  it("lasts ten minutes on the session that confirmed", async () => {
    const a = await signInByCode("fresh@example.ro");
    const s = (await resolveSession(anon(), a.token))!;
    const later = plus(60 * MIN);
    const ctx = sessionCtx(a.accountId, s.id, later);
    expect(await isFreshAuth(ctx)).toBe(false);
    await requestFreshAuthCode(ctx);
    const m = await lastMail("fresh@example.ro");
    expect(m.row.template).toBe("auth.confirm");
    expect(m.linkToken).toBeUndefined();
    // a sign-in code is not a confirmation code and vice versa
    expect((await fail(verifySignInCode(anon(later), { email: "fresh@example.ro", code: m.code }))).messageKey).toBe("auth.errors.codeInvalid");
    await confirmFreshAuth(ctx, { code: m.code });
    expect(await isFreshAuth(sessionCtx(a.accountId, s.id, plus(69 * MIN)))).toBe(true);
    expect(await isFreshAuth(sessionCtx(a.accountId, s.id, plus(71 * MIN)))).toBe(false);
    // another session of the same account is not fresh
    const other = await createSession(accountCtx(t.db, a.accountId, { now: later }), { accountId: a.accountId });
    expect(await isFreshAuth(sessionCtx(a.accountId, other.sessionId, later))).toBe(false);
  });
});

describe("opt-in two-step (S2)", () => {
  it("is off by default and sign-in never asks for it", async () => {
    const a = await signInByCode("plain@example.ro");
    expect(a.secondFactorRequired).toBe(false);
    const s = (await resolveSession(anon(), a.token))!;
    expect(await getTwoStepStatus(sessionCtx(a.accountId, s.id, T0))).toMatchObject({ totpEnabled: false, recoveryCodesLeft: 0 });
  });

  it("enabling needs a fresh code, shows ten recovery codes once, then sign-in asks for the app code after the email code", async () => {
    const email = "twostep@example.ro";
    const a = await signInByCode(email);
    const s = (await resolveSession(anon(), a.token))!;
    const stale = sessionCtx(a.accountId, s.id, plus(60 * MIN));
    expect((await fail(beginTotpEnrolment(stale))).messageKey).toBe("account.errors.freshAuthRequired");

    const ctx = sessionCtx(a.accountId, s.id, T0);
    const enrol = await beginTotpEnrolment(ctx);
    expect(enrol.otpauthUri).toMatch(/^otpauth:\/\/totp\/EventDesk:/);
    expect(enrol.qrDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const [stored] = await t.db.select().from(totpSecrets).where(eq(totpSecrets.accountId, a.accountId));
    expect(stored?.secretEnc).not.toContain(enrol.secret);
    expect((await fail(confirmTotpEnrolment(ctx, { code: "000000" === totpCodeAt(enrol.secret, T0) ? "111111" : "000000" }))).messageKey).toBe("auth.errors.totpInvalid");
    const { recoveryCodes: codes } = await confirmTotpEnrolment(ctx, { code: totpCodeAt(enrol.secret, T0) });
    expect(codes).toHaveLength(10);
    expect((await getTwoStepStatus(ctx)).totpEnabled).toBe(true);

    // sign in again: first factor gives a pending session that is NOT signed in
    const t1 = plus(20 * MIN);
    const b = await signInByCode(email, t1);
    expect(b.secondFactorRequired).toBe(true);
    expect(await resolveSession(anon(t1), b.token)).toBeNull();
    expect((await resolveSession(anon(t1), b.token, { allowPending: true }))?.secondFactorPending).toBe(true);
    expect((await fail(verifySecondFactor(anon(t1), { sessionToken: b.token, code: "12345" }))).messageKey).toBe("auth.errors.totpInvalid");
    const done = await verifySecondFactor(anon(t1), { sessionToken: b.token, code: totpCodeAt(enrol.secret, t1) });
    expect(done.accountId).toBe(a.accountId);
    expect(done.expiresAt.toISOString()).toBe(new Date(t1.getTime() + 30 * DAY).toISOString());
    expect((await resolveSession(anon(t1), b.token))?.accountId).toBe(a.accountId);

    // the same app code cannot be replayed; a recovery code works once instead
    const c = await signInByCode(email, new Date(t1.getTime() + 1000));
    expect((await fail(verifySecondFactor(anon(t1), { sessionToken: c.token, code: totpCodeAt(enrol.secret, t1) }))).messageKey).toBe("auth.errors.totpInvalid");
    await verifySecondFactor(anon(t1), { sessionToken: c.token, recoveryCode: codes[0]! });
    const t2 = plus(60 * MIN);
    const d = await signInByCode(email, t2);
    expect((await fail(verifySecondFactor(anon(t2), { sessionToken: d.token, recoveryCode: codes[0]! }))).messageKey).toBe("auth.errors.recoveryCodeInvalid");
    // a pending session expires after 15 minutes
    expect((await fail(verifySecondFactor(anon(new Date(t2.getTime() + 16 * MIN)), { sessionToken: d.token, recoveryCode: codes[1]! }))).code).toBe("UNAUTHENTICATED");

    // disabling needs fresh auth; afterwards sign-in is one step again
    const sb = (await resolveSession(anon(t1), b.token))!;
    await disableTotp(sessionCtx(a.accountId, sb.id, t1));
    expect((await signInByCode(email, plus(120 * MIN))).secondFactorRequired).toBe(false);
    expect(await t.db.select().from(recoveryCodes).where(and(eq(recoveryCodes.accountId, a.accountId)))).toHaveLength(0);
  });
});
