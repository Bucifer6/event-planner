#!/usr/bin/env node
// End-to-end smoke of the web app over HTTP (CI step "smoke"; also the last check before a
// release is tagged). Loopback only, dependency-free (Node 22 fetch).
//
//   node scripts/smoke.mjs                         boots the built app (needs DATABASE_URL)
//   node scripts/smoke.mjs --url http://127.0.0.1:3000
//
// The journey of somebody who is NOT signed in — everything private must stay shut:
//   1. /api/health answers ok
//   2. the sign-in page renders, in Romanian
//   3. the in-app directory opens
//   4. an unknown guest link gets the plain "not valid" page, not an error
//   5. /console does not open (not found, or a redirect to sign-in): no console content
//   6. /mcp without a bearer token answers 401 with a JSON-RPC error
//   7. state-changing routes refuse a request without / with a foreign Origin (403), and the
//      deploy-record endpoint refuses a request without its machine token (401)
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, repoRoot, reporter, withWebApp } from "./lib/boot-web.mjs";

const args = parseArgs();
const messages = (ns) => JSON.parse(readFileSync(join(repoRoot, "packages/i18n/messages/ro", `${ns}.json`), "utf8"));
/** Text as it appears in rendered HTML (React escapes these). */
const escaped = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
const has = (html, text) => html.includes(text) || html.includes(escaped(text));
const noLeak = (html) => !/\bat .+\(.+:\d+:\d+\)|node_modules\/|Error: /.test(html.replace(/<script\b[\s\S]*?<\/script>/gi, ""));

const app = await withWebApp({ url: args.url });
const r = reporter("smoke");
const get = (path, init = {}) => fetch(`${app.base}${path}`, { redirect: "manual", ...init });
let code = 1;
try {
  console.info("\n1. health");
  const health = await get("/api/health");
  const healthBody = await health.json().catch(() => null);
  r.check(health.status === 200 && healthBody?.ok === true, "GET /api/health → 200 { ok: true }", `HTTP ${health.status}`);

  console.info("\n2. sign-in page");
  const signIn = await get("/sign-in", { headers: { Accept: "text/html" } });
  const signInHtml = await signIn.text();
  const auth = messages("auth");
  r.check(signIn.status === 200, "GET /sign-in → 200", `HTTP ${signIn.status}`);
  r.check(/<html[^>]*\blang="ro"/.test(signInHtml), 'the page is <html lang="ro">');
  r.check(has(signInHtml, auth.signIn.title) && has(signInHtml, auth.signIn.emailLabel), "the Romanian sign-in text is on the page");
  r.check(noLeak(signInHtml), "no stack trace or internal path in the page");

  console.info("\n3. directory");
  const directory = await get("/directory", { headers: { Accept: "text/html" }, redirect: "follow" });
  const directoryHtml = await directory.text();
  r.check(directory.status === 200, "GET /directory → 200", `HTTP ${directory.status}`);
  r.check(/<html[^>]*\blang="ro"/.test(directoryHtml) && noLeak(directoryHtml), "renders in Romanian without an error");

  console.info("\n4. unknown guest link");
  const guest = await get(`/g/${randomBytes(24).toString("base64url")}`, { headers: { Accept: "text/html" } });
  const guestHtml = await guest.text();
  // 404, or 200 when the not-found page is streamed after the loading shell: the CONTENT decides
  r.check(guest.status === 404 || guest.status === 200, "GET /g/<unknown token> → the not-found page", `HTTP ${guest.status}`);
  r.check(has(guestHtml, messages("rsvp").gone.title), "shows the plain \"link no longer valid\" message");
  r.check(noLeak(guestHtml), "no stack trace or internal path in the page");

  console.info("\n5. console, signed out");
  const consoleRes = await get("/console", { headers: { Accept: "text/html" } });
  const consoleHtml = await consoleRes.text();
  const location = consoleRes.headers.get("location") ?? "";
  // Someone who is not on the staff gets "not found" (the console does not admit it exists)
  // or is sent to sign-in; either way no console chrome may be rendered.
  const redirected = consoleRes.status >= 300 && consoleRes.status < 400;
  r.check(consoleRes.status === 404 || consoleRes.status === 200 || (redirected && /\/sign-in|\/console\/setup/.test(location)), "GET /console → not found, or a redirect to sign-in", `HTTP ${consoleRes.status} ${location}`);
  r.check(!consoleHtml.includes("ed-console__nav"), "no console navigation is rendered");
  const deploys = await get("/console/deploys", { headers: { Accept: "text/html" } });
  const deploysHtml = await deploys.text();
  r.check(deploys.status < 500 && !deploysHtml.includes("ed-console__nav") && !deploysHtml.includes("GITHUB_APP"), "GET /console/deploys is shut as well", `HTTP ${deploys.status}`);

  console.info("\n6. MCP without a token");
  const mcp = await get("/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  const mcpBody = await mcp.json().catch(() => null);
  r.check(mcp.status === 401, "POST /mcp → 401", `HTTP ${mcp.status}`);
  r.check(mcpBody?.jsonrpc === "2.0" && typeof mcpBody?.error?.code === "number" && !("result" in (mcpBody ?? {})), "the body is a JSON-RPC error");
  r.check(/^Bearer/i.test(mcp.headers.get("www-authenticate") ?? ""), "WWW-Authenticate: Bearer");

  console.info("\n7. state-changing routes");
  const noOrigin = await get("/console/audit/export", { method: "POST", body: new URLSearchParams({ action: "x" }) });
  r.check(noOrigin.status === 403, "POST without Origin → 403", `HTTP ${noOrigin.status}`);
  const foreign = await get("/console/audit/export", { method: "POST", headers: { Origin: "https://evil.example" }, body: new URLSearchParams({ action: "x" }) });
  r.check(foreign.status === 403, "POST with a foreign Origin → 403", `HTTP ${foreign.status}`);
  const exportNoOrigin = await get("/console/compliance/nosuchgrant/export", { method: "POST" });
  r.check(exportNoOrigin.status === 403, "POST data-subject export without Origin → 403", `HTTP ${exportNoOrigin.status}`);
  const record = await get("/api/deploys/record", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deployId: "x", event: "start" }) });
  r.check(record.status === 401, "POST /api/deploys/record without its token → 401", `HTTP ${record.status}`);
  const recordWrong = await get("/api/deploys/record", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${randomBytes(32).toString("hex")}` }, body: JSON.stringify({ deployId: "x", event: "start" }) });
  r.check(recordWrong.status === 401, "POST /api/deploys/record with a wrong token → 401", `HTTP ${recordWrong.status}`);

  code = r.finish();
} catch (e) {
  console.error(`smoke: ${e.message}`);
} finally {
  await app.stop();
}
process.exit(code);
