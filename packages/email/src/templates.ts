import { translate } from "@ed/i18n/load";

// Template registry + bilingual renderer (L5: Romanian first, English below).
// A template returns structured blocks; the renderer turns them into plain text and a simple
// HTML body with inline styles only — no images, no fonts, no external assets, no tracking.

export type EmailLocale = "ro" | "en";

export type EmailBlock =
  | { kind: "text"; text: string }
  /** A sign-in / confirmation code, set large. */
  | { kind: "code"; code: string }
  | { kind: "button"; label: string; url: string }
  /** Small print: validity, security wording. */
  | { kind: "note"; text: string };

export type EmailContent = { subject: string; blocks: EmailBlock[] };

export type TemplateTools = {
  locale: EmailLocale;
  /** Full i18n key ("emails.signIn.subject") with {name} params. */
  t: (key: string, params?: Record<string, string | number>) => string;
};

export type TemplateRender<P> = (params: P, tools: TemplateTools) => EmailContent;

const globalRegistry = globalThis as unknown as {
  __edEmailTemplates?: Map<string, TemplateRender<never>>;
};
const templates = (globalRegistry.__edEmailTemplates ??= new Map());

/**
 * Register a template under a unique name ("rsvp.invitation"). Called at module load by the
 * package that owns the email; strings come from that package's i18n namespace.
 * Registering the same name again replaces it (hot reload).
 */
export function registerTemplate<P>(name: string, render: TemplateRender<P>): void {
  templates.set(name, render as TemplateRender<never>);
}

export function hasTemplate(name: string): boolean {
  return templates.has(name);
}

export type RenderedEmail = { subject: string; text: string; html: string };

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

function blocksToText(blocks: EmailBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "text":
        case "note":
          return b.text;
        case "code":
          return `    ${b.code}`;
        case "button":
          return `${b.label}:\n${b.url}`;
      }
    })
    .join("\n\n");
}

const INK = "#1b1d2a";
const INK2 = "#4a4d5e";
const LINE = "#d9d4c7";

function blocksToHtml(blocks: EmailBlock[]): string {
  return blocks
    .map((b) => {
      switch (b.kind) {
        case "text":
          return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:${INK}">${esc(b.text)}</p>`;
        case "note":
          return `<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:${INK2}">${esc(b.text)}</p>`;
        case "code":
          return `<p style="margin:0 0 16px;font-size:32px;line-height:1.2;letter-spacing:6px;font-weight:700;color:${INK}">${esc(b.code)}</p>`;
        case "button":
          return `<p style="margin:0 0 16px"><a href="${esc(safeUrl(b.url))}" style="display:inline-block;padding:12px 20px;background:${INK};color:#ffffff;text-decoration:none;font-size:16px;border-radius:2px">${esc(b.label)}</a></p>`;
      }
    })
    .join("\n");
}

/**
 * Renders a registered template. Bilingual by default: Romanian first, English below (L5).
 * With `bilingual: false` only `locale` is rendered.
 */
export function renderEmail(
  name: string,
  params: unknown,
  opts: { locale?: EmailLocale; bilingual?: boolean } = {},
): RenderedEmail {
  const render = templates.get(name) as TemplateRender<unknown> | undefined;
  if (!render) throw new Error(`Unknown email template: ${name}`);
  const one = (locale: EmailLocale) =>
    render(params, { locale, t: (key, p) => translate(locale, key, p) });

  const order: EmailLocale[] =
    opts.bilingual === false ? [opts.locale ?? "ro"] : ["ro", "en"];
  const parts = order.map((locale) => ({ locale, content: one(locale) }));
  const subjects = [...new Set(parts.map((p) => p.content.subject))];
  const subject = subjects.join(" / ");

  const textParts: string[] = [];
  const htmlParts: string[] = [];
  parts.forEach((p, i) => {
    if (i > 0) {
      const marker = translate(p.locale, "emails.layout.languageBelow");
      textParts.push(`----------\n${marker}`);
      htmlParts.push(
        `<hr style="border:0;border-top:1px solid ${LINE};margin:24px 0">` +
          `<p style="margin:0 0 16px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${INK2}">${esc(marker)}</p>`,
      );
    }
    textParts.push(blocksToText(p.content.blocks));
    htmlParts.push(`<div lang="${p.locale}">${blocksToHtml(p.content.blocks)}</div>`);
  });
  const footer = order.map((l) => translate(l, "emails.layout.footer")).join("\n");
  const text = `${textParts.join("\n\n")}\n\n--\n${footer}\n`;
  const html =
    `<!doctype html><html lang="${order[0]}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:24px;background:#faf8f3;font-family:Helvetica,Arial,sans-serif">` +
    `<div style="max-width:520px;margin:0 auto;padding:24px;background:#ffffff;border:1px solid ${LINE}">` +
    htmlParts.join("\n") +
    `<hr style="border:0;border-top:1px solid ${LINE};margin:24px 0 16px">` +
    `<p style="margin:0;font-size:12px;line-height:1.5;color:${INK2}">${esc(footer).replace(/\n/g, "<br>")}</p>` +
    `</div></body></html>`;
  return { subject, text, html };
}
