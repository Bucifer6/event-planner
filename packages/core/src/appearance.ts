import { z } from "zod";
import { AppError } from "@ed/shared/errors";
import type { Ctx } from "./context";
import { readSetting, requireStaffRole, writeSetting } from "./staff";

// The look of the whole app, chosen by a platform administrator in the console
// (/console/appearance). A look is a set of design tokens in @ed/ui (tokens.css for Maison,
// themes.css for the others); the root layout puts the chosen name on <html data-ui="…">.
// It changes how the app looks, never what it does or what anyone is allowed to see.

export const UI_THEMES = ["maison", "atelier", "riviera", "jardin", "studio", "nocturne", "folio", "herbarium", "prism", "salon", "dune", "ledger", "muse"] as const;
export type UiTheme = (typeof UI_THEMES)[number];
export const DEFAULT_UI_THEME: UiTheme = "maison";
export const UI_THEME_SETTING_KEY = "ui.theme";
export const uiThemeSchema = z.enum(UI_THEMES);

/** Paper colour of each look in light mode — used for the browser's theme colour. */
export const UI_THEME_PAPER: Record<UiTheme, string> = {
  maison: "#f5f2ec",
  atelier: "#ffffff",
  riviera: "#f7efe3",
  jardin: "#f1f1eb",
  studio: "#f4ebe6",
  nocturne: "#14191e",
  folio: "#f4f2e9",
  herbarium: "#e8ecdf",
  prism: "#ecedf9",
  salon: "#f7eee8",
  dune: "#f2e6d7",
  ledger: "#ebefed",
  muse: "#f1edf7",
};

export function isUiTheme(value: unknown): value is UiTheme {
  return typeof value === "string" && (UI_THEMES as readonly string[]).includes(value);
}

// Read on every page, so it is cached in the process for a few seconds. The process that
// changes it sees the change at once; other web processes follow within the cache time.
const CACHE_MS = 15_000;
const cache = globalThis as unknown as { __edUiTheme?: { value: UiTheme; at: number } };

/** The look currently in force. Public: every visitor's page needs it. Never throws. */
export async function getUiTheme(ctx: Pick<Ctx, "db">, opts: { fresh?: boolean } = {}): Promise<UiTheme> {
  const hit = cache.__edUiTheme;
  if (!opts.fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  let value: UiTheme = DEFAULT_UI_THEME;
  try {
    const stored = await readSetting<{ theme?: unknown }>(ctx, UI_THEME_SETTING_KEY);
    if (stored && isUiTheme(stored.theme)) value = stored.theme;
  } catch {
    // a page must still render in the house look when the setting cannot be read
  }
  cache.__edUiTheme = { value, at: Date.now() };
  return value;
}

/** Platform administrators only. Audited through the settings writer. Returns the look now in force. */
export async function setUiTheme(ctx: Ctx, input: { theme: string }): Promise<UiTheme> {
  requireStaffRole(ctx, "platform_admin");
  const parsed = uiThemeSchema.safeParse(input.theme);
  if (!parsed.success) throw new AppError("VALIDATION", "console.appearance.errors.unknownTheme");
  await writeSetting(ctx, UI_THEME_SETTING_KEY, { theme: parsed.data });
  cache.__edUiTheme = { value: parsed.data, at: Date.now() };
  return parsed.data;
}
