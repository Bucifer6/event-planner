/** Minutes → "35 min" / "5 h" / "3 zile", through the caller's translator. */
export function waitingText(t: (key: string, params?: Record<string, string | number>) => string, minutes: number): string {
  if (minutes < 60) return t("inbox.minutes", { n: Math.max(1, minutes) });
  if (minutes < 48 * 60) return t("inbox.hours", { n: Math.floor(minutes / 60) });
  return t("inbox.days", { n: Math.floor(minutes / (24 * 60)) });
}
