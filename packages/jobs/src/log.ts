// Structured JSON logs, one object per line (R0-12). Never log payloads or secrets: pass
// ids, names, counts and durations only.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, alert: 50 } as const;
export type LogLevel = keyof typeof LEVELS;
export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type Logger = (level: LogLevel, msg: string, fields?: LogFields) => void;

function threshold(): number {
  const name = (process.env.LOG_LEVEL ?? "info") as LogLevel;
  return LEVELS[name] ?? LEVELS.info;
}

export const jsonLogger: Logger = (level, msg, fields) => {
  if (LEVELS[level] < threshold()) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, src: "worker", msg, ...fields });
  if (LEVELS[level] >= LEVELS.error) console.error(line);
  else console.info(line);
};

export const silentLogger: Logger = () => {};

/** Error name + message, trimmed; never the stack (it can carry values). */
export function errorText(e: unknown): string {
  const err = e as { name?: unknown; message?: unknown };
  const text = `${typeof err?.name === "string" ? err.name : "Error"}: ${
    typeof err?.message === "string" ? err.message : String(e)
  }`;
  return text.slice(0, 500);
}
