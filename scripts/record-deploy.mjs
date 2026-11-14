#!/usr/bin/env node
// Reports one step of the deploy pipeline to the console (DEP4, DEP6). Called by
// .github/workflows/deploy.yml after every stage; the console shows it as live progress and
// keeps it as the deploy history.
//
//   node scripts/record-deploy.mjs start
//   node scripts/record-deploy.mjs stage --stage backup [--note "backup stored"]
//   node scripts/record-deploy.mjs succeeded
//   node scripts/record-deploy.mjs failed --stage build --note "image build failed"
//   node scripts/record-deploy.mjs rolled_back --note "health checks failed; back on v1.3.0"
//   node scripts/record-deploy.mjs rollback_blocked --note "migration … cannot be reversed"
//
// Environment (names only; values come from the GitHub environment secrets):
//   DEPLOY_RECORD_URL    https://app.<domain>/api/deploys/record   (or APP_URL, to which the path is added)
//   DEPLOY_RECORD_TOKEN  the machine token the web app also holds (never printed)
//   DEPLOY_ID            the console's id for this deploy (workflow input)
//   DEPLOY_TAG, DEPLOY_COMMIT   sent with "start" so the console can refuse a mismatch
//
// "start" is the gate: if the console did not approve exactly this deploy the script exits 1
// and the workflow stops before touching production. Every other event is retried and, if
// the console stays unreachable (it may be mid-restart), ends with a warning and exit 0 —
// a missing progress line must not fail a healthy deploy. Notes are short fixed phrases:
// never pass command output (it could hold secrets).
import { appendFileSync } from "node:fs";

const EVENTS = ["start", "stage", "succeeded", "failed", "rolled_back", "rollback_blocked"];
const [event, ...rest] = process.argv.slice(2);
const opts = {};
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) opts[rest[i].slice(2)] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : "true";
}

function die(message) {
  console.error(`record-deploy: ${message}`);
  process.exit(1);
}

if (!EVENTS.includes(event)) die(`unknown event "${event ?? ""}". Use one of: ${EVENTS.join(", ")}`);
const base = process.env.DEPLOY_RECORD_URL || (process.env.APP_URL ? `${process.env.APP_URL.replace(/\/+$/, "")}/api/deploys/record` : "");
const token = process.env.DEPLOY_RECORD_TOKEN;
const deployId = process.env.DEPLOY_ID;
const strict = event === "start";
const missing = [!base && "DEPLOY_RECORD_URL (or APP_URL)", !token && "DEPLOY_RECORD_TOKEN", !deployId && "DEPLOY_ID"].filter(Boolean);
if (missing.length > 0) die(`missing environment variables: ${missing.join(", ")}`);
if (event === "stage" && !opts.stage) die('"stage" needs --stage <name>');
if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(base)) die("the record URL must be https");

const body = {
  deployId,
  event,
  ...(opts.stage ? { stage: opts.stage } : {}),
  ...(opts.note ? { note: String(opts.note).replace(/\s+/g, " ").slice(0, 500) } : {}),
  ...(event === "start" ? { tag: process.env.DEPLOY_TAG, ...(process.env.DEPLOY_COMMIT ? { commitHash: process.env.DEPLOY_COMMIT } : {}) } : {}),
};

// final events matter most: keep trying for ~3 minutes; progress lines for ~1 minute
const attempts = strict ? 6 : event === "stage" ? 6 : 18;
let last = "";
for (let attempt = 1; attempt <= attempts; attempt++) {
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": "eventdesk-deploy" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok) {
      const d = json.deploy ?? {};
      console.info(`record-deploy: ${event}${opts.stage ? ` (${opts.stage})` : ""} recorded — deploy ${d.id} is ${d.state}`);
      if (event === "start" && process.env.GITHUB_OUTPUT) {
        appendFileSync(process.env.GITHUB_OUTPUT, `previous_tag=${d.previousTag ?? ""}\nkind=${d.kind ?? ""}\n`);
      }
      process.exit(0);
    }
    last = `HTTP ${res.status}${json?.error?.code ? ` ${json.error.code}` : ""}${json?.error?.key ? ` (${json.error.key})` : ""}`;
    // the console answered and said no: retrying will not change it
    if (res.status >= 400 && res.status < 500) break;
  } catch (e) {
    last = e.cause?.code ?? e.name ?? "network error";
  }
  if (attempt < attempts) await new Promise((r) => setTimeout(r, 10_000));
}

if (strict) die(`the console refused or could not confirm this deploy (${last}). Nothing was changed.`);
console.warn(`::warning::record-deploy: "${event}" could not be recorded (${last}). The deploy history may be incomplete.`);
process.exit(0);
