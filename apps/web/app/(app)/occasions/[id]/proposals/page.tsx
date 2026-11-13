import { listDecidedPreviews } from "@ed/core/occasions";
import { listPending, toPreviewView } from "@ed/core/whatif";
import { formatDateTime } from "@ed/i18n/format";
import { EmptyState, List, PageHeader, Row, Section, Stack, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PreviewPanel } from "@/components/whatif/PreviewPanel";
import { requireCtx } from "@/lib/ctx";
import { orNotFound } from "../../_lib/load";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("occasions"))("proposals.title") };
}

/**
 * Principle 3: proposed changes waiting for a decision — each with its before → after list —
 * and what was recently applied or dropped. Nothing here has happened until someone confirms.
 */
export default async function ProposalsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const t = await getTranslations("occasions");
  const all = await getTranslations();
  const [history, pending] = await Promise.all([orNotFound(listDecidedPreviews(ctx, id)), listPending(ctx, id)]);
  const title = (key: string | null, p: Record<string, string | number> | null) =>
    key && all.has(key as never) ? all(key as never, (p ?? undefined) as never) : all("whatif.defaultTitle");

  return (
    <>
      <PageHeader level={2} title={t("proposals.title")} description={t("proposals.description")} />
      <Section title={t("proposals.pendingTitle")} level={3}>
        {pending.length > 0 ? (
          <Stack gap={4}>
            {pending.map((p) => (
              <PreviewPanel key={p.id} preview={toPreviewView(p)} />
            ))}
          </Stack>
        ) : (
          <EmptyState title={t("proposals.emptyTitle")}>{t("proposals.emptyBody")}</EmptyState>
        )}
      </Section>
      <Section title={t("proposals.historyTitle")} level={3}>
        {history.length > 0 ? (
          <List>
            {history.map((p) => (
              <Row
                key={p.id}
                title={title(p.titleKey, p.titleParams)}
                meta={p.decidedAt ? formatDateTime(p.decidedAt, ctx.locale) : undefined}
                end={
                  <>
                    {p.proposedByKind === "mcp" ? <Tag tone="attention">{all("whatif.external")}</Tag> : null}
                    <Tag tone={p.state === "applied" ? "success" : "neutral"}>{t(`proposals.state.${p.state as "applied" | "discarded"}`)}</Tag>
                  </>
                }
              />
            ))}
          </List>
        ) : (
          <p className="ed-muted">{t("proposals.historyEmpty")}</p>
        )}
      </Section>
    </>
  );
}
