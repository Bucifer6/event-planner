#!/usr/bin/env node
// Release gate for the security headers of the web app (SEC5, R0-09; CI step "headers").
//
//   node scripts/check-headers.mjs                 boots the built app (needs DATABASE_URL)
//   node scripts/check-headers.mjs --url http://127.0.0.1:3000 [--no-hsts]
//
// Asserts, on real responses of several routes:
//   - Content-Security-Policy: script-src carries a per-request nonce + 'strict-dynamic', and
//     has no 'unsafe-inline', no 'unsafe-eval' and no third-party origin; style-src has no
//     'unsafe-inline'; object-src/base-uri/frame-ancestors are 'none'
//   - every <script> tag in the HTML carries the nonce (nothing inline can run without it)
//   - Strict-Transport-Security in production mode, X-Content-Type-Options: nosniff,
//     Referrer-Policy: same-origin, X-Frame-Options: DENY, no X-Powered-By
//   - /api/health answers { ok: true } and is not cacheable
// Dependency-free (Node 22 fetch). Loopback only.
import { parseArgs, reporter, withWebApp } from "./lib/boot-web.mjs";

const args = parseArgs();
const PAGES = ["/sign-in", "/directory", "/no-such-page-for-header-check"];

function parseCsp(value) {
  const out = {};
  for (const part of String(value ?? "").split(";")) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = values;
  }
  return out;
}

const app = await withWebApp({ url: args.url });
const r = reporter("check-headers");
const expectHsts = args["no-hsts"] ? false : app.production !== false;
let code = 1;
try {
  const nonces = [];
  for (const path of PAGES) {
    console.info(`\n${path}`);
    const res = await fetch(`${app.base}${path}`, { redirect: "manual", headers: { Accept: "text/html" } });
    const h = res.headers;
    const html = await res.text();
    r.check(res.status < 500, "responds without a server error", `HTTP ${res.status}`);

    const csp = parseCsp(h.get("content-security-policy"));
    const script = csp["script-src"] ?? [];
    const nonce = script.find((v) => /^'nonce-[A-Za-z0-9+/=_-]{16,}'$/.test(v));
    r.check(Boolean(h.get("content-security-policy")), "Content-Security-Policy is present");
    r.check(Boolean(nonce), "script-src has a nonce");
    r.check(script.includes("'strict-dynamic'"), "script-src has 'strict-dynamic'");
    r.check(!script.includes("'unsafe-inline'"), "script-src has no 'unsafe-inline'");
    r.check(!script.includes("'unsafe-eval'"), "script-src has no 'unsafe-eval'");
    r.check(!script.some((v) => /^(https?:|\*|data:|blob:)/i.test(v)), "script-src names no other origin", script.join(" "));
    r.check(!(csp["style-src"] ?? []).includes("'unsafe-inline'"), "style-src has no 'unsafe-inline'");
    r.check((csp["default-src"] ?? []).join(" ") === "'self'", "default-src is 'self'");
    for (const d of ["object-src", "base-uri", "frame-ancestors"]) {
      r.check((csp[d] ?? []).join(" ") === "'none'", `${d} is 'none'`);
    }
    if (nonce) nonces.push(nonce);

    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    const bare = scripts.filter((tag) => !/\bnonce="[^"]+"/i.test(tag));
    r.check(bare.length === 0, `every <script> tag carries the nonce (${scripts.length} tags)`, bare.slice(0, 2).join(" "));
    r.check(!/\son[a-z]+\s*=\s*["']/i.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, "")), "no inline event-handler attributes");

    if (expectHsts) {
      const hsts = h.get("strict-transport-security") ?? "";
      const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
      r.check(maxAge >= 31_536_000 && /includeSubDomains/i.test(hsts), "Strict-Transport-Security (>= 1 year, includeSubDomains)", hsts || "missing");
    }
    r.check(h.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
    r.check(h.get("referrer-policy") === "same-origin", "Referrer-Policy: same-origin", h.get("referrer-policy") ?? "missing");
    r.check(h.get("x-frame-options") === "DENY", "X-Frame-Options: DENY");
    r.check(!h.has("x-powered-by"), "no X-Powered-By");
  }
  console.info("\nnonce");
  r.check(new Set(nonces).size === nonces.length && nonces.length === PAGES.length, "a fresh nonce on every response");

  console.info("\n/api/health");
  const health = await fetch(`${app.base}/api/health`);
  const body = await health.json().catch(() => null);
  r.check(health.status === 200 && body?.ok === true, "answers 200 { ok: true }", `HTTP ${health.status}`);
  r.check(typeof body?.version === "string" && Object.keys(body ?? {}).sort().join(",") === "ok,version", "reports only ok + version");
  r.check(/no-store/.test(health.headers.get("cache-control") ?? ""), "is not cacheable");
  r.check(health.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options: nosniff");
  code = r.finish();
} catch (e) {
  console.error(`check-headers: ${e.message}`);
} finally {
  await app.stop();
}
process.exit(code);
