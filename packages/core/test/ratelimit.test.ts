import { rateLimitBuckets, securityLog } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { hashToken, isAppError, type AppError } from "@ed/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { anonymousCtx } from "../src/context";
import {
  backoffExtraMs,
  checkPublicForm,
  enforceRateLimit,
  issueFormStamp,
  limitCodeEntry,
  limitCodeRequest,
} from "../src/ratelimit";

let t: TestDb;
beforeAll(async () => {
  t = await setupTestDb();
});
afterAll(async () => {
  await t.close();
});

const T0 = new Date("2026-03-02T10:00:30.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

async function caught(p: Promise<unknown>): Promise<AppError> {
  try {
    await p;
  } catch (e) {
    if (isAppError(e)) return e;
    throw e;
  }
  throw new Error("expected RATE_LIMITED");
}

function expectGeneric(e: AppError, after: Date) {
  expect(e.code).toBe("RATE_LIMITED");
  expect(e.messageKey).toBe("common.errors.RATE_LIMITED");
  expect(Object.keys(e.details ?? {})).toEqual(["retryAt"]);
  expect(new Date(e.details!.retryAt!).getTime()).toBeGreaterThan(after.getTime());
}

describe("sign-in code requests (SEC16)", () => {
  it("email axis: 4th request in the hour trips, other addresses are untouched", async () => {
    let n = 0;
    const ctx = () => anonymousCtx(t.db, { now: T0, ip: `10.1.0.${++n}` });
    for (let i = 0; i < 3; i++) await limitCodeRequest(ctx(), { email: "Ana@Example.ro", deviceId: `d${n}` });
    const e = await caught(limitCodeRequest(ctx(), { email: "ana@example.ro", deviceId: "dx" }));
    expectGeneric(e, T0);
    expect(new Date(e.details!.retryAt!).toISOString()).toBe("2026-03-02T11:00:00.000Z");
    await limitCodeRequest(ctx(), { email: "other@example.ro", deviceId: "dy" });
  });

  it("IP axis: 11th request in the hour trips whatever the address", async () => {
    const ctx = anonymousCtx(t.db, { now: T0, ip: "10.2.0.1" });
    for (let i = 0; i < 10; i++) await limitCodeRequest(ctx, { email: `ip${i}@example.ro`, deviceId: `ipd${i}` });
    expectGeneric(await caught(limitCodeRequest(ctx, { email: "ip-new@example.ro", deviceId: "ipd-new" })), T0);
    // another IP is free
    await limitCodeRequest(anonymousCtx(t.db, { now: T0, ip: "10.2.0.2" }), { email: "ip-new2@example.ro" });
  });

  it("device axis: 11th request from one device cookie trips across IPs and addresses", async () => {
    for (let i = 0; i < 10; i++) {
      await limitCodeRequest(anonymousCtx(t.db, { now: T0, ip: `10.3.0.${i}` }), {
        email: `dev${i}@example.ro`,
        deviceId: "device-A",
      });
    }
    const e = await caught(
      limitCodeRequest(anonymousCtx(t.db, { now: T0, ip: "10.3.1.1" }), { email: "dev-new@example.ro", deviceId: "device-A" }),
    );
    expectGeneric(e, T0);
  });

  it("email axis: at most 10 a day", async () => {
    let n = 0;
    const day = new Date("2026-03-03T00:10:00.000Z");
    for (let h = 0; h < 4; h++) {
      for (let i = 0; i < 3 && n < 10; i++) {
        n++;
        await limitCodeRequest(anonymousCtx(t.db, { now: new Date(day.getTime() + h * 3_600_000), ip: `10.4.${h}.${i}` }), {
          email: "daily@example.ro",
        });
      }
    }
    expect(n).toBe(10);
    const e = await caught(
      limitCodeRequest(anonymousCtx(t.db, { now: new Date(day.getTime() + 5 * 3_600_000), ip: "10.4.9.9" }), { email: "daily@example.ro" }),
    );
    expectGeneric(e, day);
    expect(new Date(e.details!.retryAt!).getTime()).toBeGreaterThanOrEqual(new Date("2026-03-04T00:00:00.000Z").getTime());
  });

  it("escalates the wait for a flooded address only, capped — never a lockout", async () => {
    expect(backoffExtraMs(1)).toBe(0);
    expect(backoffExtraMs(2)).toBe(5 * 60_000);
    expect(backoffExtraMs(3)).toBe(10 * 60_000);
    expect(backoffExtraMs(50)).toBe(60 * 60_000);

    const email = "flood@example.ro";
    let ip = 0;
    const req = (now: Date) => limitCodeRequest(anonymousCtx(t.db, { now, ip: `10.5.${Math.floor(ip / 250)}.${ip++ % 250}` }), { email });
    const start = new Date("2026-03-05T08:00:10.000Z");
    for (let i = 0; i < 3; i++) await req(start);
    const first = await caught(req(start));
    expect(new Date(first.details!.retryAt!).toISOString()).toBe("2026-03-05T09:00:00.000Z");
    // while waiting, more attempts neither count nor stretch the wait
    const again = await caught(req(new Date("2026-03-05T08:30:00.000Z")));
    expect(again.details!.retryAt).toBe(first.details!.retryAt);
    // next hour: allowed again (no lockout) ...
    const second = new Date("2026-03-05T09:00:01.000Z");
    for (let i = 0; i < 3; i++) await req(second);
    // ... and tripping again waits longer than the plain window
    const e2 = await caught(req(second));
    expect(new Date(e2.details!.retryAt!).toISOString()).toBe("2026-03-05T10:05:00.000Z");
    // a different address from the same place is not affected
    await limitCodeRequest(anonymousCtx(t.db, { now: second, ip: "10.5.9.9" }), { email: "calm@example.ro" });
  });
});

describe("code entry (SEC16)", () => {
  it("IP axis: 21st entry in the hour trips; device axis trips independently", async () => {
    const ctx = anonymousCtx(t.db, { now: T0, ip: "10.6.0.1" });
    for (let i = 0; i < 20; i++) await limitCodeEntry(ctx, { deviceId: `e${i}` });
    expectGeneric(await caught(limitCodeEntry(ctx, { deviceId: "e-new" })), T0);

    for (let i = 0; i < 20; i++) await limitCodeEntry(anonymousCtx(t.db, { now: T0, ip: `10.6.1.${i}` }), { deviceId: "entry-dev" });
    expectGeneric(await caught(limitCodeEntry(anonymousCtx(t.db, { now: T0, ip: "10.6.2.1" }), { deviceId: "entry-dev" })), T0);
  });
});

describe("security log and storage", () => {
  it("stores hashed keys only and nothing about account existence", async () => {
    const buckets = await t.db.select().from(rateLimitBuckets);
    const logs = await t.db.select().from(securityLog);
    expect(logs.length).toBeGreaterThan(0);
    const dump = JSON.stringify([buckets, logs]);
    expect(dump).not.toContain("example.ro");
    expect(dump.toLowerCase()).not.toContain("exist");
    expect(dump).not.toContain("accountId");
    expect(buckets.some((b) => b.keyHash === hashToken("ana@example.ro"))).toBe(true);
    expect(logs.every((l) => ["rate_limit.tripped", "rate_limit.blocked"].includes(l.event))).toBe(true);
  });
});

describe("checkPublicForm (SEC11)", () => {
  const now = at(600);
  const ctx = (ip: string) => anonymousCtx(t.db, { now, ip });
  const goodStamp = issueFormStamp(new Date(now.getTime() - 10_000));

  it("passes a human-speed submit with an empty honeypot", async () => {
    await checkPublicForm(ctx("10.7.0.1"), { formKey: "rsvp", linkKey: "link1", honeypot: "", renderedAt: goodStamp });
  });

  it("rejects a filled honeypot with a retry time", async () => {
    expectGeneric(
      await caught(checkPublicForm(ctx("10.7.0.2"), { formKey: "rsvp", honeypot: "http://spam", renderedAt: goodStamp })),
      now,
    );
  });

  it("rejects a submit under the time floor, a missing stamp and a forged stamp", async () => {
    const fast = issueFormStamp(new Date(now.getTime() - 1_000));
    const e = await caught(checkPublicForm(ctx("10.7.0.3"), { formKey: "rsvp", honeypot: "", renderedAt: fast }));
    expectGeneric(e, now);
    expect(new Date(e.details!.retryAt!).getTime()).toBe(now.getTime() + 2_000);
    expectGeneric(await caught(checkPublicForm(ctx("10.7.0.3"), { formKey: "rsvp", honeypot: "", renderedAt: undefined })), now);
    const forged = `${now.getTime() - 60_000}.AAAA`;
    expectGeneric(await caught(checkPublicForm(ctx("10.7.0.3"), { formKey: "rsvp", honeypot: "", renderedAt: forged })), now);
  });

  it("limits per IP and per link independently", async () => {
    for (let i = 0; i < 3; i++) {
      await checkPublicForm(ctx("10.7.1.1"), { formKey: "enquiry", linkKey: `l${i}`, honeypot: "", renderedAt: goodStamp, perIpPerHour: 3 });
    }
    expectGeneric(
      await caught(checkPublicForm(ctx("10.7.1.1"), { formKey: "enquiry", linkKey: "l9", honeypot: "", renderedAt: goodStamp, perIpPerHour: 3 })),
      now,
    );
    for (let i = 0; i < 2; i++) {
      await checkPublicForm(ctx(`10.7.2.${i}`), { formKey: "claim", linkKey: "same", honeypot: "", renderedAt: goodStamp, perLinkPerHour: 2 });
    }
    expectGeneric(
      await caught(checkPublicForm(ctx("10.7.2.9"), { formKey: "claim", linkKey: "same", honeypot: "", renderedAt: goodStamp, perLinkPerHour: 2 })),
      now,
    );
  });

  it("enforceRateLimit skips rules without a key", async () => {
    await enforceRateLimit(anonymousCtx(t.db, { now }), { scope: "x", rules: [{ axis: "ip", key: undefined, limit: 0, windowSeconds: 60 }] });
  });
});
