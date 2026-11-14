import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { locales } from "@ed/i18n/config";
import { loadMessages, type Messages } from "@ed/i18n/load";
import { describe, expect, it } from "vitest";
import { getHelpArticle, listHelpEntries } from "../components/help/content";
import { getHelpArticleDef, helpArticles, helpSections, helpTopics, openerFor, sectionOf } from "../components/help/registry";

// The help centre's structure (components/help/registry.ts) and its wording (the help*
// i18n namespaces) are kept apart; these tests keep them in step and keep every "where to find
// it" route pointing at a screen that really exists.

const APP = resolve(__dirname, "..", "app");

/** Every page route under app/, with route groups "(app)" removed: "/occasions/[id]/budget". */
function pageRoutes(dir = APP, prefix = ""): Set<string> {
  const out = new Set<string>();
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      const segment = /^\(.*\)$/.test(name) ? "" : `/${name}`;
      for (const r of pageRoutes(path, prefix + segment)) out.add(r);
    } else if (name === "page.tsx") {
      out.add(prefix || "/");
    }
  }
  return out;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

describe("help centre", () => {
  const routes = pageRoutes();

  it("has between 45 and 60 articles with unique, URL-safe slugs", () => {
    expect(helpArticles.length).toBeGreaterThanOrEqual(45);
    expect(helpArticles.length).toBeLessThanOrEqual(60);
    const slugs = helpArticles.map((x) => x.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug, slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("every section is titled, non-empty and has its own namespace in both languages", () => {
    for (const locale of locales) {
      const messages = loadMessages(locale);
      const titles = (messages.help?.sections ?? {}) as Messages;
      for (const section of helpSections) {
        const chrome = titles[section.key] as Messages | undefined;
        expect(typeof chrome?.title, `${locale} help.sections.${section.key}.title`).toBe("string");
        expect(typeof chrome?.intro, `${locale} help.sections.${section.key}.intro`).toBe("string");
        expect(typeof messages[section.ns], `${locale}/${section.ns}.json`).toBe("object");
        expect(helpArticles.some((x) => x.section === section.key), `articles in ${section.key}`).toBe(true);
      }
    }
  });

  it("every listed article exists in both languages with a summary and at least one step or paragraph", () => {
    for (const locale of locales) {
      for (const def of helpArticles) {
        const article = getHelpArticle(locale, def.slug);
        expect(article, `${locale} ${def.slug}`).not.toBeNull();
        if (!article) continue;
        expect(article.title.length, `${locale} ${def.slug} title`).toBeGreaterThan(3);
        expect(article.summary.length, `${locale} ${def.slug} summary`).toBeGreaterThan(20);
        expect(article.keywords.length, `${locale} ${def.slug} keywords`).toBeGreaterThan(3);
        expect(article.where.length, `${locale} ${def.slug} where`).toBeGreaterThan(2);
        const body = article.blocks.filter((b) => b.kind === "p" || (b.kind === "ol" && "items" in b && b.items.length > 0));
        expect(body.length, `${locale} ${def.slug} has a step list or a paragraph`).toBeGreaterThan(0);
        const text = article.blocks.map((b) => ("items" in b ? b.items.map((i) => i.text).join(" ") : b.text)).join(" ");
        // Article text is rendered as written, never through ICU: no placeholders, no markup.
        expect(text, `${locale} ${def.slug} plain text`).not.toMatch(/[{}<>]/);
        const count = words(`${article.summary} ${text}`);
        expect(count, `${locale} ${def.slug} length (${count} words)`).toBeGreaterThanOrEqual(120);
        expect(count, `${locale} ${def.slug} length (${count} words)`).toBeLessThanOrEqual(350);
      }
    }
  });

  it("no article sits in a namespace without being registered", () => {
    for (const locale of locales) {
      const messages = loadMessages(locale);
      for (const section of helpSections) {
        for (const slug of Object.keys(messages[section.ns] ?? {})) {
          expect(getHelpArticleDef(slug)?.section, `${locale}/${section.ns}.json "${slug}"`).toBe(section.key);
        }
      }
    }
  });

  it("every 'see also' slug resolves, and public articles never point at staff ones", () => {
    for (const def of helpArticles) {
      expect(def.related.length, `${def.slug} related`).toBeGreaterThan(0);
      for (const slug of def.related) {
        const target = getHelpArticleDef(slug);
        expect(target, `${def.slug} → ${slug}`).toBeDefined();
        expect(slug, `${def.slug} links to itself`).not.toBe(def.slug);
        if (target && !sectionOf(def.section).staffOnly) {
          expect(sectionOf(target.section).staffOnly ?? false, `${def.slug} → staff article ${slug}`).toBe(false);
        }
      }
    }
  });

  it("every app route an article names exists as a page under apps/web/app", () => {
    for (const def of helpArticles) {
      expect(def.routes.length, `${def.slug} routes`).toBeGreaterThan(0);
      for (const route of def.routes) expect(routes.has(route), `${def.slug} → ${route}`).toBe(true);
      const opener = openerFor(def.routes[0]!);
      if (opener) expect(routes.has(opener.href), `${def.slug} opens ${opener.href}`).toBe(true);
    }
    expect(routes.has("/help")).toBe(true);
    expect(routes.has("/help/[slug]")).toBe(true);
    expect(routes.has("/report")).toBe(true);
  });

  it("every opener has a label in both languages", () => {
    for (const locale of locales) {
      const open = ((loadMessages(locale).help?.article as Messages | undefined)?.open ?? {}) as Messages;
      for (const def of helpArticles) {
        const opener = openerFor(def.routes[0]!);
        if (opener) expect(typeof open[opener.key], `${locale} help.article.open.${opener.key}`).toBe("string");
      }
    }
  });

  it("contextual help topics point at existing articles", () => {
    for (const [topic, slug] of Object.entries(helpTopics)) {
      expect(getHelpArticleDef(slug), `topic ${topic}`).toBeDefined();
    }
  });

  it("the staff section is left out of the public index and search", () => {
    for (const locale of locales) {
      const publicEntries = listHelpEntries(locale, { staff: false });
      expect(publicEntries.some((e) => e.section === "staff")).toBe(false);
      expect(listHelpEntries(locale, { staff: true }).length).toBe(helpArticles.length);
      expect(publicEntries.length).toBe(helpArticles.filter((x) => x.section !== "staff").length);
    }
  });
});
