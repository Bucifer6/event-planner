"use client";

import type { WhatIfPreviewView, WhatIfText } from "@ed/core/whatif";
import { Card, DeltaList, Eyebrow, Notice, Stack, SubmitButton, Tag, Unknown, type DeltaRow } from "@ed/ui";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, type ReactNode } from "react";
import { confirmWhatIf, discardWhatIf, type WhatIfDecision } from "@/app/actions/whatif";
import type { ActionResult } from "@/lib/action-core";

export type PreviewPanelProps = {
  /** toPreviewView(preview) from @ed/core/whatif (JSON-safe). */
  preview: WhatIfPreviewView;
  /** Where to go after "Aplică schimbările". Default: stay and refresh the page's data. */
  appliedHref?: string;
  /** Where to go after "Renunță". Default: stay and refresh. */
  discardedHref?: string;
  /** Extra content under the list (e.g. a domain-specific note). */
  children?: ReactNode;
};

/**
 * What-if preview (principle 3): the before → after list, one primary button
 * "Aplică schimbările" and a secondary "Renunță". Nothing changes until the person confirms.
 * Proposals from an external assistant carry the label "creat cu un asistent extern" (MCP5).
 */
export function PreviewPanel({ preview, appliedHref, discardedHref, children }: PreviewPanelProps) {
  const t = useTranslations();
  const format = useFormatter();
  const router = useRouter();
  const [confirmState, confirm] = useActionState<ActionResult<WhatIfDecision> | null, FormData>(confirmWhatIf, null);
  const [discardState, discard] = useActionState<ActionResult<WhatIfDecision> | null, FormData>(discardWhatIf, null);

  const done = confirmState?.ok ? confirmState.data : discardState?.ok ? discardState.data : null;
  const error = confirmState && !confirmState.ok ? confirmState.error : discardState && !discardState.ok ? discardState.error : null;

  useEffect(() => {
    if (!done) return;
    const href = done.state === "applied" ? appliedHref : discardedHref;
    if (href) router.push(href);
    else router.refresh();
  }, [done, appliedHref, discardedHref, router]);

  const text = (value: WhatIfText): string =>
    typeof value === "string" ? value : t.has(value.key as never) ? t(value.key as never, value.params as never) : value.key;
  const side = (value: WhatIfText | null | undefined): ReactNode =>
    value === undefined ? undefined : value === null ? <Unknown label={t("common.unknown")} /> : text(value);

  const rows: DeltaRow[] = preview.delta.map((row) => ({
    key: row.key,
    what: text(row.what),
    kind: row.kindLabelKey ? text({ key: row.kindLabelKey }) : undefined,
    before: side(row.before),
    after: side(row.after),
    note: row.noteKey ? text({ key: row.noteKey, params: row.noteParams }) : undefined,
  }));

  const title = preview.title ? text(preview.title) : t("whatif.defaultTitle");
  const external = preview.proposedByKind === "mcp";
  const pending = preview.state === "pending" && !done;

  return (
    <Card aria-labelledby={`whatif-${preview.id}`}>
      <Stack gap={3}>
        <Stack gap={1}>
          <Eyebrow>{t("whatif.eyebrow")}</Eyebrow>
          <h2 id={`whatif-${preview.id}`} className="ed-display">
            {title}
          </h2>
          {external ? (
            <p>
              <Tag tone="attention">{t("whatif.external")}</Tag>
            </p>
          ) : null}
          {pending ? <p className="ed-muted">{t("whatif.intro")}</p> : null}
        </Stack>

        {rows.length > 0 ? <DeltaList rows={rows} /> : <p className="ed-muted">{t("whatif.noEffects")}</p>}
        {children}

        {done ? (
          <Notice tone={done.state === "applied" ? "success" : "neutral"} role="status">
            {done.state === "discarded"
              ? t("whatif.discarded")
              : done.appliedNow
                ? t("whatif.applied")
                : t("whatif.alreadyApplied")}
          </Notice>
        ) : null}
        {error ? (
          <Notice tone="danger" role="alert">
            {error.message}
          </Notice>
        ) : null}

        {pending ? (
          <>
            <p className="ed-small ed-muted">
              {t("whatif.expires", {
                date: format.dateTime(new Date(preview.expiresAt), { dateStyle: "medium", timeStyle: "short" }),
              })}
            </p>
            <div className="ed-cluster">
              <form action={discard}>
                <input type="hidden" name="previewId" value={preview.id} />
                <SubmitButton variant="secondary" pendingLabel={t("whatif.discarding")}>
                  {t("whatif.discard")}
                </SubmitButton>
              </form>
              <form action={confirm}>
                <input type="hidden" name="previewId" value={preview.id} />
                <SubmitButton pendingLabel={t("whatif.applying")}>{t("whatif.apply")}</SubmitButton>
              </form>
            </div>
          </>
        ) : null}
      </Stack>
    </Card>
  );
}
