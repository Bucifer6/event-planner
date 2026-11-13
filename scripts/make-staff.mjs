#!/usr/bin/env node
// Bootstrap: give an EXISTING account its staff roles (R0-13, W8/W9).
//
//   node scripts/make-staff.mjs <email> <role[,role…]>
//   node scripts/make-staff.mjs ana@example.ro platform_admin,security_administrator
//
// Roles: platform_admin, content_editor, listing_moderator, commercial_manager,
//        privacy_owner, security_administrator
//
// Run it on the server, with DATABASE_URL set (or a repo-root .env). It is the only way to
// create the FIRST staff member, and the way to add the SECOND one while the console is in
// single-operator restricted mode (nobody exists yet to approve a role change). After that,
// role changes are requested in the console (Acces) and approved by a second platform admin.
//
// The grant is written to the audit log as a system action. It does NOT open the console by
// itself: the person must turn on two-step sign-in (TOTP) and sign in again first.

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "tsx/esm/api";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = resolve(root, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const ROLES = [
  "platform_admin",
  "content_editor",
  "listing_moderator",
  "commercial_manager",
  "privacy_owner",
  "security_administrator",
];

function usage(message) {
  if (message) console.error(`\n${message}`);
  console.error(`\nUsage: node scripts/make-staff.mjs <email> <role[,role…]>\nRoles: ${ROLES.join(", ")}\n`);
  process.exit(2);
}

const [email, roleArg] = process.argv.slice(2);
if (!email || !roleArg) usage();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) usage(`"${email}" is not an email address.`);
const roles = [...new Set(roleArg.split(",").map((r) => r.trim()).filter(Boolean))];
const unknown = roles.filter((r) => !ROLES.includes(r));
if (roles.length === 0 || unknown.length > 0) usage(`Unknown role(s): ${unknown.join(", ") || "(none given)"}`);
if (!process.env.DATABASE_URL) usage("DATABASE_URL is not set.");

// The packages are TypeScript source; tsx loads them (the same way the worker runs).
register();
const { closeDb, getDb } = await import(resolve(root, "packages/db/src/index.ts"));
const { systemCtx } = await import(resolve(root, "packages/core/src/context.ts"));
const { grantStaffBootstrap } = await import(resolve(root, "packages/core/src/staff.ts"));

try {
  const result = await grantStaffBootstrap(systemCtx(getDb()), { email, roles });
  console.info(`\nStaff roles set for ${email.toLowerCase()}: ${roles.join(", ")}`);
  console.info(`Active staff members now: ${result.staffCount}`);
  if (result.staffCount < 2) {
    console.info(
      "\nSingle-operator restricted mode: actions that need a second person will queue with no\n" +
        "effect until a second staff member exists. Add one with this script.",
    );
  }
  console.info(
    "\nBefore the console opens, this person must:\n" +
      "  1. sign in and turn on two-step sign-in (TOTP) under Cont → Verificare în doi pași;\n" +
      "  2. sign out and sign in again, with the second step;\n" +
      "  3. open /console.\n" +
      "A staff account without two-step sign-in cannot reach any console page or action.\n",
  );
} catch (e) {
  const code = e && typeof e === "object" && "code" in e ? e.code : null;
  if (code === "NOT_FOUND") {
    console.error(`\nNo account with the email ${email}. The person must sign in once first (that creates the account).\n`);
  } else if (code === "CONFLICT") {
    console.error("\nRefused: the platform must keep at least one active platform_admin.\n");
  } else {
    console.error("\nCould not set the staff roles:", e instanceof Error ? e.message : e, "\n");
  }
  process.exitCode = 1;
} finally {
  await closeDb();
}
