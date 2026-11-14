import { Table, cx } from "@ed/ui";
import { IconArrowRight } from "@ed/ui/icons";
import type { Locale } from "@ed/i18n/config";
import type { ReactNode } from "react";
import s from "@/app/site.module.css";
import { appLinks, href, paths, type PathKey } from "@/lib/site";

/**
 * Long-form documents (guides, legal drafts) are stored as message subtrees whose key prefix
 * says what each block is, in file order:
 *   h… heading · s… sub-heading · p… paragraph · note… set-off sentence
 *   ul…/ol… { item keys → text } · table… { caption, head: {…}, rows: { r…: {…} } }
 *   link… { label, to } where `to` is a page key from lib/site or "report" / "signIn"
 * ro and en share the same keys, so the parity test keeps both documents the same shape.
 */
export type DocTree = { [key: string]: string | DocTree };

type TableBlock = { caption: string; head: Record<string, string>; rows: Record<string, Record<string, string>> };
type LinkBlock = { label: string; to: string };

function linkHref(locale: Locale, to: string): string {
  if (to === "report") return appLinks.report;
  if (to === "signIn") return appLinks.signIn;
  if (to in paths) return href(locale, paths[to as PathKey]);
  return href(locale, paths.home);
}

export function Doc({ locale, body }: { locale: Locale; body: DocTree }) {
  const blocks: ReactNode[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      if (key.startsWith("h")) blocks.push(<h2 key={key}>{value}</h2>);
      else if (key.startsWith("s")) blocks.push(<h3 key={key}>{value}</h3>);
      else if (key.startsWith("note"))
        blocks.push(
          <p key={key} className={s.docNote}>
            {value}
          </p>,
        );
      else blocks.push(<p key={key}>{value}</p>);
      continue;
    }
    if (key.startsWith("ul") || key.startsWith("ol")) {
      const L = key.startsWith("ol") ? "ol" : "ul";
      blocks.push(
        <L key={key}>
          {Object.entries(value).map(([k, item]) => (
            <li key={k}>{String(item)}</li>
          ))}
        </L>,
      );
    } else if (key.startsWith("table")) {
      const table = value as unknown as TableBlock;
      const cols = Object.keys(table.head);
      blocks.push(
        <Table key={key} caption={table.caption}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c} scope="col">
                  {table.head[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(table.rows).map(([rk, row]) => (
              <tr key={rk}>
                {cols.map((c, i) =>
                  i === 0 ? (
                    <th key={c} scope="row" className={s.rowHead}>
                      {row[c]}
                    </th>
                  ) : (
                    <td key={c}>{row[c]}</td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </Table>,
      );
    } else if (key.startsWith("link")) {
      const link = value as unknown as LinkBlock;
      blocks.push(
        <p key={key}>
          <a className={s.docLink} href={linkHref(locale, link.to)}>
            {link.label}
            <IconArrowRight size={16} />
          </a>
        </p>,
      );
    }
  }
  return <div className={cx("ed-prose", s.prose)}>{blocks}</div>;
}
