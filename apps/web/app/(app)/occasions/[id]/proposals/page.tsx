import { listDecidedPreviews } from "@ed/core/occasions";
import { listPlanNotes, type PlanNote } from "@ed/core/plannotes";
import { listPending, toPreviewView } from "@ed/core/whatif";
import { formatDateTime } from "@ed/i18n/format";
import { isAppError } from "@ed/shared/errors";
import { Card, EmptyState, List, PageHeader, PaidLabel, Row, Section, Stack, Tag } from "@ed/ui";
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { removePlanNote } from "@/app/actions/integration";
import { ActionForm } from "@/app/(auth)/_components/forms";
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
  // planner-side notes (a supplier shortlist, budget notes): planning roles only; budget notes
  // only with the finance grant — core decides, and other roles simply see no section
  const notes: PlanNote[] = await listPlanNotes(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "FORBIDDEN") return [];
    throw e;
  });
  const tn = await getTranslations("mcp.notes");
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
      {notes.length > 0 ? (
        <Section title={tn("title")} level={3} id="notes">
          <Stack gap={3}>
            <p className="ed-small ed-muted">{tn("description")}</p>
            {notes.map((note) => (
              <Card key={note.id}>
                <Stack gap={2}>
                  <p className="ed-label">{note.title ?? (note.kind === "supplier_shortlist" ? tn("shortlistTitle") : tn("budgetTitle"))}</p>
                  {note.source === "external_assistant" ? (
                    <div>
                      <Tag tone="attention">{all("whatif.external")}</Tag>
                    </div>
                  ) : null}
                  {note.body ? <p style={{ whiteSpace: "pre-line", maxWidth: "var(--measure)" }}>{note.body}</p> : null}
                  {note.items.length > 0 ? (
                    <>
                      <List>
                        {note.items.map((item) => (
                          <Row
                            key={item.listingId}
                            title={<Link href={`/directory/listing/${item.listingId}?occasion=${id}`}>{item.name}</Link>}
                            meta={item.reason ?? undefined}
                            end={item.featured ? <PaidLabel>{all("featured.label")}</PaidLabel> : undefined}
                          />
                        ))}
                      </List>
                      <p className="ed-small ed-muted">{tn("noEnquiry")}</p>
                    </>
                  ) : null}
                  <ActionForm
                    action={removePlanNote}
                    hidden={{ occasionId: id, noteId: note.id }}
                    refreshOnSuccess
                    variant="danger-quiet"
                    block={false}
                    submitLabel={tn("remove")}
                    pendingLabel={tn("removing")}
                  />
                </Stack>
              </Card>
            ))}
          </Stack>
        </Section>
      ) : null}
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
