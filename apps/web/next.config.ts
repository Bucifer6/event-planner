import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const repoRoot = resolve(process.cwd(), "../..");

// Local development reads the repo-root .env (values already in the environment win).
// Staging/production get their env from the platform secret store (SEC13).
const rootEnv = resolve(repoRoot, ".env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

// Keep the i18n import map in step with packages/i18n/messages (new namespaces are automatic).
execFileSync(process.execPath, [resolve(repoRoot, "packages/i18n/scripts/gen-messages.mjs")]);

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
  // SEAM (security agent): the strict nonce-based Content-Security-Policy (SEC5) is set per
  // request in apps/web/proxy.ts, not here.
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  // @ed/* packages are consumed as TypeScript source.
  transpilePackages: [
    "@ed/auth",
    "@ed/core",
    "@ed/db",
    "@ed/email",
    "@ed/i18n",
    "@ed/jobs",
    "@ed/mcp",
    "@ed/shared",
    "@ed/storage",
    "@ed/ui",
  ],
  // Native / Node-only packages that must not be bundled. Add argon2-type natives and sharp
  // here when they arrive.
  serverExternalPackages: ["pg", "drizzle-kit"],
  outputFileTracingRoot: repoRoot,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
