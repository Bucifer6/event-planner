import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Loads the repo-root .env (scripts run with cwd = packages/db). Existing env wins. */
export function loadRootEnv(): void {
  const rootEnv = resolve(process.cwd(), "../../.env");
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  if (!process.env.DATABASE_URL) {
    console.error("Missing environment variable: DATABASE_URL");
    process.exit(1);
  }
}
