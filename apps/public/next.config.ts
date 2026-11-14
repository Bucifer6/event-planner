import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const repoRoot = resolve(process.cwd(), "../..");

// Keep the i18n import map in step with packages/i18n/messages (new namespaces are automatic).
execFileSync(process.execPath, [resolve(repoRoot, "packages/i18n/scripts/gen-messages.mjs")]);

// eventdesk.ro — a fully static site (D1): no cookies, no third-party scripts, no external
// origins. `pnpm check:public-d1` verifies the built output in apps/public/out.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: false,
  images: { unoptimized: true },
  transpilePackages: ["@ed/i18n", "@ed/shared", "@ed/ui"],
  outputFileTracingRoot: repoRoot,
  // One styled, bilingual 404.html for the whole static site (app/global-not-found.tsx).
  experimental: { globalNotFound: true },
};

export default createNextIntlPlugin("./i18n/request.ts")(nextConfig);
