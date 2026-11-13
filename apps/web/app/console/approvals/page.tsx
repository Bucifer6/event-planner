import { listApprovals, type ApprovalListItem } from "@ed/core/approvals";
import { APPROVAL_STATES, type ApprovalState } from "@ed/db";
import { formatDateTime } from "@ed/i18n/format";
import { Card, Cluster, DescriptionList, EmptyState, Notice, Page, PageHeader, SheetTrigger, Stack, Tag } from "@ed/ui";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { approveApproval, cancelApproval, rejectApproval } from "@/app/actions/console";
import { ActionForm } from "@/app/(auth)/_components/forms";
import { isSingleOperatorMode } from "@ed/core/staff";
import { SpecForm } from "../_components/SpecForm";
import { requireConsole } from "../_lib";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("console.approvals"))("title") };
}

const TABS = ["pending", "approved", "rejected", "cancelled"] as const;

/** W9: the queue of actions that need a second person. */
export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const { ctx } = await requireConsole();
  const t = await getTranslations("console");
  const tAll = await getTranslations();
  const requested = (await searchParams).state;
  const state: ApprovalState = (APPROVAL_STATES as readonly string[]).includes(requested ?? "") ? (requested as ApprovalState) : "pending";
  const [items, single] = await Promise.all([listApprovals(ctx, { state }), isSingleOperatorMode(ctx)]);

  const describe = (item: ApprovalListItem) =>
    item.description && tAll.has(item.description.key as never)
      ? tAll(item.description.key as never, item.description.params as never)
      : item.action;
  const tone = (s: ApprovalState) => (s === "approved" ? "success" : s === "rejected" ? "danger" : s === "pending" ? "attention" : "neutral");

  return (
    <Page>
      <PageHeader title={t("approvals.title")} description={t("approvals.description")} />
      {single ? (
        <Notice tone="attention" title={t("singleOperator.title")}>
          {t("singleOperator.body")}
        </Notice>
      ) : null}
      <nav aria-label={t("approvals.filterLabel")}>
        <ul className="ed-tabs">
          {TABS.map((tab) => (
            <li key={tab}>
              <Link className="ed-tab" href={tab === "pending" ? "/console/approvals" : `/console/approvals?state=${tab}`} aria-current={tab === state ? "page" : undefined}>
                {t(`approvals.states.${tab}`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {items.length === 0 ? (
        <EmptyState title={t(`approvals.empty.${state}`)}>{state === "pending" ? t("approvals.emptyBody") : null}</EmptyState>
      ) : (
        <Stack gap={3}>
          {items.map((item) => (
            <Card key={item.id}>
              <Stack gap={3}>
                <Cluster justify="between">
                  <strong>{describe(item)}</strong>
                  <Cluster gap={2}>
                    {item.singleOperatorMode ? <Tag tone="attention">{t("approvals.singleOperatorTag")}</Tag> : null}
                    <Tag tone={tone(item.state)}>{t(`approvals.states.${item.state}`)}</Tag>
                  </Cluster>
                </Cluster>
                <DescriptionList
                  cols={3}
                  items={[
                    { term: t("approvals.requestedBy"), value: item.mine ? t("approvals.you") : item.requesterLabel },
                    { term: t("approvals.requestedAt"), value: formatDateTime(item.createdAt, ctx.locale) },
                    {
                      term: t("approvals.progress"),
                      value: <span className="ed-num">{t("approvals.progressValue", { done: item.approvals, needed: item.approvalsNeeded })}</span>,
                    },
                    { term: t("approvals.reason"), value: item.reason },
                    ...(item.decisionReason ? [{ term: t("approvals.decisionReason"), value: item.decisionReason }] : []),
                    ...(item.decidedAt ? [{ term: t("approvals.decidedAt"), value: formatDateTime(item.decidedAt, ctx.locale) }] : []),
                  ]}
                />
                {item.state === "pending" ? (
                  item.canDecide ? (
                    <Cluster gap={2}>
                      <ActionForm
                        action={approveApproval}
                        hidden={{ id: item.id }}
                        refreshOnSuccess
                        variant="secondary"
                        block={false}
                        submitLabel={t("approvals.approve")}
                        pendingLabel={t("approvals.approving")}
                      />
                      <SheetTrigger label={t("approvals.reject")} title={t("approvals.rejectTitle")} closeLabel={t("close")} variant="danger-quiet">
                        <SpecForm
                          action={rejectApproval}
                          hidden={{ id: item.id }}
                          refreshOnSuccess
                          variant="danger"
                          block
                          fields={[{ kind: "textarea", name: "reason", label: t("approvals.rejectReason"), hint: t("approvals.rejectReasonHint"), required: true, maxLength: 1000 }]}
                          submitLabel={t("approvals.rejectSubmit")}
                          pendingLabel={t("approvals.rejecting")}
                        />
                      </SheetTrigger>
                    </Cluster>
                  ) : item.mine ? (
                    <Stack gap={2}>
                      <p className="ed-small ed-muted">{t("approvals.waitingForOther")}</p>
                      <ActionForm
                        action={cancelApproval}
                        hidden={{ id: item.id }}
                        refreshOnSuccess
                        variant="quiet"
                        block={false}
                        submitLabel={t("approvals.cancel")}
                        pendingLabel={t("approvals.cancelling")}
                      />
                    </Stack>
                  ) : (
                    <p className="ed-small ed-muted">{t("approvals.cannotDecide")}</p>
                  )
                ) : null}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}
    </Page>
  );
}
