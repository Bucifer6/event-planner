import { eq, idempotencyKeys, jobRuns, jobs } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountCtx, anonymousCtx, makeCtx, systemCtx } from "../src/context";
import { APP_COOKIES, COOKIE_SET_SIGNATURE, cookieSetSignature } from "../src/cookies";
import { fetchRobotsAllowed, isAllowedByRobots } from "../src/fetching";
import { createIncident, getActiveIncident, listIncidents, resolveIncident } from "../src/incidents";
import { listRetentionRules, registerRetentionRule, runRetention } from "../src/retention";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

describe("retention (INF6)", () => {
  it("purges expired idempotency keys and old jobs, keeps recent ones, logs counts", async () => {
    const now = new Date("2026-06-01T03:30:00Z");
    const old = new Date("2026-05-01T00:00:00Z");
    const recent = new Date("2026-05-31T00:00:00Z");
    await t.db.insert(idempotencyKeys).values([
      { scope: "s", key: "old-1", createdAt: old },
      { scope: "s", key: "old-2", createdAt: old },
      { scope: "s", key: "recent", createdAt: recent },
    ]);
    await t.db.insert(jobs).values([
      { name: "x", runAt: old, doneAt: new Date("2026-04-01T00:00:00Z") },
      { name: "x", runAt: recent, doneAt: recent },
      { name: "x", runAt: recent },
    ]);
    let extra = 0;
    registerRetentionRule({ name: "test-extra", run: async () => ++extra });
    registerRetentionRule({
      name: "test-failing",
      run: async () => {
        throw new Error("boom");
      },
    });
    expect(listRetentionRules()).toEqual(expect.arrayContaining(["idempotency-keys", "jobs-done", "test-extra"]));

    const results = await runRetention(systemCtx(t.db, { now }));
    const by = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(by["idempotency-keys"]!.deleted).toBe(2);
    expect(by["jobs-done"]!.deleted).toBe(1);
    expect(by["test-extra"]!.deleted).toBe(1);
    expect(by["test-failing"]!.error).toBeDefined(); // one failing rule does not stop the rest
    expect((await t.db.select().from(idempotencyKeys)).map((r) => r.key)).toEqual(["recent"]);
    expect(await t.db.select().from(jobs)).toHaveLength(2);
    const [run] = await t.db.select().from(jobRuns).where(eq(jobRuns.name, "retention.purge"));
    expect(run!.status).toBe("failed");
    expect(run!.detail).toMatchObject({ "idempotency-keys": 2, "jobs-done": 1 });

    // repeatable, and system-only
    expect((await runRetention(systemCtx(t.db, { now }))).find((r) => r.name === "idempotency-keys")!.deleted).toBe(0);
    await expect(runRetention(accountCtx(t.db, "acc_1"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("incidents (LAU5)", () => {
  const staff = (now?: Date) =>
    makeCtx(t.db, { kind: "staff", accountId: "acc_s", staffId: "stf_1", roles: ["SecurityAdministrator"] }, { now });

  it("an open incident is visible to anyone in their language until resolved", async () => {
    expect(await getActiveIncident(anonymousCtx(t.db))).toBeNull();
    await expect(createIncident(accountCtx(t.db, "acc_1"), {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    const inc = await createIncident(staff(), {
      messageRo: "Trimiterea emailurilor întârzie. Lucrăm la asta.",
      internalNote: "provider outage #123",
    });
    const ro = await getActiveIncident(anonymousCtx(t.db));
    expect(ro).toMatchObject({ id: inc.id, message: "Trimiterea emailurilor întârzie. Lucrăm la asta." });
    expect(JSON.stringify(ro)).not.toContain("provider outage"); // internal note never leaves
    // no English text: falls back to the Romanian one
    expect((await getActiveIncident(anonymousCtx(t.db, { locale: "en" })))!.message).toContain("emailurilor");

    const resolved = await resolveIncident(staff(new Date("2026-06-01T12:00:00Z")), inc.id);
    expect(resolved.resolvedAt?.toISOString()).toBe("2026-06-01T12:00:00.000Z");
    const again = await resolveIncident(staff(new Date("2026-06-02T12:00:00Z")), inc.id);
    expect(again.resolvedAt?.toISOString()).toBe("2026-06-01T12:00:00.000Z"); // idempotent
    expect(await getActiveIncident(anonymousCtx(t.db))).toBeNull();
    expect(await listIncidents(staff())).toHaveLength(1);
    await expect(listIncidents(accountCtx(t.db, "acc_1"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an incident without a message means 'show the default text'; stack traces are refused", async () => {
    const inc = await createIncident(systemCtx(t.db));
    expect(await getActiveIncident(anonymousCtx(t.db))).toMatchObject({ id: inc.id, message: null });
    await resolveIncident(systemCtx(t.db), inc.id);
    await expect(
      createIncident(staff(), { messageRo: "TypeError: x is undefined\n    at foo (/app/a.js:10:5)" }),
    ).rejects.toThrow();
  });
});

describe("cookie set (LAU1)", () => {
  it("is exactly the three disclosed cookies and its signature follows the set", () => {
    expect(APP_COOKIES.map((c) => c.name)).toEqual(["ed_session", "ed_device", "ed_lang"]);
    expect(APP_COOKIES.map((c) => c.purpose)).toEqual(["session", "rateLimit", "language"]);
    expect(COOKIE_SET_SIGNATURE).toBe("v1:ed_device,ed_lang,ed_session");
    expect(cookieSetSignature(["ed_lang", "ed_session", "ed_device"])).toBe(COOKIE_SET_SIGNATURE);
    expect(cookieSetSignature(["ed_lang", "ed_session"])).not.toBe(COOKIE_SET_SIGNATURE);
  });
});

describe("robots.txt (SEC6)", () => {
  const robots = [
    "User-agent: *",
    "Disallow: /private/",
    "Allow: /private/press/",
    "Disallow: /*.pdf$",
    "",
    "User-agent: EventDeskBot",
    "Disallow: /no-eventdesk/",
    "",
    "User-agent: BadBot",
    "Disallow: /",
  ].join("\n");

  it("applies the most specific group and the longest matching rule", () => {
    const allowed = (path: string, ua = "OtherBot/2.0") => isAllowedByRobots(robots, `https://example.ro${path}`, ua);
    expect(allowed("/")).toBe(true);
    expect(allowed("/private/x")).toBe(false);
    expect(allowed("/private/press/kit")).toBe(true);
    expect(allowed("/files/menu.pdf")).toBe(false);
    expect(allowed("/files/menu.pdf?x=1")).toBe(true);
    // our own group replaces the * group
    expect(allowed("/private/x", "EventDeskBot/1.0")).toBe(true);
    expect(allowed("/no-eventdesk/a", "EventDeskBot/1.0")).toBe(false);
    expect(allowed("/anything", "BadBot")).toBe(false);
    expect(isAllowedByRobots("", "https://example.ro/x", "EventDeskBot/1.0")).toBe(true);
  });

  it("fetches /robots.txt of the same origin with the injected fetcher", async () => {
    const seen: string[] = [];
    const fetcher = (status: number, body = robots) => async (url: string) => {
      seen.push(url);
      return { status, body: Buffer.from(body) };
    };
    expect(await fetchRobotsAllowed("https://example.ro:443/no-eventdesk/a?b=1", "EventDeskBot/1.0", { fetcher: fetcher(200) })).toBe(false);
    expect(seen).toEqual(["https://example.ro/robots.txt"]);
    expect(await fetchRobotsAllowed("https://example.ro/ok", "EventDeskBot/1.0", { fetcher: fetcher(200) })).toBe(true);
    // no robots.txt = allowed; server trouble or rate limiting = not allowed
    expect(await fetchRobotsAllowed("https://example.ro/x", "EventDeskBot/1.0", { fetcher: fetcher(404) })).toBe(true);
    expect(await fetchRobotsAllowed("https://example.ro/x", "EventDeskBot/1.0", { fetcher: fetcher(503) })).toBe(false);
    expect(await fetchRobotsAllowed("https://example.ro/x", "EventDeskBot/1.0", { fetcher: fetcher(429) })).toBe(false);
    const failing = async () => {
      throw new Error("network");
    };
    expect(await fetchRobotsAllowed("https://example.ro/x", "EventDeskBot/1.0", { fetcher: failing })).toBe(false);
    expect(await fetchRobotsAllowed("ftp://example.ro/x")).toBe(false);
    expect(await fetchRobotsAllowed("not a url")).toBe(false);
  });

  it("the default fetcher goes through the SSRF guard: private addresses are never allowed", async () => {
    expect(await fetchRobotsAllowed("http://127.0.0.1/x")).toBe(false);
    expect(await fetchRobotsAllowed("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(await fetchRobotsAllowed("http://10.0.0.5/x")).toBe(false);
  });
});
