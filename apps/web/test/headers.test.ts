import { APP_COOKIES, COOKIE_SET_SIGNATURE } from "@ed/core/cookies";
import { LOCALE_COOKIE, loadMessages, locales } from "@ed/i18n";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSameOrigin, isSameOrigin, sameOriginOr403 } from "../lib/csrf";
import { buildCsp, generateNonce, HSTS_VALUE, isForbiddenOnMediaHost, parseCsp, securityHeaders } from "../lib/security";

// Release gate (SEC5, Q1): the header set and the CSP are asserted here on every CI run.

const NONCE = "dGVzdC1ub25jZS0xMjM0NTY=";

describe("Content-Security-Policy (SEC5)", () => {
  for (const dev of [false, true]) {
    it(`script-src has no 'unsafe-inline' and no third-party origin (${dev ? "dev" : "production"})`, () => {
      const csp = parseCsp(buildCsp({ nonce: NONCE, dev }));
      expect(csp["script-src"]).toContain(`'nonce-${NONCE}'`);
      expect(csp["script-src"]).toContain("'strict-dynamic'");
      expect(csp["script-src"]).not.toContain("'unsafe-inline'");
      expect(csp["script-src-elem"]).toBeUndefined();
      expect(csp["script-src-attr"]).toBeUndefined(); // falls back to script-src: inline handlers blocked
      // no directive names any origin: only keywords, the nonce and data:/blob: for images
      for (const [name, values] of Object.entries(csp)) {
        for (const v of values) {
          expect(v, `${name} ${v}`).toMatch(/^('[a-z0-9+/=_-]+'|data:|blob:)$/i);
          expect(v).not.toMatch(/https?:|\*/);
        }
      }
    });
  }

  it("production policy is strict everywhere", () => {
    const csp = parseCsp(buildCsp({ nonce: NONCE, upgradeInsecure: true }));
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["script-src"]).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    expect(csp["script-src"]).not.toContain("'unsafe-eval'");
    expect(csp["style-src"]).toEqual(["'self'", `'nonce-${NONCE}'`]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(["'self'"]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(csp["upgrade-insecure-requests"]).toEqual([]);
  });

  it("refuses to build a policy without a real nonce", () => {
    expect(() => buildCsp({ nonce: "" })).toThrow();
    expect(() => buildCsp({ nonce: "x'; script-src *" })).toThrow();
    const a = generateNonce();
    expect(a).not.toBe(generateNonce());
    expect(Buffer.from(a, "base64")).toHaveLength(16);
  });
});

describe("security header set", () => {
  it("production: CSP, HSTS, nosniff, same-origin referrer, no framing", () => {
    const h = securityHeaders({ nonce: NONCE, production: true });
    expect(h["Content-Security-Policy"]).toContain(`'nonce-${NONCE}'`);
    expect(h["Strict-Transport-Security"]).toBe(HSTS_VALUE);
    expect(HSTS_VALUE).toMatch(/max-age=(\d+)/);
    expect(Number(/max-age=(\d+)/.exec(HSTS_VALUE)![1])).toBeGreaterThanOrEqual(31536000);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("same-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
  });

  it("no HSTS outside production", () => {
    expect(securityHeaders({ nonce: NONCE, dev: true })["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("proxy.ts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function run(url: string, env: Record<string, string>, headers: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    vi.resetModules();
    const { proxy } = await import("../proxy");
    return proxy(new NextRequest(url, { headers }));
  }

  it("sets the header set on a page and hands Next the nonce through the request CSP", async () => {
    const res = await run("https://app.eventdesk.ro/occasions", {
      NODE_ENV: "production",
      APP_URL: "https://app.eventdesk.ro",
      MEDIA_URL: "https://media.eventdesk.ro",
    }, { host: "app.eventdesk.ro" });
    const csp = res.headers.get("content-security-policy")!;
    const nonce = /'nonce-([^']+)'/.exec(csp)![1]!;
    expect(parseCsp(csp)["script-src"]).not.toContain("'unsafe-inline'");
    expect(parseCsp(csp)["script-src"]).not.toContain("'unsafe-eval'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(res.headers.get("strict-transport-security")).toBe(HSTS_VALUE);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("same-origin");
    // NextResponse.next({ request: { headers } }) exposes the overridden request headers like this
    expect(res.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    // a fresh nonce per request
    const again = await run("https://app.eventdesk.ro/occasions", { NODE_ENV: "production" }, { host: "app.eventdesk.ro" });
    expect(again.headers.get("content-security-policy")).not.toContain(nonce);
  });

  it("the media host serves uploaded files and nothing else (SEC4)", async () => {
    const env = { NODE_ENV: "production", APP_URL: "https://app.eventdesk.ro", MEDIA_URL: "https://media.eventdesk.ro" };
    const page = await run("https://media.eventdesk.ro/occasions", env, { host: "media.eventdesk.ro" });
    expect(page.status).toBe(404);
    const api = await run("https://media.eventdesk.ro/api/health", env, { host: "media.eventdesk.ro" });
    expect(api.status).toBe(404);
    const media = await run("https://media.eventdesk.ro/api/media/abc/file.pdf?e=1&s=x", env, { host: "media.eventdesk.ro" });
    expect(media.status).toBe(200);
    // the media route's own sandbox policy must not be replaced by the page policy
    expect(media.headers.get("content-security-policy")).toBeNull();
    expect(media.headers.get("x-content-type-options")).toBe("nosniff");
    expect(isForbiddenOnMediaHost("localhost:3000", "/x", { APP_URL: "http://localhost:3000", MEDIA_URL: "http://localhost:3000" })).toBe(false);
  });

  it("covers pages and APIs but not build assets or the upload endpoint", async () => {
    const { config } = await import("../proxy");
    const re = new RegExp(`^${config.matcher[0]!.source}$`);
    for (const path of ["/", "/occasions/abc", "/g/token", "/api/health", "/api/media/x/file.pdf", "/offline", "/manifest.webmanifest"]) {
      expect(re.test(path), path).toBe(true);
    }
    for (const path of ["/_next/static/chunks/a.js", "/api/uploads", "/sw.js", "/icons/icon-192.png"]) {
      expect(re.test(path), path).toBe(false);
    }
  });
});

describe("CSRF for route handlers (SEC6)", () => {
  const env = { APP_URL: "https://app.eventdesk.ro" };
  const req = (method: string, headers: Record<string, string>) =>
    new Request("https://app.eventdesk.ro/api/uploads", { method, headers });

  it("accepts same-origin state-changing requests", () => {
    expect(isSameOrigin(req("POST", { origin: "https://app.eventdesk.ro", host: "app.eventdesk.ro" }), env)).toBe(true);
    // preview / localhost: Origin matches the Host the request was sent to
    expect(isSameOrigin(req("POST", { origin: "http://localhost:3000", host: "localhost:3000" }), env)).toBe(true);
    expect(isSameOrigin(req("DELETE", { "sec-fetch-site": "same-origin" }), env)).toBe(true);
    expect(sameOriginOr403(req("POST", { origin: "https://app.eventdesk.ro" }), env)).toBeNull();
  });

  it("refuses cross-site, same-site-but-other-origin, null and header-less requests", () => {
    const bad: Array<Record<string, string>> = [
      { origin: "https://evil.example", host: "app.eventdesk.ro" },
      { origin: "https://media.eventdesk.ro", host: "app.eventdesk.ro" },
      { origin: "https://eventdesk.ro", host: "app.eventdesk.ro" },
      { origin: "http://app.eventdesk.ro.evil.example", host: "app.eventdesk.ro" },
      { origin: "null", host: "app.eventdesk.ro" },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      { "sec-fetch-site": "none" },
      {},
    ];
    for (const headers of bad) {
      expect(isSameOrigin(req("POST", headers), env), JSON.stringify(headers)).toBe(false);
    }
    expect(() => assertSameOrigin(req("POST", { origin: "https://evil.example" }), env)).toThrow(
      expect.objectContaining({ code: "FORBIDDEN", messageKey: "platform.errors.csrf" }),
    );
    expect(sameOriginOr403(req("PUT", {}), env)?.status).toBe(403);
  });

  it("does not interfere with safe methods", () => {
    expect(isSameOrigin(req("GET", {}), env)).toBe(true);
    expect(isSameOrigin(req("HEAD", { origin: "https://evil.example" }), env)).toBe(true);
  });
});

describe("cookie notice (LAU1)", () => {
  it("web, core and i18n agree on exactly three cookies", () => {
    expect(APP_COOKIES.map((c) => c.name)).toEqual(["ed_session", "ed_device", "ed_lang"]);
    expect(APP_COOKIES.find((c) => c.purpose === "language")!.name).toBe(LOCALE_COOKIE);
    expect(COOKIE_SET_SIGNATURE).toBe("v1:ed_device,ed_lang,ed_session");
    for (const locale of locales) {
      const messages = loadMessages(locale) as { cookies: { items: Record<string, string>; noTracking: string } };
      // one description per cookie, and no description without a cookie
      expect(Object.keys(messages.cookies.items).sort()).toEqual(APP_COOKIES.map((c) => c.purpose).sort());
      expect(messages.cookies.noTracking.length).toBeGreaterThan(10);
    }
  });
});
