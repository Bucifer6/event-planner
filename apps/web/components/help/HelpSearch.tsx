"use client";

import { EmptyState } from "@ed/ui";
import { IconSearch } from "@ed/ui/icons";
import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import s from "./help.module.css";

export type HelpSearchEntry = { slug: string; title: string; summary: string; keywords: string; where: string; sectionTitle: string };

export type HelpSearchLabels = {
  label: string;
  hint: string;
  submit: string;
  clear: string;
  resultsTitle: string;
  count: { one: string; few: string; other: string };
  emptyTitle: string;
  emptyBody: string;
};

/** Lower-case, diacritics folded: "Invitați" matches "invitati". */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

function search(entries: Array<HelpSearchEntry & { hay: { title: string; rest: string } }>, query: string): HelpSearchEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const scored: Array<{ entry: HelpSearchEntry; score: number; order: number }> = [];
  entries.forEach((entry, order) => {
    let score = 0;
    for (const w of words) {
      if (entry.hay.title.includes(w)) score += 3;
      else if (entry.hay.rest.includes(w)) score += 1;
      else return;
    }
    scored.push({ entry, score, order });
  });
  return scored.sort((x, y) => y.score - x.score || x.order - y.order).map((x) => x.entry);
}

function countText(labels: HelpSearchLabels["count"], count: number, locale: string): string {
  const rule = new Intl.PluralRules(locale === "en" ? "en" : "ro").select(count);
  const text = rule === "one" ? labels.one : rule === "few" ? labels.few : labels.other;
  return text.replace("{count}", String(count));
}

/**
 * The help index search: filters titles, summaries and keywords in the browser as you type.
 * Without JavaScript the form submits `?q=` and the server renders the same component with
 * `initialQuery`. `children` are the sections shown while the box is empty.
 */
export function HelpSearch({
  entries,
  labels,
  locale,
  initialQuery,
  children,
}: {
  entries: HelpSearchEntry[];
  labels: HelpSearchLabels;
  locale: string;
  initialQuery: string;
  children: ReactNode;
}) {
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const indexed = useMemo(
    () => entries.map((e) => ({ ...e, hay: { title: fold(e.title), rest: fold(`${e.summary} ${e.keywords} ${e.where} ${e.sectionTitle}`) } })),
    [entries],
  );
  const active = query.trim().length > 0;
  const results = useMemo(() => (active ? search(indexed, query) : []), [active, indexed, query]);

  return (
    <>
      <form className={s.search} role="search" method="get" action="/help" onSubmit={(e) => e.preventDefault()}>
        <label className="ed-field__label" htmlFor={id}>
          {labels.label}
        </label>
        <div className={s.searchRow}>
          <span className={s.searchIcon}>
            <IconSearch size={20} />
          </span>
          <input
            id={id}
            className={`ed-input ${s.searchInput}`}
            type="search"
            name="q"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-describedby={`${id}-hint`}
            autoComplete="off"
            enterKeyHint="search"
            maxLength={80}
          />
          {active ? (
            <button type="button" className="ed-btn ed-btn--quiet" onClick={() => setQuery("")}>
              {labels.clear}
            </button>
          ) : (
            <noscript>
              <button type="submit" className="ed-btn">
                {labels.submit}
              </button>
            </noscript>
          )}
        </div>
        <p className="ed-small ed-muted" id={`${id}-hint`}>
          {labels.hint}
        </p>
      </form>

      <p className={active ? s.count : "ed-vh"} role="status" aria-live="polite">
        {active ? countText(labels.count, results.length, locale) : ""}
      </p>

      {!active ? (
        children
      ) : results.length === 0 ? (
        <EmptyState
          title={labels.emptyTitle}
          action={
            <button type="button" className="ed-btn" onClick={() => setQuery("")}>
              {labels.clear}
            </button>
          }
        >
          {labels.emptyBody}
        </EmptyState>
      ) : (
        <section aria-label={labels.resultsTitle}>
          <ol className={s.articles}>
            {results.map((r, i) => (
              <li key={r.slug}>
                <Link href={`/help/${r.slug}`} className={s.article}>
                  <span className={s.index} aria-hidden>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={s.articleMain}>
                    <span className={s.articleTitle}>{r.title}</span>
                    <span className={s.articleSummary}>{r.summary}</span>
                    <span className={s.articleSection}>{r.sectionTitle}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
