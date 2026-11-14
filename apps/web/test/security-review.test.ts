import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { accountCtx, anonymousCtx, type Ctx } from "@ed/core/context";
import { limitCodeRequest } from "@ed/core/ratelimit";
import type { Db } from "@ed/db";
import { setupTestDb, type TestDb } from "@ed/db/testing";
import { isAppError } from "@ed/shared/errors";
import { hasMessage, translate } from "@ed/i18n/load";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { runAction, type Translator } from "../lib/action-core";
import { clientIpFrom } from "../lib/client-ip";
import { isSameOrigin } from "../lib/csrf";

// Regression tests of the security review of 14 November 2026 (docs/build/12-security-review.md).

const headersOf = (h: Record<string, string>) => (name: string) => h[name.toLowerCase()] ?? null;
const web = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8");

describe("F-01 the client address comes from our ingress, never from the client", () => {
  it("a visitor's own X-Forwarded-For entries are ignored: only the entry our proxy appended counts", () => {
    // what the app sees when the ingress APPENDS the address it saw to whatever the client sent
    const spoofed = (fake: string) => clientIpFrom(headersOf({ "x-forwarded-for": `${fake}, 198.51.100.23` }), {});
    const seen = new Set(["1.1.1.1", "8.8.8.8", "10.0.0.1, 127.0.0.1", "2001:db8::1", "unknown", "", "9.9.9.9,   7.7.7.7"].map(spoofed));
    expect([...seen]).toEqual(["198.51.100.23"]);
    // an ingress that REPLACES the header (the reference Caddy) gives one entry
    expect(clientIpFrom(headersOf({ "x-forwarded-for": "198.51.100.23" }), {})).toBe("198.51.100.23");
  });

  it("an empty TRUSTED_IP_HEADER (as in .env.example) means the default — it never throws", () => {
    const strict = (name: string) => new Headers({ "x-forwarded-for": "198.51.100.23" }).get(name); // throws on an invalid name
    for (const value of ["", "   ", undefined, "not a header!", "x-forwarded-for"]) {
      expect(clientIpFrom(strict, { TRUSTED_IP_HEADER: value })).toBe("198.51.100.23");
    }
  });

  it("two of our own proxies: TRUSTED_PROXY_HOPS=2 reads the entry before the last", () => {
    const h = headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.5" });
    expect(clientIpFrom(h, { TRUSTED_PROXY_HOPS: "2" })).toBe("203.0.113.9");
    expect(clientIpFrom(h, {})).toBe("10.0.0.5");
    expect(clientIpFrom(h, { TRUSTED_PROXY_HOPS: "0" })).toBe("10.0.0.5");
    expect(clientIpFrom(h, { TRUSTED_PROXY_HOPS: "abc" })).toBe("10.0.0.5");
    // fewer entries than hops: the outermost one we have, never something invented
    expect(clientIpFrom(headersOf({ "x-forwarded-for": "203.0.113.9" }), { TRUSTED_PROXY_HOPS: "3" })).toBe("203.0.113.9");
  });

  it("a vendor header is used when configured; ports and brackets are stripped; junk is no address", () => {
    const h = headersOf({ "cf-connecting-ip": "203.0.113.50", "x-forwarded-for": "6.6.6.6" });
    expect(clientIpFrom(h, { TRUSTED_IP_HEADER: "CF-Connecting-IP" })).toBe("203.0.113.50");
    expect(clientIpFrom(headersOf({ "x-forwarded-for": "203.0.113.7:51234" }), {})).toBe("203.0.113.7");
    expect(clientIpFrom(headersOf({ "x-forwarded-for": "[2001:DB8::1]:443" }), {})).toBe("2001:db8::1");
    for (const junk of ["", "unknown", "<script>", "999.1.1.1", "a".repeat(300), "1.2.3.4 OR 1=1"]) {
      expect(clientIpFrom(headersOf({ "x-forwarded-for": junk }), {})).toBeUndefined();
    }
    expect(clientIpFrom(headersOf({}), {})).toBeUndefined();
  });

  describe("against the real rate limiter", () => {
    let t: TestDb;
    beforeAll(async () => {
      t = await setupTestDb();
    });
    afterAll(async () => {
      await t.close();
    });

    it("a visitor who sends a new X-Forwarded-For with every request still hits the per-IP sign-in limit", async () => {
      const now = new Date("2026-11-14T09:00:10.000Z");
      const request = (i: number) => {
        // the ingress appended the real address (198.51.100.77) to whatever the client claimed
        const ip = clientIpFrom(headersOf({ "x-forwarded-for": `10.9.${i}.${i}, 198.51.100.77` }), {});
        return limitCodeRequest(anonymousCtx(t.db, { now, ip }), { email: `spoof${i}@example.ro`, deviceId: `spoof-device-${i}` });
      };
      for (let i = 0; i < 10; i++) await request(i); // the default: 10 code requests per IP per hour
      const blocked = await request(10).catch((e) => e);
      expect(isAppError(blocked) && blocked.code).toBe("RATE_LIMITED");
      // someone else, behind the same ingress, is not affected
      const other = clientIpFrom(headersOf({ "x-forwarded-for": "198.51.100.78" }), {});
      await limitCodeRequest(anonymousCtx(t.db, { now, ip: other }), { email: "other@example.ro", deviceId: "other-device" });
    });
  });

  it("no request helper parses the forwarded header on its own any more", () => {
    for (const file of ["lib/ctx.ts", "lib/guest.ts", "lib/supplier-link.ts", "app/e/_lib/public.ts", "app/mcp/route.ts"]) {
      const src = web(file);
      expect(src, file).toContain("clientIpFrom(");
      expect(src, file).not.toMatch(/split\(","\)\[0\]/);
      expect(src, file).not.toMatch(/process\.env\.TRUSTED_IP_HEADER/);
    }
  });
});

describe("F-02 the guest-list upload is refused before it is read", () => {
  it("the route checks who may import before it reads or parses the body", () => {
    const src = web("app/(app)/occasions/[id]/guests/import/upload/route.ts");
    const check = src.indexOf("await requireMember(ctx, id, { manage: true })");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(src.indexOf("request.formData()"));
    expect(check).toBeLessThan(src.indexOf("parseGuestFile("));
    expect(src.indexOf("sameOriginOr403(request)")).toBeLessThan(check);
  });
});

describe("F-03 unexpected errors are logged without the values involved", () => {
  const tr: Translator = { t: (key, params) => translate("ro", key, params), has: (key) => hasMessage("ro", key) };

  it("the default action log line carries the SQL and the call sites, not the parameters", async () => {
    const original = console.error;
    const lines: string[] = [];
    console.error = (...args: unknown[]) => void lines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    try {
      const failing = Object.assign(new Error('Failed query: insert into "households" ("name") values ($1)\nparams: Familia Popescu, ana@example.ro'), {
        query: 'insert into "households" ("name") values ($1)',
        params: ["Familia Popescu", "ana@example.ro"],
      });
      const res = await runAction({
        schema: z.object({}),
        handler: async () => {
          throw failing;
        },
        rawInput: {},
        getCtx: async (): Promise<Ctx> => accountCtx({} as Db, "acc_1"),
        translator: tr,
      });
      expect(res).toMatchObject({ ok: false, error: { code: "UNEXPECTED" } });
      expect(JSON.stringify(res)).not.toMatch(/Popescu|households|query/); // nothing internal reaches the browser
    } finally {
      console.error = original;
    }
    const logged = lines.join("\n");
    expect(logged).toMatch(/\[action\] unexpected error ref=[a-z0-9]+/);
    expect(logged).toContain('insert into "households"');
    expect(logged).not.toMatch(/Popescu|ana@example\.ro|params/);
  });

  it("no server log call prints a raw error object or message", () => {
    const files = [
      "lib/session.ts",
      "lib/action-core.ts",
      "app/api/webhooks/stripe/route.ts",
      "app/api/webhooks/invoicing/route.ts",
      "app/api/auth/link/[token]/route.ts",
      "app/(app)/occasions/[id]/guests/export/route.ts",
      "app/(app)/occasions/[id]/guests/import/upload/route.ts",
    ];
    for (const file of files) {
      for (const line of web(file).split("\n").filter((l) => l.includes("console.error("))) {
        expect(line, file).toMatch(/describeError\(/);
        expect(line, file).not.toMatch(/\.message/);
      }
    }
  });
});

describe("F-06 webhooks: secret before body, size before read", () => {
  it("the invoicing webhook verifies the secret before reading the body; both webhooks check the declared length first", () => {
    const invoicing = web("app/api/webhooks/invoicing/route.ts");
    expect(invoicing.indexOf("verifyInvoicingWebhookSecret(secret)")).toBeGreaterThan(0);
    expect(invoicing.indexOf("verifyInvoicingWebhookSecret(secret)")).toBeLessThan(invoicing.indexOf("request.text()"));
    expect(invoicing.indexOf('get("content-length")')).toBeLessThan(invoicing.indexOf("request.text()"));
    const stripe = web("app/api/webhooks/stripe/route.ts");
    expect(stripe.indexOf('get("content-length")')).toBeGreaterThan(0);
    expect(stripe.indexOf('get("content-length")')).toBeLessThan(stripe.indexOf("request.text()"));
  });
});

describe("V-07 CSRF check of cookie-authenticated route handlers", () => {
  const env = { APP_URL: "https://app.eventdesk.test" };
  const post = (headers: Record<string, string>) => new Request("https://app.eventdesk.test/api/uploads", { method: "POST", headers });

  it("accepts the app's own pages and refuses other origins, 'null' and requests with no origin proof", () => {
    expect(isSameOrigin(post({ origin: "https://app.eventdesk.test" }), env)).toBe(true);
    expect(isSameOrigin(post({ "sec-fetch-site": "same-origin" }), env)).toBe(true);
    for (const h of [
      { origin: "https://evil.example" },
      { origin: "null" },
      { origin: "https://app.eventdesk.test.evil.example" },
      { origin: "https://eventdesk.test" },
      { origin: "http://app.eventdesk.test" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "cross-site" },
      {},
    ] as Array<Record<string, string>>) {
      expect(isSameOrigin(post(h), env), JSON.stringify(h)).toBe(false);
    }
  });

  it("every state-changing route handler that relies on the session cookie starts with the check", () => {
    for (const file of [
      "app/api/uploads/route.ts",
      "app/api/occasions/[id]/offline/route.ts",
      "app/(app)/occasions/[id]/guests/import/upload/route.ts",
      "app/(app)/business/[businessId]/enquiries/[enquiryId]/reply/route.ts",
      "app/console/audit/export/route.ts",
    ]) {
      const src = web(file);
      const post = src.indexOf("export async function POST");
      expect(post, file).toBeGreaterThan(0);
      const body = src.slice(post);
      const check = body.search(/sameOriginOr403\(request\)|assertSameOrigin\(request\)/);
      expect(check, file).toBeGreaterThan(0);
      for (const reader of ["request.formData()", "request.text()", "request.json()", "getCtx()", "requireConsole()"]) {
        const at = body.indexOf(reader);
        if (at >= 0) expect(check, `${file}: ${reader}`).toBeLessThan(at);
      }
    }
  });
});
