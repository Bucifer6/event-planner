// SEC13/R0-02: boot-time env validation. Fails fast with the NAMES of missing
// variables only — never a value, never a default that silently weakens production.
export function missingEnv(env: Record<string, string | undefined>, required: string[]): string[] {
  return required.filter((name) => !env[name] || env[name] === '');
}

export function assertBootEnv(
  env: Record<string, string | undefined>,
  required: string[],
  opts: { production: boolean }
): void {
  if (!opts.production) return;
  const missing = missingEnv(env, required);
  if (missing.length > 0) {
    // names only — values are secrets and must never appear in logs or errors (SEC13)
    throw new Error(`Refusing to boot in production: missing required env: ${missing.join(', ')}`);
  }
}
