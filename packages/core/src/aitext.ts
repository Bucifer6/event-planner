import { aiTextResults, aiTextUsage, and, eq, gt, lt, platformSettings, sql, AI_TEXT_PURPOSES, type AiTextPurpose } from "@ed/db";
import { translate } from "@ed/i18n";
import { AppError } from "@ed/shared/errors";
import { zonedParts, zonedToUtc } from "@ed/shared/time";
import { z } from "zod";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { onAccountPurge } from "./accounts";

// THE AI TEXT FEATURE (INF7, Q6, MCP5) — invitation and message WORDING SUGGESTIONS, nothing else.
//
//   getAiTextStatus(ctx)            is it configured, how many results are left, when the count resets
//   suggestText(ctx, input)         ONE suggestion (counts as one result of the ten per month)
//   markAiTextAccepted(ctx, id)     the user took the suggestion into their own text
//   readAiTextProviderRecord(ctx)   provider + model in use, as recorded for the console
//
// Rules this module enforces:
// - A suggestion is only ever RETURNED to the person who asked. It is shown in an edit box
//   labelled "generat cu AI" and used only when they accept it — this module cannot write into
//   an invitation, send a message or apply anything.
// - Ten results per account per calendar month (Europe/Bucharest), counted atomically in
//   `ai_text_usage`; the eleventh is refused with the date the count starts again.
// - Minimal context leaves the server: the kind of occasion, the tone, the language, and the
//   names / hint the user typed into the form. Never a guest list, a contact, an address or
//   anything read from the database (buildAiTextPayload is the whole payload; a test pins it).
// - The provider is the operator's choice, never a guess:
//     AI_TEXT_PROVIDER = "off" (default) | "dev" | "http"
//     AI_TEXT_MODEL    = free text recorded with every result
//     AI_TEXT_URL      = endpoint of the "http" provider
//     AI_TEXT_API_KEY  = sent as "Authorization: Bearer …" to that endpoint
//   "http" is a neutral seam: POST the JSON of buildAiTextPayload(), expect `{ "text": "…" }`.
//   The operator puts whatever vendor they chose behind that URL. "dev" composes from fixed
//   templates so the feature can be tried and tested without any vendor.
// - The provider and model in use are written to the platform setting "aitext.provider"
//   (read it in the console with readSetting(ctx, AI_TEXT_SETTING_KEY) or readAiTextProviderRecord).

export const AI_TEXT_MONTHLY_LIMIT = 10;
export const AI_TEXT_SETTING_KEY = "aitext.provider";
/** The label that stays with AI text until the user rewrites it (INF7). */
export const AI_TEXT_LABEL = { ro: "generat cu AI", en: "AI-generated" } as const;

export const AI_TEXT_TONES = ["ceremonious", "warm", "playful"] as const;
export type AiTextTone = (typeof AI_TEXT_TONES)[number];
export { AI_TEXT_PURPOSES };
export type { AiTextPurpose };

export type AiTextConfig = { provider: "off" | "dev" | "http"; model: string; url: string | null; apiKey: string | null };

/** The operator's configuration, read from the environment on every call (no caching: tests and deploys change it). */
export function getAiTextConfig(env: Record<string, string | undefined> = process.env): AiTextConfig {
  const raw = (env.AI_TEXT_PROVIDER ?? "off").trim().toLowerCase();
  const provider = raw === "dev" || raw === "http" ? raw : "off";
  return {
    provider,
    model: (env.AI_TEXT_MODEL ?? "").trim() || (provider === "dev" ? "templates-v1" : ""),
    url: (env.AI_TEXT_URL ?? "").trim() || null,
    apiKey: (env.AI_TEXT_API_KEY ?? "").trim() || null,
  };
}

function isEnabled(c: AiTextConfig): boolean {
  return c.provider === "dev" || (c.provider === "http" && !!c.url && !!c.model);
}

const suggestInput = z.object({
  purpose: z.enum(AI_TEXT_PURPOSES),
  /** nunta | botez | aniversare | … — the KIND only. */
  occasionKind: z.string().trim().min(1).max(40),
  tone: z.enum(AI_TEXT_TONES).default("warm"),
  language: z.enum(["ro", "en"]).default("ro"),
  /** What the user typed in the form's names field. */
  names: z.string().trim().max(120).optional(),
  /** A short note the user typed for the suggestion ("în aer liber, fără formalități"). */
  hint: z.string().trim().max(200).optional(),
});
export type SuggestTextInput = z.input<typeof suggestInput>;

export type AiTextPayload = {
  task: "wording_suggestion";
  model: string;
  purpose: AiTextPurpose;
  occasionKind: string;
  tone: AiTextTone;
  language: "ro" | "en";
  names: string | null;
  hint: string | null;
  maxCharacters: number;
};

const MAX_CHARS: Record<AiTextPurpose, number> = { invitation: 400, save_the_date: 160, thanks: 340, message: 400, promotion: 600 };

/** EVERYTHING that is sent to a provider. No ids, no guests, no contacts, no addresses. */
export function buildAiTextPayload(input: SuggestTextInput, config: Pick<AiTextConfig, "model">): AiTextPayload {
  const data = suggestInput.parse(input);
  return {
    task: "wording_suggestion",
    model: config.model,
    purpose: data.purpose,
    occasionKind: data.occasionKind,
    tone: data.tone,
    language: data.language,
    names: data.names || null,
    hint: data.hint || null,
    maxCharacters: MAX_CHARS[data.purpose],
  };
}

export type AiTextFetcher = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

const DEV_KINDS = new Set(["nunta", "botez", "aniversare"]);

/** The deterministic "dev" provider: fixed templates, varied by how many results the account has had. */
function devSuggestion(p: AiTextPayload, variant: number): string {
  const kind = DEV_KINDS.has(p.occasionKind) ? p.occasionKind : "aniversare";
  const purpose = p.purpose === "message" ? "invitation" : p.purpose;
  const n = variant % 2 === 0 ? "a" : "b";
  const who = p.names || translate(p.language, "aitext.dev.who");
  const text = translate(p.language, `aitext.dev.${purpose}.${p.tone}.${n}`, { who, occasion: translate(p.language, `aitext.dev.occasion.${kind}`) });
  return p.hint ? `${text} ${translate(p.language, "aitext.dev.hint", { hint: p.hint })}` : text;
}

async function httpSuggestion(config: AiTextConfig, payload: AiTextPayload, fetcher: AiTextFetcher): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetcher(config.url!, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`provider answered ${res.status}`);
    const body = (await res.json()) as { text?: unknown };
    if (typeof body?.text !== "string" || !body.text.trim()) throw new Error("provider returned no text");
    return body.text;
  } finally {
    clearTimeout(timer);
  }
}

/** Plain text only, bounded: whatever a provider returns is treated as untrusted text. */
function sanitise(text: string, max: number): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function monthOf(now: Date): { key: string; resetsAt: Date } {
  const p = zonedParts(now);
  const key = `${p.year}-${String(p.month).padStart(2, "0")}`;
  const next = p.month === 12 ? { year: p.year + 1, month: 1 } : { year: p.year, month: p.month + 1 };
  return { key, resetsAt: zonedToUtc({ year: next.year, month: next.month, day: 1, hour: 0, minute: 0, second: 0 }) };
}

function accountOf(ctx: Ctx): string {
  // a person in the app only: not an assistant token, not a guest, not the system
  if (ctx.actor.kind !== "account") throw new AppError(ctx.actor.kind === "anonymous" ? "UNAUTHENTICATED" : "FORBIDDEN", "common.errors.FORBIDDEN");
  return ctx.actor.accountId;
}

export type AiTextStatus = {
  enabled: boolean;
  limit: number;
  used: number;
  remaining: number;
  /** First instant of next month (Europe/Bucharest): the count starts again. */
  resetsAt: Date;
};

/** For the form: is the feature on, and how many of this month's results are left. */
export async function getAiTextStatus(ctx: Ctx): Promise<AiTextStatus> {
  const accountId = accountOf(ctx);
  const { key, resetsAt } = monthOf(ctx.now);
  const [row] = await ctx.db
    .select({ used: aiTextUsage.used })
    .from(aiTextUsage)
    .where(and(eq(aiTextUsage.accountId, accountId), eq(aiTextUsage.month, key)));
  const used = Math.min(AI_TEXT_MONTHLY_LIMIT, row?.used ?? 0);
  return { enabled: isEnabled(getAiTextConfig()), limit: AI_TEXT_MONTHLY_LIMIT, used, remaining: AI_TEXT_MONTHLY_LIMIT - used, resetsAt };
}

export type AiTextSuggestion = {
  resultId: string;
  /** Show it in an edit box under `label`; use it only when the user accepts. */
  text: string;
  label: string;
  remaining: number;
  resetsAt: Date;
};

export type AiTextProviderRecord = { provider: string; model: string; recordedAt: string };

/** Provider and model currently recorded for the console (null until the feature is first used). */
export async function readAiTextProviderRecord(ctx: Pick<Ctx, "db">): Promise<AiTextProviderRecord | null> {
  const [row] = await ctx.db.select({ value: platformSettings.value }).from(platformSettings).where(eq(platformSettings.key, AI_TEXT_SETTING_KEY));
  return (row?.value as AiTextProviderRecord | undefined) ?? null;
}

async function recordProvider(ctx: Ctx, config: AiTextConfig): Promise<void> {
  const current = await readAiTextProviderRecord(ctx);
  if (current && current.provider === config.provider && current.model === config.model) return;
  const value: AiTextProviderRecord = { provider: config.provider, model: config.model, recordedAt: ctx.now.toISOString() };
  await ctx.db.insert(platformSettings).values({ key: AI_TEXT_SETTING_KEY, value }).onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: ctx.now } });
  await audit(ctx, { action: "platform_setting.set", objectType: "platform_setting", objectId: AI_TEXT_SETTING_KEY, before: current, after: value });
}

/**
 * One wording suggestion. Claims one of the month's ten results first (atomically — two
 * requests cannot both take the last one), gives it back if the provider fails, and returns
 * the text to the caller only: nothing is saved, sent or applied here.
 */
export async function suggestText(ctx: Ctx, input: SuggestTextInput, opts: { fetcher?: AiTextFetcher; env?: Record<string, string | undefined> } = {}): Promise<AiTextSuggestion> {
  const accountId = accountOf(ctx);
  const data = suggestInput.parse(input);
  const config = getAiTextConfig(opts.env);
  if (!isEnabled(config)) throw new AppError("CONFLICT", "aitext.errors.notConfigured");
  const { key, resetsAt } = monthOf(ctx.now);

  const claimed = await ctx.db
    .insert(aiTextUsage)
    .values({ accountId, month: key, used: 1 })
    .onConflictDoUpdate({
      target: [aiTextUsage.accountId, aiTextUsage.month],
      set: { used: sql`${aiTextUsage.used} + 1`, updatedAt: ctx.now },
      setWhere: lt(aiTextUsage.used, AI_TEXT_MONTHLY_LIMIT),
    })
    .returning({ used: aiTextUsage.used });
  const used = claimed[0]?.used;
  if (used === undefined) {
    throw new AppError("LIMIT", "aitext.errors.monthlyLimit", { retryAt: resetsAt.toISOString(), params: { limit: AI_TEXT_MONTHLY_LIMIT, date: formatResetDay(resetsAt, ctx.locale) } });
  }

  const payload = buildAiTextPayload(data, config);
  let text: string;
  try {
    const raw = config.provider === "dev" ? devSuggestion(payload, used - 1) : await httpSuggestion(config, payload, opts.fetcher ?? (globalThis.fetch as unknown as AiTextFetcher));
    text = sanitise(raw, payload.maxCharacters);
    if (!text) throw new Error("empty suggestion");
  } catch {
    // the result was not delivered: it does not count
    await ctx.db
      .update(aiTextUsage)
      .set({ used: sql`${aiTextUsage.used} - 1` })
      .where(and(eq(aiTextUsage.accountId, accountId), eq(aiTextUsage.month, key), gt(aiTextUsage.used, 0)));
    throw new AppError("CONFLICT", "aitext.errors.providerFailed");
  }
  const [row] = await ctx.db.insert(aiTextResults).values({ accountId, month: key, purpose: data.purpose, provider: config.provider, model: config.model }).returning({ id: aiTextResults.id });
  await recordProvider(ctx, config);
  return { resultId: row!.id, text, label: AI_TEXT_LABEL[data.language], remaining: AI_TEXT_MONTHLY_LIMIT - used, resetsAt };
}

function formatResetDay(d: Date, locale: "ro" | "en"): string {
  const p = zonedParts(d);
  const months = locale === "ro" ? ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"] : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${p.day} ${months[p.month - 1]} ${p.year}`;
}

/** The user accepted a suggestion into their own text (kept as a fact; the text itself is not stored here). */
export async function markAiTextAccepted(ctx: Ctx, resultId: string): Promise<void> {
  const accountId = accountOf(ctx);
  await ctx.db
    .update(aiTextResults)
    .set({ acceptedAt: ctx.now })
    .where(and(eq(aiTextResults.id, String(resultId).slice(0, 64)), eq(aiTextResults.accountId, accountId)));
}

onAccountPurge(async (tx, accountId) => {
  await tx.db.delete(aiTextResults).where(eq(aiTextResults.accountId, accountId));
  await tx.db.delete(aiTextUsage).where(eq(aiTextUsage.accountId, accountId));
});
