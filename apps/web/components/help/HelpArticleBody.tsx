import { IconInfo } from "@ed/ui/icons";
import type { HelpBlock } from "./content";
import s from "./help.module.css";

/** Renders an article's blocks: paragraphs, sub-headings, numbered steps, lists and notes. */
export function HelpArticleBody({ blocks, noteLabel }: { blocks: HelpBlock[]; noteLabel: string }) {
  return (
    <div className={s.body}>
      {blocks.map((b) => {
        if (!("items" in b)) {
          if (b.kind === "p") return <p key={b.key}>{b.text}</p>;
          if (b.kind === "h") return <h2 key={b.key}>{b.text}</h2>;
          return (
            <aside key={b.key} className={s.note}>
              <IconInfo size={18} />
              <p>
                <strong>{noteLabel}</strong> {b.text}
              </p>
            </aside>
          );
        }
        if (b.kind === "ol")
          return (
            <ol key={b.key} className={s.steps}>
              {b.items.map((it) => (
                <li key={it.key}>{it.text}</li>
              ))}
            </ol>
          );
        return (
          <ul key={b.key} className={s.bullets}>
            {b.items.map((it) => (
              <li key={it.key}>{it.text}</li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}
