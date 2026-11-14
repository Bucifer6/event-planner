import { z } from "zod";

// Boot-time environment validation (R0-02, SEC13).
// Error output lists variable NAMES only — never a value, not even a truncated one.

const url = z.url();
const optional = <T extends z.ZodType>(t: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), t.optional());

export const bootEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/.+/),
  APP_URL: url,
  PUBLIC_URL: url,
  MEDIA_URL: url,
  SESSION_SECRET: z.string().min(32),
  APP_VERSION: optional(z.string()),
  LOG_LEVEL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["debug", "info", "warn", "error"]).default("info"),
  ),
  EMAIL_PROVIDER: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("dev")),
  EMAIL_FROM: optional(z.string()),
  S3_ENDPOINT: optional(url),
  S3_REGION: optional(z.string()),
  S3_ACCESS_KEY_ID: optional(z.string()),
  S3_SECRET_ACCESS_KEY: optional(z.string()),
  S3_BUCKET_PRIVATE: optional(z.string()),
  S3_BUCKET_MEDIA: optional(z.string()),
});

export type BootEnv = z.infer<typeof bootEnvSchema>;

export class EnvError extends Error {
  /** Names of the missing or invalid variables. */
  readonly names: string[];
  constructor(names: string[]) {
    super(`Invalid or missing environment variables: ${names.join(", ")}`);
    this.name = "EnvError";
    this.names = names;
  }
}

/**
 * Validate any env shape. Throws EnvError naming the offending variables (names only).
 * Packages with their own env (email, storage, …) call this with their own schema.
 */
export function parseEnv<S extends z.ZodObject>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((i) => String(i.path[0] ?? "(root)")))].sort();
  throw new EnvError(names);
}

/**
 * Call once when a process starts (web instrumentation, worker main). The process must not
 * boot with a missing/invalid env.
 *
 * Production hardening (NODE_ENV=production): https URLs only, media on a different origin
 * than the app (SEC4), and the dev email provider is refused. These three checks are skipped
 * when APP_URL points at localhost/127.0.0.1, so a production build can be smoke-tested and
 * e2e-tested on a developer machine or in CI.
 */
export function assertBootEnv(source: Record<string, string | undefined> = process.env): BootEnv {
  const env = parseEnv(bootEnvSchema, source);
  const bad: string[] = [];
  const appHost = new URL(env.APP_URL).hostname;
  const local = appHost === "localhost" || appHost === "127.0.0.1" || appHost === "[::1]";
  if (env.NODE_ENV === "production" && !local) {
    if (env.EMAIL_PROVIDER === "dev") bad.push("EMAIL_PROVIDER");
    for (const name of ["APP_URL", "PUBLIC_URL", "MEDIA_URL"] as const) {
      if (!env[name].startsWith("https://")) bad.push(name);
    }
    if (new URL(env.MEDIA_URL).origin === new URL(env.APP_URL).origin) bad.push("MEDIA_URL");
  }
  if (bad.length > 0) throw new EnvError([...new Set(bad)].sort());
  return env;
}
