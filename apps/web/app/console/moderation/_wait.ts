type T = (key: string, params?: Record<string, string | number>) => string;

/** Waiting time in words: minutes under an hour, hours under two days, then days. */
export function waitText(t: T, minutes: number): string {
  if (minutes < 60) return t("wait.minutes", { count: minutes });
  if (minutes < 48 * 60) return t("wait.hours", { count: Math.floor(minutes / 60) });
  return t("wait.days", { count: Math.floor(minutes / (24 * 60)) });
}
