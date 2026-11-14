import { loadMessages, type Messages } from "@ed/i18n";
import { getHelpArticleDef, helpArticles, helpSections, sectionOf, type HelpArticleDef, type HelpSectionKey } from "./registry";

/**
 * Reads help articles straight from the message files (no ICU parsing: article text is plain
 * prose, so it never contains {placeholders}). Safe on the server and in vitest.
 */
export type HelpBlock =
  | { kind: "p" | "note" | "h"; key: string; text: string }
  | { kind: "ol" | "ul"; key: string; items: Array<{ key: string; text: string }> };

export type HelpArticle = {
  def: HelpArticleDef;
  title: string;
  summary: string;
  keywords: string;
  where: string;
  need: string | null;
  blocks: HelpBlock[];
};

export type HelpEntry = { slug: string; section: HelpSectionKey; title: string; summary: string; keywords: string; where: string };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function toBlocks(body: unknown): HelpBlock[] {
  if (typeof body !== "object" || body === null) return [];
  const out: HelpBlock[] = [];
  for (const [key, value] of Object.entries(body as Messages)) {
    if (typeof value === "string") {
      const kind = key.startsWith("note") ? "note" : key.startsWith("h") ? "h" : "p";
      out.push({ kind, key, text: value });
    } else if (key.startsWith("ol") || key.startsWith("ul")) {
      out.push({
        kind: key.startsWith("ol") ? "ol" : "ul",
        key,
        items: Object.entries(value).map(([k, text]) => ({ key: k, text: str(text) })),
      });
    }
  }
  return out;
}

export function getHelpArticle(locale: string, slug: string): HelpArticle | null {
  const def = getHelpArticleDef(slug);
  if (!def) return null;
  const raw = loadMessages(locale)[sectionOf(def.section).ns]?.[slug];
  if (typeof raw !== "object" || raw === null) return null;
  const title = str(raw.title);
  if (!title) return null;
  return {
    def,
    title,
    summary: str(raw.summary),
    keywords: str(raw.keywords),
    where: str(raw.where),
    need: str(raw.need) || null,
    blocks: toBlocks(raw.body),
  };
}

/** Title + summary + keywords of every article, in registry order (the search index). */
export function listHelpEntries(locale: string, opts: { staff: boolean }): HelpEntry[] {
  const hidden = new Set(helpSections.filter((s) => s.staffOnly && !opts.staff).map((s) => s.key));
  const out: HelpEntry[] = [];
  for (const def of helpArticles) {
    if (hidden.has(def.section)) continue;
    const article = getHelpArticle(locale, def.slug);
    if (!article) continue;
    out.push({ slug: def.slug, section: def.section, title: article.title, summary: article.summary, keywords: article.keywords, where: article.where });
  }
  return out;
}
